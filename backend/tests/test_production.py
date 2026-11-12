"""Production readiness: start-up checks, health probes, request tracing, ops numbers, account data."""
import json
import logging

import pytest

from conftest import set_env
from summarizer.core.config import get_settings
from summarizer.core.startup_checks import UnsafeConfiguration, check_settings, enforce

GOOD = dict(
    ENVIRONMENT="production", DATABASE_URL="postgresql://x", SUPABASE_URL="https://abc.supabase.co",
    APP_URL="https://app.example.com", CORS_ORIGINS="https://app.example.com",
    STREAM_SIGNING_KEY="k" * 40, IP_HASH_SALT="s" * 24, GROQ_API_KEY="g", TRUST_PROXY="1",
    FILE_STORE="supabase", SUPABASE_SERVICE_ROLE_KEY="svc", RUN_EMBEDDED_WORKER="false",
    RESEND_API_KEY="r", SENTRY_DSN="https://k@o.ingest.sentry.io/1",
)


def test_a_complete_production_config_has_no_errors(monkeypatch):
    set_env(monkeypatch, **GOOD)
    assert check_settings(get_settings()) == []


@pytest.mark.parametrize("name,value,fragment", [
    ("DATABASE_URL", "", "DATABASE_URL"),
    ("SUPABASE_URL", "http://abc.supabase.co", "https"),
    ("APP_URL", "http://localhost:3000", "APP_URL"),
    ("CORS_ORIGINS", "https://app.example.com,http://localhost:3000", "local address"),
    ("CORS_ORIGINS", "*", "'*'"),
    ("STREAM_SIGNING_KEY", "short", "too short"),
    ("IP_HASH_SALT", "", "IP_HASH_SALT"),
    ("IP_HASH_SALT", "summarizer-default-salt", "IP_HASH_SALT"),
    ("SUPABASE_SERVICE_ROLE_KEY", "", "SERVICE_ROLE"),
    ("GROQ_API_KEY", "", "AI provider"),
])
def test_unsafe_settings_are_reported(monkeypatch, name, value, fragment):
    found = _with(monkeypatch, name, value)
    assert any(fragment in m for m in found), found


def _with(monkeypatch, name, value):
    values = {**GOOD, name: value}
    for key, val in list(values.items()):
        if val == "":
            monkeypatch.delenv(key, raising=False)
            del values[key]
    # Settings that would otherwise satisfy the check through another variable must not.
    if name == "STREAM_SIGNING_KEY" and value == "":
        values.pop("SUPABASE_SERVICE_ROLE_KEY", None)
    set_env(monkeypatch, **values)
    return [f.message for f in check_settings(get_settings()) if f.level == "error"]


def test_production_start_is_refused_but_development_is_not(monkeypatch):
    set_env(monkeypatch, ENVIRONMENT="production")
    with pytest.raises(UnsafeConfiguration) as caught:
        enforce(get_settings(), logging.getLogger("t"))
    assert "DATABASE_URL" in str(caught.value)
    set_env(monkeypatch, ENVIRONMENT="development")
    enforce(get_settings(), logging.getLogger("t"))  # no error


def test_the_override_lets_a_deliberate_one_off_start(monkeypatch):
    set_env(monkeypatch, ENVIRONMENT="production", SKIP_STARTUP_CHECKS="1")
    enforce(get_settings(), logging.getLogger("t"))


# ---------------------------------------------------------------------- probes

def test_liveness_never_needs_the_database(api):
    assert api.client.get("/api/health/live").json() == {"status": "alive"}


def test_readiness_is_ok_with_a_database(api):
    res = api.client.get("/api/health/ready")
    assert res.status_code == 200 and res.json()["database"] == "ok"


def test_readiness_fails_when_the_database_is_gone(api, monkeypatch):
    from summarizer.core import db
    db.close_pool()
    set_env(monkeypatch, DATABASE_URL="postgresql://nobody@127.0.0.1:1/none?connect_timeout=1")
    res = api.client.get("/api/health/ready")
    assert res.status_code == 503 and res.json()["status"] == "not_ready"
    assert api.client.get("/api/health/live").status_code == 200


# --------------------------------------------------------------------- tracing

def test_every_response_has_a_request_id_and_security_headers(api):
    res = api.client.get("/api/health/live")
    assert len(res.headers["x-request-id"]) >= 8
    assert res.headers["x-content-type-options"] == "nosniff"
    assert res.headers["x-frame-options"] == "DENY"


def test_a_proxy_request_id_is_kept_but_a_hostile_one_is_replaced(api):
    assert api.client.get("/api/health/live", headers={"X-Request-ID": "abc-123"}).headers["x-request-id"] == "abc-123"
    bad = api.client.get("/api/health/live", headers={"X-Request-ID": "x y\tz"}).headers["x-request-id"]
    assert bad != "x y\tz" and " " not in bad


