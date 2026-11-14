"""Library, per-video outputs (lazy generation, shared cache, daily cap) and mind maps."""
import threading
import uuid

import pytest

from apiutil import ready_video
from conftest import set_env
from summarizer.features.mindmaps import service as mindmaps
from summarizer.features.outputs import service as outputs_service
from summarizer.shared.llm import LLMResult, LLMUnavailable

FLASH = {"flashcards": [{"front": "What?", "back": "That.", "tag": "t"}], "provider": ""}
QUIZ = {"quiz": [{"question": "Q?", "options": ["a", "b", "c", "d"], "answerIndex": 1, "explanation": "e"}],
        "provider": "", "difficulty": "medium"}
MAP = {"title": "Topic", "children": [{"title": "Branch", "children": []}], "provider": ""}
SLIDES = {"title": "Deck", "slides": [{"title": "One", "bullets": ["a"]}], "provider": ""}


@pytest.fixture()
def fake_ai(monkeypatch):
    """Replace the AI generators; records every call."""
    calls = []

    def fake(kind, title, summary, transcript, params):
        calls.append((kind, dict(params)))
        data = {"flashcards": FLASH, "quiz": {**QUIZ, "difficulty": params["difficulty"]},
                "mindmap": MAP, "slides": SLIDES}[kind]
        return dict(data)

    monkeypatch.setattr(outputs_service, "_generate", fake)
    return calls


def open_output(api, user, video_id, kind, **body):
    return api.client.post(f"/api/videos/{video_id}/outputs/{kind}", headers=user.headers, json=body or None)


# ------------------------------------------------------------------- library

def test_library_lists_only_my_videos_newest_first(api, tmp_path):
    alice, bob = api.user(), api.user()
    first = ready_video(api, alice, tmp_path, 1)
    second = ready_video(api, alice, tmp_path, 2)
    ready_video(api, bob, tmp_path, 3)

    body = api.client.get("/api/videos", headers=alice.headers).json()
    assert body["total"] == 2
    assert [v["id"] for v in body["items"]] == [second, first]
    item = body["items"][0]
    assert item["title"] == "Test Video" and item["status"] == "ready" and item["has_summary"] is True
    assert item["source"] == "youtube" and item["youtube_id"] and item["duration"] == 120


def test_library_pagination_and_validation(api, tmp_path):
    user = api.user()
    for n in range(3):
        ready_video(api, user, tmp_path, n)
    page = api.client.get("/api/videos?limit=2&offset=0", headers=user.headers).json()
    assert len(page["items"]) == 2 and page["total"] == 3
    assert len(api.client.get("/api/videos?limit=2&offset=2", headers=user.headers).json()["items"]) == 1
    for query in ("limit=0", "limit=101", "offset=-1"):
        assert api.client.get(f"/api/videos?{query}", headers=user.headers).status_code == 422


def test_library_shows_videos_that_are_still_processing(api):
    user = api.user()
    api.submit(user, 1)
    item = api.client.get("/api/videos", headers=user.headers).json()["items"][0]
    assert item["status"] == "pending" and item["has_summary"] is False and item["title"] is None


