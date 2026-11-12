"""Public share links and the Markdown study-pack export."""
import json

import pytest

from apiutil import ready_video
from summarizer.features.exports.service import build_markdown, mindmap_to_markdown
from summarizer.features.outputs import service as outputs_service

MAP = {"title": "Topic", "children": [{"title": "Branch A", "children": [{"title": "Leaf", "children": []}]}], "provider": ""}
FLASH = {"flashcards": [{"front": "Front?", "back": "Back.", "tag": "t"}], "provider": ""}
QUIZ = {"quiz": [{"question": "Which?", "options": ["w", "x", "y", "z"], "answerIndex": 2, "explanation": "Because."}],
        "provider": "", "difficulty": "medium"}


@pytest.fixture()
def fake_ai(monkeypatch):
    calls = []

    def fake(kind, title, summary, transcript, params):
        calls.append(kind)
        return dict({"mindmap": MAP, "flashcards": FLASH, "quiz": QUIZ, "slides": {"title": "D", "slides": []}}[kind])

    monkeypatch.setattr(outputs_service, "_generate", fake)
    return calls


def post(api, user, video, path, **kw):
    return api.client.post(f"/api/videos/{video}/{path}", headers=user.headers, **kw)


# ------------------------------------------------------------------- sharing

def test_share_link_gives_anyone_a_read_only_view(api, tmp_path, fake_ai):
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    post(api, owner, video, "outputs/mindmap")
    post(api, owner, video, "outputs/flashcards")
    post(api, owner, video, "outputs/quiz")

    link = post(api, owner, video, "share")
    assert link.status_code == 200
    token = link.json()["token"]
    assert len(token) >= 43

    res = api.client.get(f"/api/public/{token}")  # no sign-in at all
    assert res.status_code == 200
    body = res.json()
    assert body["title"] == "Test Video" and "It works." in body["summary"]
    assert body["mindmap"]["title"] == "Topic" and body["flashcards"][0]["front"] == "Front?"
    assert res.headers["cache-control"] == "no-store" and "noindex" in res.headers["x-robots-tag"]


def test_public_view_never_exposes_private_or_internal_data(api, tmp_path, fake_ai):
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    post(api, owner, video, "outputs/quiz")  # quiz has answers; it is not shared
    token = post(api, owner, video, "share").json()["token"]
    raw = api.client.get(f"/api/public/{token}").text
    body = json.loads(raw)
    assert set(body) == {"title", "duration", "youtube_id", "summary", "mindmap", "flashcards"}
    assert "hello world transcript" not in raw  # the transcript is not shared
    assert "Because." not in raw and "answerIndex" not in raw
    assert owner.id not in raw and video not in raw  # no internal ids


def test_share_link_is_stable_and_unique_per_video(api, tmp_path, fake_ai):
    owner = api.user()
    first_video, second_video = ready_video(api, owner, tmp_path, 1), ready_video(api, owner, tmp_path, 2)
    a = post(api, owner, first_video, "share").json()["token"]
    assert post(api, owner, first_video, "share").json()["token"] == a  # same link when asked again
    b = post(api, owner, second_video, "share").json()["token"]
    assert a != b
    detail = api.client.get(f"/api/videos/{first_video}", headers=owner.headers).json()
    assert detail["share"] == {"active": True, "token": a}


def test_revoking_stops_the_link_and_a_new_one_differs(api, tmp_path, fake_ai):
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    token = post(api, owner, video, "share").json()["token"]
    assert api.client.delete(f"/api/videos/{video}/share", headers=owner.headers).status_code == 204
    assert api.client.get(f"/api/public/{token}").status_code == 404
    assert api.client.get(f"/api/videos/{video}", headers=owner.headers).json()["share"]["active"] is False
    assert post(api, owner, video, "share").json()["token"] != token


def test_expired_links_stop_working_and_can_be_replaced(api, tmp_path, fake_ai):
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    token = post(api, owner, video, "share").json()["token"]
    api.sql("update share_links set expires_at = now() - interval '1 minute'")
    assert api.client.get(f"/api/public/{token}").status_code == 404
    fresh = post(api, owner, video, "share")
    assert fresh.status_code == 200 and fresh.json()["token"] != token
    assert api.client.get(f"/api/public/{fresh.json()['token']}").status_code == 200


@pytest.mark.parametrize("token", ["short", "a" * 31, "a" * 65, "../../etc/passwd" + "a" * 30,
                                   "a b " * 12, "%00" * 20, "x" * 43])
def test_bad_or_unknown_tokens_are_a_plain_404(api, token):
    res = api.client.get(f"/api/public/{token}")
    assert res.status_code == 404  # (tokens with a slash never even reach the handler)


