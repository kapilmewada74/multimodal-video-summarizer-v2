"""Generating flashcards, quiz, mind map or slides with the user's own documents as extra material."""
import io

import pytest

import samples
from apiutil import ready_video
from conftest import set_env
from summarizer.features.outputs import service as outputs_service

FLASH = {"flashcards": [{"front": "Q", "back": "A", "tag": "t"}], "provider": ""}


@pytest.fixture()
def seen(monkeypatch):
    """Records the summary text each generation received."""
    calls = []

    def fake(kind, title, summary, transcript, params):
        calls.append({"kind": kind, "summary": summary})
        return dict(FLASH)

    monkeypatch.setattr(outputs_service, "_generate", fake)
    return calls


def attach(api, user, video, name="notes.txt", content=b"The secret keyword is zebra-quartz."):
    res = api.client.post("/api/documents", headers=user.headers, data={"video_id": video},
                          files={"file": (name, io.BytesIO(content), "text/plain")})
    assert res.status_code == 201, res.text
    return res.json()


def open_with_docs(api, user, video, kind="flashcards", **body):
    return api.client.post(f"/api/videos/{video}/outputs/{kind}", headers=user.headers, json={"use_documents": True, **body})


def test_documents_reach_the_ai_and_the_result_says_which_were_used(api, tmp_path, seen):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    attach(api, user, video)
    res = open_with_docs(api, user, video)
    assert res.status_code == 200, res.text
    assert res.json()["used_documents"] == ["notes.txt"]
    assert "zebra-quartz" in seen[0]["summary"] and "[notes.txt]" in seen[0]["summary"]


def test_result_is_private_and_never_enters_the_shared_cache(api, tmp_path, seen):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path, 1)
    api.submit(bob, 1)
    attach(api, alice, video)
    assert open_with_docs(api, alice, video).status_code == 200
    assert api.sql("select count(*) from video_outputs")[0][0] == 0  # nothing shared
    assert api.sql("select count(*) from user_outputs where user_id = %s", (alice.id,))[0][0] == 1
    plain = api.client.post(f"/api/videos/{video}/outputs/flashcards", headers=bob.headers, json=None)
    assert plain.status_code == 200
    assert "used_documents" not in plain.json()  # bob gets the normal version
    assert len(seen) == 2 and "zebra-quartz" not in seen[1]["summary"]


def test_opening_again_is_free_and_regenerate_counts(api, tmp_path, seen, monkeypatch):
    set_env(monkeypatch, GENERATION_DAILY_LIMIT="2")
    user = api.user()
    video = ready_video(api, user, tmp_path)
    attach(api, user, video)
    assert open_with_docs(api, user, video).status_code == 200
    assert open_with_docs(api, user, video).status_code == 200
    assert len(seen) == 1  # second open served from storage
    assert open_with_docs(api, user, video, force=True).status_code == 200
    assert open_with_docs(api, user, video, force=True).status_code == 429  # third generation today
    assert len(seen) == 2


def test_needs_a_document_with_readable_text(api, tmp_path, seen):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = open_with_docs(api, user, video)
    assert res.status_code == 409 and res.json()["code"] == "no_documents"
    attach(api, user, video, "pic.png", samples.PNG)  # an image has no readable text
    assert open_with_docs(api, user, video).json()["code"] == "no_documents"
    assert seen == []


def test_only_my_own_documents_on_this_video_are_used(api, tmp_path, seen):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path, 1)
    other = ready_video(api, alice, tmp_path, 2)
    api.submit(bob, 1)
    attach(api, bob, video, "bob.txt", b"bobs-private-words")
    attach(api, alice, other, "elsewhere.txt", b"attached-to-other-video")
    assert open_with_docs(api, alice, video).json()["code"] == "no_documents"
    assert open_with_docs(api, bob, video).status_code == 200
    assert "bobs-private-words" in seen[0]["summary"] and "attached-to-other-video" not in seen[0]["summary"]


def test_context_is_bounded_and_every_document_gets_a_share(api, tmp_path, seen):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    attach(api, user, video, "big.txt", b"A" * 100_000)
    attach(api, user, video, "second.txt", b"BBBB second file words")
    res = open_with_docs(api, user, video)
    assert res.json()["used_documents"] == ["big.txt", "second.txt"]
    extra = seen[0]["summary"]
    assert extra.count("A") <= outputs_service.MAX_PER_DOCUMENT_CHARS + 50
    assert "BBBB second file words" in extra


def test_build_context_trims_and_skips_empty():
    docs = [{"filename": "a.txt", "extracted_text": "x " * 20_000}, {"filename": "e.txt", "extracted_text": "   "},
            {"filename": "b.txt", "extracted_text": "tail"}]
    text, used = outputs_service.build_context(docs)
    assert used == ["a.txt", "b.txt"] and len(text) < outputs_service.MAX_CONTEXT_CHARS + 100
    assert outputs_service.build_context([]) == ("", [])


def test_each_kind_can_use_documents(api, tmp_path, monkeypatch):
    kinds = []

    def fake(kind, title, summary, transcript, params):
        kinds.append(kind)
        return {"flashcards": FLASH, "quiz": {"quiz": [], "provider": ""}, "mindmap": {"title": "T", "children": [], "provider": ""},
                "slides": {"title": "D", "slides": [], "provider": ""}}[kind]

    monkeypatch.setattr(outputs_service, "_generate", fake)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    attach(api, user, video)
    for kind in ("flashcards", "quiz", "mindmap", "slides"):
        assert open_with_docs(api, user, video, kind).status_code == 200
    assert kinds == ["flashcards", "quiz", "mindmap", "slides"]


def test_other_users_cannot_use_my_video(api, tmp_path, seen):
    alice, carol = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    attach(api, alice, video)
    assert open_with_docs(api, carol, video).status_code == 404


def test_removing_the_document_does_not_leave_a_leak_on_the_shared_side(api, tmp_path, seen):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    doc = attach(api, user, video)
    open_with_docs(api, user, video)
    api.client.delete(f"/api/documents/{doc['id']}", headers=user.headers)
    assert api.sql("select count(*) from video_outputs")[0][0] == 0
