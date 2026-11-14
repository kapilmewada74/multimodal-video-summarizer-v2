"""Who can change what when flashcards, quizzes, mind maps and slides are regenerated.

The shared copy is made once and nobody can overwrite it; "Regenerate" makes a personal copy; guests cannot
regenerate; staff can remove a bad shared copy (see test_admin_catalog).
"""
import itertools

import pytest

from apiutil import ready_video
from conftest import set_env
from summarizer.features.outputs import service as outputs_service


@pytest.fixture()
def numbered_ai(monkeypatch):
    """Every generation returns different flashcards (card 1, card 2, ...), so a test can tell which copy it got."""
    counter = itertools.count(1)
    calls = []

    def fake(kind, title, summary, transcript, params):
        n = next(counter)
        calls.append(n)
        if kind == "flashcards":
            return {"flashcards": [{"front": f"card {n}", "back": "b", "tag": "t"}], "provider": ""}
        return {"title": f"{kind} {n}", "slides": [], "children": [], "provider": ""}

    monkeypatch.setattr(outputs_service, "_generate", fake)
    return calls


def open_output(api, user, video, kind="flashcards", **body):
    return api.client.post(f"/api/videos/{video}/outputs/{kind}", headers=user.headers, json=body or None)


def front(response):
    return response.json()["flashcards"][0]["front"]


def two_people_with_one_video(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    api.submit(bob, 1)   # same video: Bob gets it in his library too
    return alice, bob, video


def test_regenerating_never_changes_what_other_people_see(api, tmp_path, numbered_ai):
    alice, bob, video = two_people_with_one_video(api, tmp_path)
    assert front(open_output(api, alice, video)) == "card 1"            # Alice opened it first: the shared copy
    assert front(open_output(api, alice, video, force=True)) == "card 2"
    assert front(open_output(api, bob, video)) == "card 1"              # Bob still sees the shared one
    assert open_output(api, bob, video).json().get("personal") is None


def test_the_personal_copy_is_what_the_person_sees_from_then_on(api, tmp_path, numbered_ai):
    alice, bob, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video)
    open_output(api, alice, video, force=True)
    again = open_output(api, alice, video)
    assert front(again) == "card 2" and again.json()["personal"] is True
    assert len(numbered_ai) == 2   # opening is free: no third generation


def test_switching_back_to_the_shared_copy(api, tmp_path, numbered_ai):
    alice, _, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video)
    open_output(api, alice, video, force=True)
    res = api.client.delete(f"/api/videos/{video}/outputs/flashcards", headers=alice.headers)
    assert res.status_code == 200 and res.json() == {"reset": True}
    assert front(open_output(api, alice, video)) == "card 1"
    assert api.client.delete(f"/api/videos/{video}/outputs/flashcards", headers=alice.headers).json() == {"reset": False}


def test_a_stranger_cannot_reset_or_regenerate_a_video_they_do_not_have(api, tmp_path, numbered_ai):
    alice, _, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video)
    stranger = api.user()
    assert open_output(api, stranger, video, force=True).status_code == 404
    assert api.client.delete(f"/api/videos/{video}/outputs/flashcards", headers=stranger.headers).status_code == 404
    assert len(numbered_ai) == 1


def test_force_before_any_shared_copy_exists_just_makes_the_shared_copy(api, tmp_path, numbered_ai):
    alice, bob, video = two_people_with_one_video(api, tmp_path)
    first = open_output(api, alice, video, force=True)
    assert front(first) == "card 1" and first.json().get("personal") is None
    assert front(open_output(api, bob, video)) == "card 1"
    assert api.sql("select count(*) from user_outputs")[0][0] == 0


def test_guests_cannot_regenerate_but_can_read_the_shared_copy(api, tmp_path, numbered_ai):
    guest = api.guest()
    video = ready_video(api, guest, tmp_path)
    assert front(open_output(api, guest, video)) == "card 1"
    res = open_output(api, guest, video, force=True)
    assert res.status_code == 403 and res.json()["code"] == "account_required"
    assert len(numbered_ai) == 1


def test_regenerating_is_rate_limited_per_item_and_per_hour(api, tmp_path, numbered_ai, monkeypatch):
    alice, _, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video)
    assert open_output(api, alice, video, force=True).status_code == 200
    quick = open_output(api, alice, video, force=True)    # the same item again straight away
    assert quick.status_code == 429 and quick.json()["code"] == "slow_down"

    monkeypatch.setattr(outputs_service, "REGENERATE_SAME_OUTPUT_SECONDS", 0)  # now only the hourly cap is left
    from summarizer.shared import throttle
    throttle.reset()
    ok = 0
    for _ in range(outputs_service.REGENERATE_PER_HOUR + 2):
        ok += open_output(api, alice, video, force=True).status_code == 200
    assert ok == outputs_service.REGENERATE_PER_HOUR


def test_regenerating_counts_toward_the_daily_generation_limit(api, tmp_path, numbered_ai, monkeypatch):
    set_env(monkeypatch, GENERATION_DAILY_LIMIT="2")
    alice, _, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video)                                     # generation 1
    assert open_output(api, alice, video, force=True).status_code == 200   # generation 2
    monkeypatch.setattr(outputs_service, "REGENERATE_SAME_OUTPUT_SECONDS", 0)
    blocked = open_output(api, alice, video, force=True)
    assert blocked.status_code == 429 and blocked.json()["code"] == "generation_limit_reached"
    assert front(open_output(api, alice, video)) == "card 2"           # reading still works


def test_the_personal_copy_is_stored_under_its_own_tag(api, tmp_path, numbered_ai):
    alice, bob, video = two_people_with_one_video(api, tmp_path)
    open_output(api, alice, video, "mindmap")
    assert api.sql("select count(*) from video_outputs")[0][0] == 1
    open_output(api, alice, video, "mindmap", force=True)
    rows = api.sql("select variant from user_outputs")
    assert [r[0] for r in rows] == ["@mine"]
