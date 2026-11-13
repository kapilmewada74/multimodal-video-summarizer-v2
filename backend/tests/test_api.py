import os

import pytest

from conftest import set_env


# -------------------------------------------------------------- authentication

@pytest.mark.parametrize("method,path", [
    ("get", "/api/me/usage"), ("get", "/api/history"), ("get", "/api/job/abc"),
    ("post", "/api/summarize/url"), ("post", "/api/summarize/upload"),
    ("post", "/api/download/pptx"), ("get", "/api/videos"),
    ("get", "/api/videos/00000000-0000-0000-0000-000000000000"),
    ("delete", "/api/videos/00000000-0000-0000-0000-000000000000"),
    ("post", "/api/videos/00000000-0000-0000-0000-000000000000/outputs/quiz"),
    ("post", "/api/videos/00000000-0000-0000-0000-000000000000/share"),
    ("delete", "/api/videos/00000000-0000-0000-0000-000000000000/share"),
    ("get", "/api/videos/00000000-0000-0000-0000-000000000000/export.md"),
])
def test_every_endpoint_requires_a_session(api, method, path):
    res = getattr(api.client, method)(path)
    assert res.status_code == 401
    assert res.json()["code"] == "not_authenticated"


def test_garbage_token_is_rejected(api):
    res = api.client.get("/api/history", headers={"Authorization": "Bearer abc.def.ghi"})
    assert res.status_code == 401 and res.json()["code"] == "invalid_token"


def test_health_is_public_and_reports_database(api):
    body = api.client.get("/api/health").json()
    assert body["status"] == "healthy" and body["database"] == "ok"