def test_only_the_owner_can_create_or_revoke(api, tmp_path, fake_ai):
    owner, other = api.user(), api.user()
    video = ready_video(api, owner, tmp_path)
    token = post(api, owner, video, "share").json()["token"]
    assert post(api, other, video, "share").status_code == 404
    assert api.client.delete(f"/api/videos/{video}/share", headers=other.headers).status_code == 404
    assert api.client.get(f"/api/public/{token}").status_code == 200  # untouched


def test_another_user_of_the_same_video_has_their_own_independent_link(api, tmp_path, fake_ai):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    api.submit(bob, 1)
    a = post(api, alice, video, "share").json()["token"]
    b = post(api, bob, video, "share").json()["token"]
    assert a != b
    api.client.delete(f"/api/videos/{video}/share", headers=bob.headers)
    assert api.client.get(f"/api/public/{a}").status_code == 200  # Alice's link still works
    assert api.client.get(f"/api/public/{b}").status_code == 404


def test_cannot_share_a_video_that_is_not_ready(api):
    user = api.user()
    job = api.submit(user, 1).json()
    video = api.client.get(f"/api/job/{job['job_id']}", headers=user.headers).json()["video_id"]
    assert post(api, user, video, "share").status_code == 409


def test_link_stops_working_if_the_video_is_no_longer_ready(api, tmp_path, fake_ai):
    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    token = post(api, owner, video, "share").json()["token"]
    api.sql("update videos set status = 'failed'")
    assert api.client.get(f"/api/public/{token}").status_code == 404


def test_parallel_requests_for_a_link_create_only_one(api, tmp_path, fake_ai):
    import threading
    from summarizer.core.db import connection
    from summarizer.features.sharing import repository as sharing

    owner = api.user()
    video = ready_video(api, owner, tmp_path)
    tokens = []

    def create():
        with connection() as conn:
            tokens.append(sharing.create_or_get_link(conn, owner.id, video)["token"])

    threads = [threading.Thread(target=create) for _ in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(set(tokens)) == 1 and len(tokens) == 8
    assert api.sql("select count(*) from share_links where revoked_at is null")[0][0] == 1


# -------------------------------------------------------------------- export

def test_export_contains_only_what_exists_and_never_calls_the_ai(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    before = api.client.get(f"/api/videos/{video}/export.md", headers=user.headers)
    assert before.status_code == 200
    assert "# Test Video" in before.text and "It works." in before.text and "hello world transcript" in before.text
    assert "## Flashcards" not in before.text and "## Quiz" not in before.text and "## Mind map" not in before.text
    assert fake_ai == []

    post(api, user, video, "outputs/mindmap")
    post(api, user, video, "outputs/flashcards")
    post(api, user, video, "outputs/quiz")
    after = api.client.get(f"/api/videos/{video}/export.md", headers=user.headers).text
    assert "## Mind map" in after and "  - Leaf" in after
    assert "1. **Front?**" in after and "Back." in after
    assert "y ✓" in after and "w ✓" not in after  # the right answer is marked
    assert after.index("## Mind map") < after.index("## Flashcards") < after.index("## Quiz") < after.index("## Transcript")
    assert len(fake_ai) == 3  # only the three explicit generations


def test_export_download_headers_handle_unicode_titles(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    api.sql("update videos set title = %s", ("हिन्दी शीर्षक: Test/Video",))
    res = api.client.get(f"/api/videos/{video}/export.md", headers=user.headers)
    assert res.status_code == 200 and res.headers["content-type"].startswith("text/markdown")
    disposition = res.headers["content-disposition"]
    assert disposition.endswith(".md") and "filename*=UTF-8''" in disposition and "/" not in disposition.split("filename=")[1].split(";")[0]


def test_export_needs_a_finished_video(api):
    user = api.user()
    job = api.submit(user, 1).json()
    video = api.client.get(f"/api/job/{job['job_id']}", headers=user.headers).json()["video_id"]
    assert api.client.get(f"/api/videos/{video}/export.md", headers=user.headers).status_code == 409


def test_markdown_builder_handles_missing_pieces():
    text = build_markdown({"title": None, "summary": "S", "duration": 0, "transcript": None}, [])
    assert text.startswith("# Video") and "S" in text and "Transcript" not in text
    assert "Transcript" not in build_markdown({"title": "T", "summary": "S", "transcript": "x"}, [], include_transcript=False)
    broken = [{"kind": "quiz", "content": {"quiz": [{"question": "Q"}]}}, {"kind": "flashcards", "content": {}}]
    assert "Q" in build_markdown({"title": "T", "summary": "S"}, broken)


def test_mindmap_outline_nesting():
    outline = mindmap_to_markdown({"title": "R", "children": [{"title": "A", "children": [{"title": "A1", "children": []}]}]})
    assert outline == "- R\n  - A\n    - A1"
