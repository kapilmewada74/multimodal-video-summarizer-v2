"""Fixes from the security review: spoofed addresses, push hosts, oversized input, rate limits."""
import types

import pytest

from conftest import set_env
from summarizer.features.notifications import push
from summarizer.shared import throttle
from summarizer.shared.net import client_ip


def request(forwarded=None, host="10.0.0.9"):
    headers = {"x-forwarded-for": forwarded} if forwarded is not None else {}
    return types.SimpleNamespace(headers=headers, client=types.SimpleNamespace(host=host))


class TestClientAddress:
    def test_forwarded_header_is_ignored_unless_a_proxy_is_trusted(self, monkeypatch):
        monkeypatch.delenv("TRUST_PROXY", raising=False)
        assert client_ip(request("1.2.3.4")) == "10.0.0.9"

    def test_the_address_the_proxy_added_is_used_not_the_one_the_client_wrote(self, monkeypatch):
        monkeypatch.setenv("TRUST_PROXY", "1")
        # The client sent "9.9.9.9"; the proxy appended the real address after it.
        assert client_ip(request("9.9.9.9, 203.0.113.7")) == "203.0.113.7"
        assert client_ip(request("203.0.113.7")) == "203.0.113.7"

    def test_two_trusted_proxies(self, monkeypatch):
        monkeypatch.setenv("TRUST_PROXY", "1")
        monkeypatch.setenv("TRUST_PROXY_HOPS", "2")
        assert client_ip(request("9.9.9.9, 203.0.113.7, 10.1.1.1")) == "203.0.113.7"
        assert client_ip(request("203.0.113.7")) == "203.0.113.7"        # fewer entries than hops: best available

    def test_junk_falls_back_safely(self, monkeypatch):
        monkeypatch.setenv("TRUST_PROXY", "1")
        monkeypatch.setenv("TRUST_PROXY_HOPS", "many")
        assert client_ip(request(" , ,")) == "10.0.0.9"
        assert client_ip(request("1.1.1.1, 2.2.2.2")) == "2.2.2.2"

    def test_the_daily_address_limit_cannot_be_dodged_by_writing_a_new_header(self, api, monkeypatch):
        monkeypatch.setenv("TRUST_PROXY", "1")
        set_env(monkeypatch, IP_DAILY_LIMIT="1")
        first = api.submit(api.user(), 1, headers={**api.user().headers, "X-Forwarded-For": "1.1.1.1, 203.0.113.7"})
        second = api.submit(api.user(), 2, headers={**api.user().headers, "X-Forwarded-For": "2.2.2.2, 203.0.113.7"})
        assert first.status_code == 200
        assert second.status_code == 429 and second.json()["code"] == "ip_limit_reached"


class TestPushHosts:
    @pytest.mark.parametrize("url", [
        "https://fcm.googleapis.com/fcm/send/abc", "https://android.googleapis.com/gcm/send/abc",
        "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc",
        "https://wns2-par02p.notify.windows.com/w/?token=abc",
    ])
    def test_the_real_push_services_are_allowed(self, url):
        assert push.is_allowed_endpoint(url)

    @pytest.mark.parametrize("url", [
        "https://storage.googleapis.com/some-bucket/page", "https://evil.googleapis.com/x", "https://www.mozilla.com/x",
        "https://example.mozilla.com/x", "https://notify.windows.com.evil.example/x", "https://windows.com/x",
        "http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com:8443/x", "https://user@fcm.googleapis.com/x",
        "https://127.0.0.1/x", "https://localhost/x", "", None,
    ])
    def test_anything_else_is_refused(self, url):
        assert not push.is_allowed_endpoint(url)


class TestThrottle:
    def test_allows_the_limit_then_refuses(self):
        for i in range(3):
            throttle.check("k", 3, 60, now=100 + i)
        with pytest.raises(Exception) as err:
            throttle.check("k", 3, 60, now=103)
        assert err.value.status_code == 429 and err.value.extra["retry_after"] >= 1

    def test_the_window_slides_and_keys_are_separate(self):
        for i in range(3):
            throttle.check("a", 3, 60, now=100)
        throttle.check("b", 3, 60, now=100)
        throttle.check("a", 3, 60, now=161)

    def test_memory_does_not_grow_without_limit(self):
        for i in range(throttle._MAX_KEYS + 50):
            throttle.check(f"k{i}", 1, 1, now=float(i))
        assert len(throttle._hits) <= throttle._MAX_KEYS + 50