def test_cors_allows_only_configured_origins(api):
    ok = api.client.get("/api/health", headers={"Origin": "http://localhost:3000"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = api.client.get("/api/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in bad.headers


# ------------------------------------------------------------------ submitting

def test_a_signed_in_account_can_submit(api):
    res = api.submit(api.user(), 1)
    assert res.status_code == 200
    assert res.json()["status"] in {"queued", "completed"}


GUARDED = [
    ("get", "/api/videos"), ("get", "/api/history"), ("get", "/api/me/storage"), ("get", "/api/playlists"), ("get", "/api/documents"),
    ("get", "/api/study/overview"), ("get", "/api/notifications"), ("post", "/api/study/sessions"),
    ("post", "/api/playlists"), ("put", "/api/study/goals"), ("get", "/api/me/export"), ("delete", "/api/me"),
]


@pytest.mark.parametrize("method,path", GUARDED)
def test_guest_sessions_cannot_use_account_features(api, method, path):
    res = getattr(api.client, method)(path, headers=api.anonymous_headers(), **({"json": {}} if method in ("post", "put") else {}))
    assert res.status_code == 403 and res.json()["code"] == "account_required"
    assert api.sql("select count(*) from jobs")[0][0] == 0
    assert api.sql("select count(*) from user_videos")[0][0] == 0


def test_public_share_pages_still_need_no_account(api):
    assert api.client.get("/api/public/not-a-real-token-not-a-real-token-1234").status_code in (404, 410)


def test_url_validation(api):
    user = api.user()
    for bad in ("", "https://example.com/x", "https://www.youtube.com/watch?v=short"):
        res = api.client.post("/api/summarize/url", headers=user.headers, json={"url": bad})
        assert res.status_code == 400
    assert api.sql("select count(*) from jobs")[0][0] == 0


def test_job_is_private_to_its_owner(api):
    alice, bob = api.user(), api.user()
    job_id = api.submit(alice, 1).json()["job_id"]
    assert api.client.get(f"/api/job/{job_id}", headers=alice.headers).status_code == 200
    assert api.client.get(f"/api/job/{job_id}", headers=bob.headers).status_code == 404
    assert api.client.get("/api/job/not-a-uuid", headers=alice.headers).status_code == 404


def test_new_job_has_the_shape_the_frontend_expects(api):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    job = api.client.get(f"/api/job/{job_id}", headers=user.headers).json()
    for key in ("id", "type", "status", "step", "step_name", "progress", "message", "error", "result"):
        assert key in job
    assert job["type"] == "url" and job["status"] == "queued" and job["result"] is None


# ---------------------------------------------------------------- daily limit

def test_eleventh_video_of_the_day_is_refused(api):
    user = api.user()
    for n in range(10):
        assert api.submit(user, n).status_code == 200
    res = api.submit(user, 99)
    assert res.status_code == 429
    body = res.json()
    assert body["code"] == "daily_limit_reached"
    assert body["usage"]["used"] == 10 and body["usage"]["limit"] == 10 and body["usage"]["remaining"] == 0


def test_usage_endpoint(api):
    user = api.user()
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 0
    api.submit(user, 1)
    usage = api.client.get("/api/me/usage", headers=user.headers).json()
    assert (usage["used"], usage["limit"], usage["remaining"]) == (1, 10, 9)
    assert usage["resets_at"]


def test_usage_works_for_a_user_without_a_profile_row(api):
    user = api.user()
    api.sql("delete from profiles where user_id = %s", (user.id,))
    assert api.client.get("/api/me/usage", headers=user.headers).json()["limit"] == 10


def test_valid_token_for_a_deleted_user_is_rejected(api):
    from conftest import make_token
    import uuid
    ghost = make_token(uuid.uuid4())
    res = api.client.get("/api/me/usage", headers={"Authorization": f"Bearer {ghost}"})
    assert res.status_code == 401


def test_per_ip_daily_limit(api, monkeypatch):
    set_env(monkeypatch, IP_DAILY_LIMIT="3")
    users = [api.user() for _ in range(4)]
    codes = [api.submit(u, i).status_code for i, u in enumerate(users)]
    assert codes == [200, 200, 200, 429]
    assert api.submit(api.user(), 50).json()["code"] == "ip_limit_reached"


def test_ip_addresses_are_stored_hashed(api):
    api.submit(api.user(), 1)
    stored = api.sql("select ip_hash from ip_usage")[0][0]
    assert "127.0.0.1" not in stored and "testclient" not in stored and len(stored) == 64


def test_forwarded_header_is_ignored_unless_proxy_is_trusted(api, monkeypatch):
    set_env(monkeypatch, IP_DAILY_LIMIT="1")
    a, b = api.user(), api.user()
    assert api.submit(a, 1, headers={**a.headers, "X-Forwarded-For": "1.1.1.1"}).status_code == 200
    # A client cannot dodge the cap by faking the header.
    assert api.submit(b, 2, headers={**b.headers, "X-Forwarded-For": "2.2.2.2"}).status_code == 429


# -------------------------------------------------------------------- uploads

def stored_files(tmp_path):
    root = tmp_path / "data" / "uploads"
    return [p.name for p in root.rglob("*") if p.is_file()] if root.exists() else []


def test_upload_creates_job_and_keeps_file_for_the_worker(api, tmp_path):
    user = api.user()
    res = api.upload(user, "My Lecture.MP4", b"abc")
    assert res.status_code == 200
    names = stored_files(tmp_path)
    assert len(names) == 1 and names[0].endswith("__My Lecture.mp4")
    job = api.sql("select source, source_ref from jobs")[0]
    assert job[0] == "upload" and job[1] == names[0]


def test_upload_filename_cannot_escape_the_storage_folder(api, tmp_path):
    user = api.user()
    assert api.upload(user, "../../outside.mp4", b"abc").status_code == 200
    assert api.upload(user, "..\\..\\outside2.mp4", b"abcd").status_code == 200
    for name in stored_files(tmp_path):
        assert "/" not in name and ".." not in name
    assert not os.path.exists(tmp_path.parent / "outside.mp4")
    assert not os.path.exists(tmp_path / "outside.mp4")


def test_upload_rejects_unsupported_empty_and_oversized_files(api, tmp_path, monkeypatch):
    user = api.user()
    assert api.upload(user, "notes.pdf", b"x").status_code == 400
    assert api.upload(user, "empty.mp4", b"").json()["code"] == "empty_file"
    set_env(monkeypatch, MAX_UPLOAD_MB="0")
    assert api.upload(user, "big.mp4", b"x" * 10).status_code == 413
    assert stored_files(tmp_path) == []
    assert not list((tmp_path / "data" / "tmp").glob("*"))  # temp file removed
    assert api.sql("select count(*) from jobs")[0][0] == 0


def test_same_file_uploaded_twice_is_one_shared_video(api):
    a, b = api.user(), api.user()
    api.upload(a, "one.mp4", b"same-bytes")
    api.upload(b, "two.mp4", b"same-bytes")
    assert api.sql("select count(*) from videos")[0][0] == 1


def test_upload_is_refused_up_front_when_the_limit_is_used_up(api, tmp_path):
    user = api.user()
    api.sql("update profiles set daily_video_limit = 1 where user_id = %s", (user.id,))
    assert api.upload(user, "a.mp4", b"1").status_code == 200
    res = api.upload(user, "b.mp4", b"2")
    assert res.status_code == 429 and res.json()["code"] == "daily_limit_reached"
    assert len(stored_files(tmp_path)) == 1  # the refused file was never stored


# --------------------------------------------------------------------- history

def test_history_is_empty_until_a_video_is_ready_and_is_private(api):
    alice, bob = api.user(), api.user()
    api.submit(alice, 1)
    assert api.client.get("/api/history", headers=alice.headers).json() == []
    assert api.client.get("/api/history", headers=bob.headers).json() == []


# ------------------------------------------------------------------ PowerPoint

def test_pptx_download_with_unicode_title(api):
    user = api.user()
    res = api.client.post("/api/download/pptx", headers=user.headers,
                          json={"title": "हिन्दी शीर्षक", "slides": [{"title": "A", "bullets": ["b"]}]})
    assert res.status_code == 200
    disposition = res.headers["content-disposition"]
    assert disposition.startswith('attachment; filename="') and "filename*=UTF-8''" in disposition
    assert len(res.content) > 1000


def test_pptx_slide_count_is_limited(api):
    res = api.client.post("/api/download/pptx", headers=api.user().headers,
                          json={"title": "t", "slides": [{}] * 41})
    assert res.status_code == 422


def test_header_injection_characters_are_removed():
    from summarizer.shared.http import safe_download_header
    value = safe_download_header('evil"\r\nX-Injected: 1', "pptx")
    assert "\r" not in value and "\n" not in value and value.count('"') == 2


def test_old_stateless_generation_endpoints_are_gone(api):
    """They had no usage cap; generation now goes through the capped video outputs."""
    user = api.user()
    for path in ("flashcards", "presentation", "quiz"):
        res = api.client.post(f"/api/generate/{path}", headers=user.headers, json={"title": "t", "summary": "s"})
        assert res.status_code == 404


def test_large_upload_work_does_not_run_on_the_event_loop(api, monkeypatch):
    """Saving a big file must not freeze the server for other users."""
    import threading
    from summarizer.features.videos import router as videos_router

    seen = {}
    real_get_store = videos_router.get_file_store

    class SpyStore:
        def __init__(self):
            self.inner = real_get_store()

        def save(self, source, key):
            seen["thread"] = threading.current_thread().name
            return self.inner.save(source, key)

    monkeypatch.setattr(videos_router, "get_file_store", lambda: SpyStore())
    assert api.upload(api.user(), "a.mp4", b"abc").status_code == 200
    # Worker threads of the server's thread pool, not the event loop's thread.
    assert "AnyIO worker" in seen["thread"]
