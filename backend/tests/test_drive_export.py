"""Save to Google Drive (Google is faked; no network)."""
import httpx
import pytest

from apiutil import ready_video
from summarizer.features.exports import drive

TOKEN = "ya29.fake-token-value-123"


class Fake:
    def __init__(self, status=200, body=None, error=None):
        self.status, self.body, self.error, self.calls = status, body or {"id": "doc1", "name": "T", "webViewLink": "https://docs.google.com/document/d/doc1/edit"}, error, []

    def post(self, url, **kwargs):
        self.calls.append((url, kwargs))
        if self.error:
            raise self.error
        return httpx.Response(self.status, json=self.body, request=httpx.Request("POST", url))


@pytest.fixture()
def google(monkeypatch):
    fake = Fake()
    monkeypatch.setattr(drive.httpx, "post", fake.post)
    return fake


def post(api, user, video, token=TOKEN):
    return api.client.post(f"/api/videos/{video}/export/drive", headers=user.headers, json={"access_token": token})


def test_saves_the_study_pack_as_a_google_doc(api, tmp_path, google):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = post(api, user, video)
    assert res.status_code == 200 and res.json() == {"id": "doc1", "name": "T", "url": "https://docs.google.com/document/d/doc1/edit"}
    url, kwargs = google.calls[0]
    assert url == drive.UPLOAD_URL and kwargs["headers"]["Authorization"] == f"Bearer {TOKEN}"
    sent = kwargs["content"].decode()
    assert drive.GOOGLE_DOC in sent and "# " in sent  # metadata asks for a Google Doc; body is the study pack


def test_uses_the_users_edited_summary(api, tmp_path, google):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    api.client.put(f"/api/videos/{video}/edits/summary", headers=user.headers, json={"content": {"markdown": "my edited words"}})
    post(api, user, video)
    assert "my edited words" in google.calls[0][1]["content"].decode()


def test_google_refusing_the_token_asks_to_connect_again(api, tmp_path, monkeypatch):
    monkeypatch.setattr(drive.httpx, "post", Fake(status=401, body={"error": "x"}).post)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = post(api, user, video)
    assert res.status_code == 400 and res.json()["code"] == "drive_auth"


@pytest.mark.parametrize("fake", [Fake(status=500, body={}), Fake(error=httpx.ConnectError("down")), Fake(status=200, body={"nope": 1})])
def test_other_google_problems_are_a_clean_502(api, tmp_path, monkeypatch, fake):
    monkeypatch.setattr(drive.httpx, "post", fake.post)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = post(api, user, video)
    assert res.status_code == 502 and res.json()["code"] == "drive_failed"
    assert TOKEN not in res.text


def test_token_is_never_stored_or_logged(api, tmp_path, google, caplog):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    with caplog.at_level("DEBUG"):
        post(api, user, video)
    assert TOKEN not in caplog.text
    tables = api.sql("select table_name from information_schema.tables where table_schema = 'public'")
    for (name,) in tables:
        rows = api.sql(f'select t::text from public."{name}" t')
        assert not any(TOKEN in r[0] for r in rows)


def test_only_the_owner_and_only_valid_tokens(api, tmp_path, google):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    assert post(api, bob, video).status_code == 404
    assert post(api, alice, video, token="short").status_code == 422
    assert post(api, alice, video, token="has space in it  ").status_code == 422
    assert post(api, alice, video, token="x" * 5000).status_code == 422
    assert google.calls == []


def test_a_video_that_is_not_ready_cannot_be_exported(api, google):
    user = api.user()
    api.submit(user, 9)  # queued, not finished
    vid = api.sql("select video_id from user_videos where user_id = %s", (user.id,))[0][0]
    res = post(api, user, str(vid))
    assert res.status_code == 409 and res.json()["code"] == "video_not_ready"
    assert google.calls == []
