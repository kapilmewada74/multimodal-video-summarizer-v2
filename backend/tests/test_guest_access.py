"""The free try-out: a guest (anonymous sign-in) can summarize and use the study tools, within a smaller
allowance. Everything that belongs to an account stays closed to guests."""
import pytest

from conftest import set_env


def test_a_guest_can_summarize_and_gets_the_smaller_allowance(api):
    guest = api.guest()
    res = api.submit(guest)
    assert res.status_code == 200, res.text
    usage = api.client.get("/api/me/usage", headers=guest.headers).json()
    assert usage["guest"] is True and usage["limit"] == 2 and usage["used"] == 1


def test_a_guest_runs_out_after_the_guest_allowance(api):
    guest = api.guest()
    assert api.submit(guest, 1).status_code == 200
    assert api.submit(guest, 2).status_code == 200
    third = api.submit(guest, 3)
    assert third.status_code == 429 and third.json()["code"] == "daily_limit_reached"


def test_a_guest_can_follow_the_job_and_open_the_video(api, tmp_path):
    from apiutil import ready_video
    guest = api.guest()
    video_id = ready_video(api, guest, tmp_path)
    detail = api.client.get(f"/api/videos/{video_id}", headers=guest.headers)
    assert detail.status_code == 200 and detail.json()["summary"] is not None


def test_a_guest_cannot_see_someone_elses_video(api, tmp_path):
    from apiutil import ready_video
    owner = api.user()
    video_id = ready_video(api, owner, tmp_path)
    assert api.client.get(f"/api/videos/{video_id}", headers=api.guest().headers).status_code == 404


def test_signing_in_restores_the_normal_allowance_and_keeps_the_data(api):
    guest = api.guest()
    assert api.submit(guest, 1).status_code == 200
    account = api.upgrade(guest)
    usage = api.client.get("/api/me/usage", headers=account.headers).json()
    assert usage["guest"] is False and usage["limit"] == 10 and usage["used"] == 1


def test_guests_cannot_upload_files(api):
    res = api.client.post("/api/summarize/upload", headers=api.guest().headers,
                          files={"file": ("a.mp3", b"123", "audio/mpeg")})
    assert res.status_code == 403 and res.json()["code"] == "account_required"


@pytest.mark.parametrize("method,path", [("get", "/api/videos"), ("get", "/api/history"), ("get", "/api/playlists"),
                                         ("get", "/api/documents"), ("get", "/api/study/overview"), ("delete", "/api/me")])
def test_guests_cannot_reach_account_features(api, method, path):
    res = getattr(api.client, method)(path, headers=api.guest().headers)
    assert res.status_code == 403 and res.json()["code"] == "account_required"


def test_guests_can_be_switched_off(api, monkeypatch):
    set_env(monkeypatch, ALLOW_GUESTS="false")
    res = api.submit(api.guest())
    assert res.status_code == 403 and res.json()["code"] == "account_required"


def test_the_guest_limit_is_configurable(api, monkeypatch):
    set_env(monkeypatch, GUEST_DAILY_LIMIT="1")
    guest = api.guest()
    assert api.submit(guest, 1).status_code == 200
    assert api.submit(guest, 2).status_code == 429


def test_a_guest_still_counts_against_the_ip_limit(api, monkeypatch):
    set_env(monkeypatch, IP_DAILY_LIMIT="1", GUEST_DAILY_LIMIT="5")
    assert api.submit(api.guest(), 1).status_code == 200
    assert api.submit(api.guest(), 2).status_code == 429


def test_the_limits_page_data_is_for_accounts_only(api):
    assert api.client.get("/api/me/limits", headers=api.guest().headers).status_code == 403
    assert api.client.get("/api/me/limits").status_code == 401