def test_video_detail_has_everything_the_workspace_needs(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    detail = api.client.get(f"/api/videos/{video}", headers=user.headers).json()
    assert detail["title"] == "Test Video" and "It works." in detail["summary"]
    assert detail["transcript"] == "hello world transcript" and detail["youtube_id"]
    assert detail["outputs"] == [] and detail["share"] == {"active": False, "token": None}
    open_output(api, user, video, "mindmap")
    assert api.client.get(f"/api/videos/{video}", headers=user.headers).json()["outputs"] == ["mindmap"]


def test_unfinished_video_detail_has_no_summary_yet(api):
    user = api.user()
    job = api.submit(user, 1).json()
    video = api.client.get(f"/api/job/{job['job_id']}", headers=user.headers).json()["video_id"]
    detail = api.client.get(f"/api/videos/{video}", headers=user.headers).json()
    assert detail["status"] == "pending" and detail["summary"] is None and detail["transcript"] is None


def test_you_cannot_open_someone_elses_video(api, tmp_path, fake_ai):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    for method, path in [("get", f"/api/videos/{video}"), ("delete", f"/api/videos/{video}"),
                         ("post", f"/api/videos/{video}/outputs/quiz"), ("post", f"/api/videos/{video}/share"),
                         ("get", f"/api/videos/{video}/export.md")]:
        assert getattr(api.client, method)(path, headers=bob.headers).status_code == 404
    assert fake_ai == []
    assert api.client.get("/api/videos/not-a-uuid", headers=alice.headers).status_code == 404


def test_removing_a_video_only_affects_my_library(api, tmp_path, fake_ai):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    api.submit(bob, 1)  # Bob adds the same video (cache hit)
    token = api.client.post(f"/api/videos/{video}/share", headers=alice.headers).json()["token"]

    assert api.client.delete(f"/api/videos/{video}", headers=alice.headers).status_code == 204
    assert api.client.delete(f"/api/videos/{video}", headers=alice.headers).status_code == 404
    assert api.client.get("/api/videos", headers=alice.headers).json()["total"] == 0
    assert api.client.get("/api/videos", headers=bob.headers).json()["total"] == 1  # Bob still has it
    assert api.client.get(f"/api/public/{token}").status_code == 404  # Alice's link stopped working
    # Removing a video does not give back the day's slot.
    assert api.client.get("/api/me/usage", headers=alice.headers).json()["used"] == 1


# ------------------------------------------------------------------- outputs

@pytest.mark.parametrize("kind", ["flashcards", "quiz", "mindmap", "slides"])
def test_first_open_generates_and_later_opens_are_free(api, tmp_path, fake_ai, kind):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    first = open_output(api, user, video, kind)
    second = open_output(api, user, video, kind)
    assert first.status_code == 200 and first.json() == second.json()
    assert len(fake_ai) == 1  # the AI ran once
    assert api.sql("select count from generation_usage")[0][0] == 1  # and only the first open was counted


def test_everyone_with_the_video_shares_one_generated_copy(api, tmp_path, fake_ai):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    open_output(api, alice, video, "flashcards")
    api.submit(bob, 1)
    res = open_output(api, bob, video, "flashcards")
    assert res.status_code == 200 and res.json()["flashcards"][0]["front"] == "What?"
    assert len(fake_ai) == 1
    assert api.sql("select count(*) from generation_usage where user_id = %s", (bob.id,))[0][0] == 0  # Bob paid nothing


def test_quiz_variants_are_stored_separately(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    easy = open_output(api, user, video, "quiz", difficulty="easy", num_questions=3).json()
    hard = open_output(api, user, video, "quiz", difficulty="hard", num_questions=3).json()
    again = open_output(api, user, video, "quiz", difficulty="easy", num_questions=3).json()
    assert easy["difficulty"] == "easy" and hard["difficulty"] == "hard" and again == easy
    assert [c[1]["difficulty"] for c in fake_ai] == ["easy", "hard"]
    assert api.sql("select count(*) from video_outputs where kind = 'quiz'")[0][0] == 2


def test_force_makes_a_personal_copy_and_never_touches_the_shared_one(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    open_output(api, user, video, "mindmap")
    again = open_output(api, user, video, "mindmap", force=True)
    assert again.status_code == 200 and again.json()["personal"] is True
    assert len(fake_ai) == 2
    assert api.sql("select count from generation_usage")[0][0] == 2   # regenerating costs a generation
    assert api.sql("select count(*) from video_outputs")[0][0] == 1   # the shared copy is still the only one
    assert api.sql("select count(*) from user_outputs")[0][0] == 1    # the new one belongs to the person


def test_invalid_requests(api, tmp_path, fake_ai):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert open_output(api, user, video, "bogus").status_code == 422
    assert open_output(api, user, video, "quiz", difficulty="impossible").status_code == 422
    assert open_output(api, user, video, "quiz", num_questions=99).status_code == 422
    assert open_output(api, user, video, "quiz", num_questions=0).status_code == 422
    assert fake_ai == []


def test_outputs_need_a_finished_video(api, fake_ai):
    user = api.user()
    job = api.submit(user, 1).json()
    video = api.client.get(f"/api/job/{job['job_id']}", headers=user.headers).json()["video_id"]
    res = open_output(api, user, video, "quiz")
    assert res.status_code == 409 and res.json()["code"] == "video_not_ready"
    assert fake_ai == []


def test_daily_generation_cap_blocks_new_generations_but_not_existing_ones(api, tmp_path, fake_ai, monkeypatch):
    set_env(monkeypatch, GENERATION_DAILY_LIMIT="2")
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert open_output(api, user, video, "flashcards").status_code == 200
    assert open_output(api, user, video, "mindmap").status_code == 200
    blocked = open_output(api, user, video, "slides")
    assert blocked.status_code == 429 and blocked.json()["code"] == "generation_limit_reached"
    assert open_output(api, user, video, "flashcards").status_code == 200  # already generated: still free
    assert [c[0] for c in fake_ai] == ["flashcards", "mindmap"]


def test_cap_is_per_user(api, tmp_path, fake_ai, monkeypatch):
    set_env(monkeypatch, GENERATION_DAILY_LIMIT="1")
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    api.submit(bob, 1)
    assert open_output(api, alice, video, "flashcards").status_code == 200
    assert open_output(api, alice, video, "mindmap").status_code == 429
    assert open_output(api, bob, video, "mindmap").status_code == 200


def test_fallback_results_are_shown_but_not_stored_or_shared(api, tmp_path, monkeypatch):
    calls = []

    def fake(kind, title, summary, transcript, params):
        calls.append(kind)
        return {"flashcards": [{"front": "f", "back": "b"}], "provider": "Rule-based fallback"}

    monkeypatch.setattr(outputs_service, "_generate", fake)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert open_output(api, user, video, "flashcards").json()["provider"] == "Rule-based fallback"
    assert api.sql("select count(*) from video_outputs")[0][0] == 0
    open_output(api, user, video, "flashcards")
    assert len(calls) == 2  # the AI is tried again next time


def test_unexpected_errors_do_not_leak_details(api, tmp_path, monkeypatch):
    def boom(*args, **kwargs):
        raise RuntimeError("secret internal path /Users/someone/key")

    monkeypatch.setattr(outputs_service, "_generate", boom)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = open_output(api, user, video, "quiz")
    assert res.status_code == 500 and "secret" not in res.text


def test_concurrent_requests_for_the_same_output_generate_it_once(api, tmp_path, monkeypatch):
    calls = []
    started = threading.Event()

    def slow(kind, title, summary, transcript, params):
        calls.append(kind)
        started.wait(0.3)
        return dict(MAP)

    monkeypatch.setattr(outputs_service, "_generate", slow)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    results = []

    def request():
        results.append(outputs_service.get_or_generate(user.id, video, "mindmap"))

    threads = [threading.Thread(target=request) for _ in range(6)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(calls) == 1 and len(results) == 6 and all(r == results[0] for r in results)
    assert api.sql("select count from generation_usage")[0][0] == 1


# ------------------------------------------------------------ mind map logic

class FakeChain:
    def __init__(self, text=None, fail=False):
        self.text, self.fail = text, fail

    def complete(self, prompt, **kwargs):
        if self.fail:
            raise LLMUnavailable("none")
        return LLMResult(self.text, "Fake", "m")


def test_mindmap_limits_are_enforced():
    deep = {"title": "root", "children": [{"title": "a", "children": [{"title": "b", "children": [
        {"title": "c", "children": [{"title": "d", "children": [{"title": "too deep", "children": []}]}]}]}]}]}
    result = mindmaps.sanitize_mindmap(deep)

    def depth(node):
        return 1 + max((depth(c) for c in node["children"]), default=0)

    assert depth(result) <= mindmaps.MAX_DEPTH + 1

    wide = {"title": "root", "children": [{"title": f"branch {i}", "children": []} for i in range(50)]}
    assert len(mindmaps.sanitize_mindmap(wide)["children"]) == mindmaps.MAX_CHILDREN

    huge = {"title": "root", "children": [{"title": f"b{i}", "children": [
        {"title": f"c{i}{j}", "children": []} for j in range(8)]} for i in range(8)]}
    def count(node):
        return 1 + sum(count(c) for c in node["children"])
    assert count(mindmaps.sanitize_mindmap(huge)) <= mindmaps.MAX_NODES


def test_mindmap_titles_are_trimmed_and_cleaned():
    result = mindmaps.sanitize_mindmap({"title": "  - Root  ", "children": [
        {"title": "x" * 500, "children": []}, {"title": "", "children": []}, {"title": None}, "junk", 5]})
    assert result["title"] == "Root"
    assert len(result["children"]) == 1 and len(result["children"][0]["title"]) <= mindmaps.MAX_TITLE_CHARS


@pytest.mark.parametrize("garbage", [None, "text", [], 42, {"title": ""}, {"children": "nope"}])
def test_mindmap_survives_garbage_input(garbage):
    result = mindmaps.sanitize_mindmap(garbage, default_title="Fallback title")
    assert result["title"] and result["children"]


def test_mindmap_from_ai_reply_and_fallbacks():
    good = FakeChain('{"title": "T", "children": [{"title": "A", "children": [{"title": "A1"}]}]}')
    data = mindmaps.generate_mindmap("Video", "summary", good)
    assert data["title"] == "T" and data["children"][0]["children"][0]["title"] == "A1"
    assert mindmaps.generate_mindmap("Video", "s", FakeChain("not json at all"))["children"]

    summary = "## 1. Main Topic\nx\n## 2. Concepts\n- Term: meaning\n- Other point\n"
    fallback = mindmaps.generate_mindmap("Video", summary, FakeChain(fail=True))
    assert fallback["provider"] == "Rule-based fallback" and fallback["title"] == "Video"
    assert [c["title"] for c in fallback["children"]] == ["Main Topic", "Concepts"]
    assert [c["title"] for c in fallback["children"][1]["children"]] == ["Term", "Other point"]


def test_mindmap_titles_with_markup_stay_plain_text_data():
    result = mindmaps.sanitize_mindmap({"title": "<img src=x onerror=alert(1)>", "children": []})
    assert "<img" in result["title"]  # kept as text; the UI never renders it as HTML (see frontend tests)


def test_unknown_output_kind_is_rejected_by_the_service():
    from summarizer.core.errors import AppError
    with pytest.raises(AppError):
        outputs_service.get_or_generate(str(uuid.uuid4()), str(uuid.uuid4()), "nope")


def test_no_database_connection_is_held_while_the_ai_is_working(api, tmp_path, monkeypatch):
    """A slow generation must not use up the connection pool for everyone else."""
    from summarizer.core.db import get_pool

    seen = {}

    def slow_generate(kind, title, summary, transcript, params):
        stats = get_pool().get_stats()
        seen["checked_out"] = stats["pool_size"] - stats["pool_available"]
        return dict(MAP)

    monkeypatch.setattr(outputs_service, "_generate", slow_generate)
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert open_output(api, user, video, "mindmap").status_code == 200
    assert seen["checked_out"] == 0


def test_many_slow_generations_do_not_starve_other_requests(api, tmp_path, monkeypatch):
    """More simultaneous generations than the pool has connections: the API still answers."""
    release = threading.Event()
    entered = []

    def blocked(kind, title, summary, transcript, params):
        entered.append(1)
        release.wait(60)  # blocks until the test lets go (never times out by itself)
        return dict(MAP)

    monkeypatch.setattr(outputs_service, "_generate", blocked)
    users = [api.user() for _ in range(12)]
    videos = [ready_video(api, u, tmp_path, i + 1) for i, u in enumerate(users)]

    threads = [threading.Thread(target=open_output, args=(api, u, v, "mindmap"), daemon=True)
               for u, v in zip(users, videos)]
    try:
        for t in threads:
            t.start()
        waiter = threading.Event()
        for _ in range(60):  # up to 3 seconds
            if len(entered) == 12:
                break
            waiter.wait(0.05)
        # All twelve are generating at once, although the pool only has 10 connections...
        assert len(entered) == 12
        # ...and a different request is still served meanwhile.
        assert api.client.get("/api/me/usage", headers=users[0].headers).status_code == 200
    finally:
        release.set()
        for t in threads:
            t.join(timeout=10)