def test_logs_leave_out_ids_and_query_strings(api, caplog):
    user = api.user()
    with caplog.at_level(logging.INFO, logger="summarizer.access"):
        api.client.get("/api/job/0123456789abcdef0123456789abcdef?token=SECRET", headers=user.headers)
    text = " ".join(r.getMessage() for r in caplog.records if r.name == "summarizer.access")
    assert "SECRET" not in text and "0123456789abcdef" not in text and "/api/job/:id" in text


def test_json_log_format_has_the_request_id():
    from summarizer.core.observability import JsonFormatter, request_id_var
    request_id_var.set("rid-1")
    record = logging.LogRecord("n", logging.INFO, "f", 1, "hello %s", ("you",), None)
    record.status = 200
    out = json.loads(JsonFormatter().format(record))
    assert out["message"] == "hello you" and out["request_id"] == "rid-1" and out["status"] == 200
    request_id_var.set("-")


# ------------------------------------------------------------------- ops stats

def test_ops_stats_are_closed_without_a_token(api, monkeypatch):
    assert api.client.get("/api/internal/stats").status_code == 404
    monkeypatch.setenv("OPS_TOKEN", "t" * 20)
    assert api.client.get("/api/internal/stats").status_code == 401
    assert api.client.get("/api/internal/stats", headers={"X-Ops-Token": "wrong"}).status_code == 401


def test_ops_stats_count_the_queue(api, monkeypatch):
    monkeypatch.setenv("OPS_TOKEN", "t" * 20)
    user = api.user()
    for n in range(3):
        assert api.submit(user, n).status_code in (200, 202)
    body = api.client.get("/api/internal/stats", headers={"X-Ops-Token": "t" * 20}).json()
    assert body["queue"]["waiting"] == 3 and body["users_total"] >= 1
    assert "email" not in json.dumps(body)


def test_alerts_name_the_problem():
    from summarizer.features.ops.router import evaluate_alerts
    healthy = {"queue": {"waiting": 1, "oldest_waiting_seconds": 5}, "last_24h": {"completed": 50, "failed": 1, "failed_system": 0},
               "last_hour": {"submitted": 10, "failed_system": 0}}
    assert evaluate_alerts(healthy) == []
    sick = {"queue": {"waiting": 80, "oldest_waiting_seconds": 900}, "last_24h": {"completed": 10, "failed": 20, "failed_system": 20},
            "last_hour": {"submitted": 10, "failed_system": 5}}
    assert len(evaluate_alerts(sick)) == 4


# --------------------------------------------------------------- worker health

def test_worker_heartbeat_health(tmp_path, monkeypatch):
    from summarizer.features.jobs import worker
    monkeypatch.setattr(worker, "HEARTBEAT_FILE", tmp_path / "hb")
    assert not worker.is_healthy()
    worker.beat()
    assert worker.is_healthy() and worker.main(["--healthcheck"]) == 0
    import os, time
    old = time.time() - 600
    os.utime(tmp_path / "hb", (old, old))
    assert not worker.is_healthy() and worker.main(["--healthcheck"]) == 1


# --------------------------------------------------------------------- account

def test_export_contains_only_my_data_and_no_secrets(api):
    me, other = api.user(), api.user()
    api.submit(me, 1)
    api.submit(other, 2)
    body = api.client.get("/api/me/export", headers=me.headers)
    assert body.status_code == 200 and "attachment" in body.headers["content-disposition"]
    data = body.json()
    assert data["account"]["id"] == me.id and other.id not in body.text
    assert data["user_videos"] and data["profiles"]
    assert "storage_key" not in body.text


def test_deleting_the_account_needs_the_word_and_removes_everything(api, tmp_path):
    me, other = api.user(), api.user()
    api.submit(me, 1)
    assert api.client.request("DELETE", "/api/me", headers=me.headers, json={"confirm": "yes"}).status_code == 400
    res = api.client.request("DELETE", "/api/me", headers=me.headers, json={"confirm": "DELETE"})
    assert res.status_code == 200 and res.json()["deleted"] is True
    assert api.sql("select count(*) from auth.users where id = %s", (me.id,))[0][0] == 0
    assert api.sql("select count(*) from jobs where user_id = %s", (me.id,))[0][0] == 0
    assert api.sql("select count(*) from auth.users where id = %s", (other.id,))[0][0] == 1


def test_deleting_the_account_removes_stored_files(api, tmp_path, monkeypatch):
    me = api.user()
    store_dir = tmp_path / "data" / "uploads"
    store_dir.mkdir(parents=True)
    (store_dir / "doc-key").write_bytes(b"x")
    api.sql("insert into documents (user_id, filename, extension, mime, size_bytes, sha256, storage_key) "
            "values (%s, 'a.pdf', 'pdf', 'application/pdf', 1, %s, 'doc-key')", (me.id, "a" * 64))
    res = api.client.request("DELETE", "/api/me", headers=me.headers, json={"confirm": "DELETE"})
    assert res.json()["files_removed"] == 1
    assert not (store_dir / "doc-key").exists()


def test_account_endpoints_refuse_guests(api):
    assert api.client.get("/api/me/export", headers=api.anonymous_headers()).status_code == 403
