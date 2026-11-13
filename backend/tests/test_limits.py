"""What the account page shows: today's usage and every limit."""
from conftest import set_env


def test_an_account_sees_usage_and_all_limits(api, monkeypatch):
    set_env(monkeypatch, MAX_UPLOAD_MB="200", MAX_VIDEO_SECONDS="3600", MAX_DOCUMENT_MB="10",
            USER_STORAGE_QUOTA_MB="1000", MAX_DOCUMENTS_PER_USER="50", GENERATION_DAILY_LIMIT="40")
    user = api.user()
    res = api.submit(user, 1)
    assert res.status_code == 200, res.text
    data = api.client.get("/api/me/limits", headers=user.headers).json()
    assert data["videos"]["used"] == 1 and data["videos"]["limit"] == 10 and data["videos"]["remaining"] == 9
    assert data["videos"]["resets_at"]
    assert data["generations"] == {"used": 0, "limit": 40, "resets_at": data["generations"]["resets_at"]}
    assert data["uploads"]["max_bytes"] == 200 * 1024 * 1024
    assert data["uploads"]["max_video_seconds"] == 3600
    assert ".mp4" in data["uploads"]["extensions"] and ".mp3" in data["uploads"]["extensions"]
    assert data["documents"]["max_bytes"] == 10 * 1024 * 1024
    assert data["documents"]["max_count"] == 50 and data["documents"]["count"] == 0
    assert ".pdf" in data["documents"]["extensions"]
    assert data["storage"] == {"used_bytes": 0, "quota_bytes": 1000 * 1024 * 1024}


def test_generations_used_today_are_counted(api):
    user = api.user()
    api.sql("insert into generation_usage (user_id, day, count) values (%s, (now() at time zone 'UTC')::date, 7)", (user.id,))
    assert api.client.get("/api/me/limits", headers=user.headers).json()["generations"]["used"] == 7


def test_nothing_secret_or_internal_is_exposed(api):
    text = api.client.get("/api/me/limits", headers=api.user().headers).text.lower()
    for word in ("ip_daily", "salt", "key", "token", "database"):
        assert word not in text