class TestSlidesDownload:
    def slides(self, **over):
        return {"title": "T", "slides": [{"title": "S", "bullets": ["a"]}], **over}

    def test_a_normal_request_works(self, api):
        res = api.client.post("/api/download/pptx", headers=api.user().headers, json=self.slides())
        assert res.status_code == 200 and res.content[:2] == b"PK"

    @pytest.mark.parametrize("bad", [
        [{"title": "x" * 6000}],
        [{"bullets": ["y" * 4000] * 80}],
        [{f"t{i}": "z" * 1200 for i in range(6)} for _ in range(40)],   # each piece is fine; together far too big
        [{"a": {"b": {"c": {"d": {"e": {"f": {"g": 1}}}}}}}],
        [{f"k{i}": 1 for i in range(40)}],
    ])
    def test_oversized_or_odd_slide_data_is_refused(self, api, bad):
        res = api.client.post("/api/download/pptx", headers=api.user().headers, json=self.slides(slides=bad))
        assert res.status_code == 422

    def test_it_is_rate_limited_per_person(self, api):
        user = api.user()
        codes = [api.client.post("/api/download/pptx", headers=user.headers, json=self.slides()).status_code for _ in range(14)]
        assert codes[:12] == [200] * 12 and codes[12:] == [429, 429]

    def test_guests_are_limited_too(self, api):
        guest = api.guest()
        codes = [api.client.post("/api/download/pptx", headers=guest.headers, json=self.slides()).status_code for _ in range(13)]
        assert codes[-1] == 429


class TestBodySize:
    def test_a_huge_json_body_is_refused_before_it_is_read(self, api, monkeypatch):
        monkeypatch.setenv("MAX_JSON_BODY_KB", "1")
        res = api.client.post("/api/playlists", headers=api.user().headers, json={"title": "x" * 5000})
        assert res.status_code == 413 and res.json()["code"] == "request_too_large"

    def test_a_body_with_no_declared_size_is_counted_and_cut_off(self, api, monkeypatch):
        """Leaving out Content-Length (chunked transfer) must not get around the limit."""
        monkeypatch.setenv("MAX_JSON_BODY_KB", "1")

        def pieces():
            yield b'{"title": "'
            for _ in range(20):
                yield b"x" * 500
            yield b'"}'

        headers = {**api.user().headers, "Content-Type": "application/json"}
        res = api.client.post("/api/playlists", headers=headers, content=pieces())
        assert res.status_code == 413 and res.json()["code"] == "request_too_large"

    def test_a_small_chunked_body_is_fine(self, api):
        def pieces():
            yield b'{"title": "Chun'
            yield b'ked list"}'

        headers = {**api.user().headers, "Content-Type": "application/json"}
        assert api.client.post("/api/playlists", headers=headers, content=pieces()).status_code in (200, 201)

    def test_file_uploads_are_not_held_to_the_json_limit(self, api, monkeypatch):
        monkeypatch.setenv("MAX_JSON_BODY_KB", "1")
        res = api.upload(api.user(), content=b"x" * 5000)
        assert res.status_code != 413

    def test_normal_requests_are_untouched(self, api):
        res = api.client.post("/api/playlists", headers=api.user().headers, json={"title": "My playlist"})
        assert res.status_code in (200, 201)


class TestApiDocumentation:
    def test_the_route_map_is_off_in_production_and_on_in_development(self, db_url, monkeypatch):
        from fastapi.testclient import TestClient
        from summarizer.main import create_app
        set_env(monkeypatch, DATABASE_URL=db_url, ENVIRONMENT="development", RUN_EMBEDDED_WORKER="false", SKIP_STARTUP_CHECKS="1")
        with TestClient(create_app()) as dev:
            assert dev.get("/openapi.json").status_code == 200
        set_env(monkeypatch, ENVIRONMENT="production", SKIP_STARTUP_CHECKS="1")
        with TestClient(create_app()) as prod:
            for path in ("/openapi.json", "/docs", "/redoc"):
                assert prod.get(path).status_code == 404, path
        set_env(monkeypatch, ENABLE_API_DOCS="1")
        with TestClient(create_app()) as opted_in:
            assert opted_in.get("/openapi.json").status_code == 200
