"""Study sessions, goals, streaks, progress and quiz attempts through the real API."""
import types
import uuid

import pytest

from apiutil import age_session, ready_video, study
from conftest import set_env
from summarizer.features.notifications import delivery


@pytest.fixture(autouse=True)
def inline_delivery(monkeypatch):
    """Run external deliveries (email/push) inline and record them instead of sending."""
    monkeypatch.setattr(delivery, "_submit", lambda func, *args: func(*args))
    sent = {"email": [], "push": []}
    # Replace the channels only inside the delivery module, so the real email/push code stays testable.
    monkeypatch.setattr(delivery, "email_channel",
                        types.SimpleNamespace(send_notification_email=lambda *a: sent["email"].append(a) or True))
    monkeypatch.setattr(delivery, "push_channel",
                        types.SimpleNamespace(send_to_subscription=lambda *a: sent["push"].append(a) or True))
    return sent


def notifications(api, user, ignore_summary=True):
    data = api.client.get("/api/notifications", headers=user.headers).json()
    if ignore_summary:  # processing a video also creates a "summary ready" notice
        data["items"] = [i for i in data["items"] if i["type"] != "summary_ready"]
        data["unread"] = len(data["items"])
    return data


def set_goals(api, user, *goals):
    return api.client.put("/api/study/goals", headers=user.headers, json={"goals": list(goals)})


# ------------------------------------------------------------------ sessions

def test_session_lifecycle(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    started = api.client.post("/api/study/sessions", headers=user.headers, json={"video_id": video})
    assert started.status_code == 200
    sid = started.json()["id"]
    age_session(api, sid, 20)
    beat = api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=user.headers, json={"active": True}).json()
    assert 19 <= beat["credited"] <= 21 and beat["today"]["seconds"] == beat["credited"]
    assert api.client.post(f"/api/study/sessions/{sid}/end", headers=user.headers).status_code == 204
    assert api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=user.headers, json={"active": True}).status_code == 404


def test_session_without_a_video_and_default_body(api):
    user = api.user()
    assert api.client.post("/api/study/sessions", headers=user.headers).status_code == 200
    assert api.client.post("/api/study/sessions", headers=user.headers, json={}).status_code == 200


def test_session_for_someone_elses_video_is_refused(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    assert api.client.post("/api/study/sessions", headers=bob.headers, json={"video_id": video}).status_code == 404
    assert api.client.post("/api/study/sessions", headers=bob.headers, json={"video_id": "nope"}).status_code == 404


def test_you_cannot_use_or_end_someone_elses_session(api):
    alice, bob = api.user(), api.user()
    sid = api.client.post("/api/study/sessions", headers=alice.headers).json()["id"]
    assert api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=bob.headers, json={"active": True}).status_code == 404
    api.client.post(f"/api/study/sessions/{sid}/end", headers=bob.headers)
    assert api.sql("select ended_at is null from study_sessions where id = %s", (sid,))[0][0] is True  # still running
    assert api.client.post(f"/api/study/sessions/{uuid.uuid4()}/heartbeat", headers=alice.headers, json={"active": True}).status_code == 404
    assert api.client.post("/api/study/sessions/not-a-uuid/heartbeat", headers=alice.headers, json={"active": True}).status_code == 404


def test_idle_heartbeats_credit_nothing(api):
    user = api.user()
    sid = api.client.post("/api/study/sessions", headers=user.headers).json()["id"]
    age_session(api, sid, 30)
    beat = api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=user.headers, json={"active": False}).json()
    assert beat["credited"] == 0 and beat["today"]["seconds"] == 0


def test_a_sleeping_tab_cannot_claim_hours(api):
    assert study(api, api.user(), 7200)["credited"] == 45


def test_time_is_credited_once_across_tabs(api):
    user = api.user()
    a = api.client.post("/api/study/sessions", headers=user.headers).json()["id"]
    b = api.client.post("/api/study/sessions", headers=user.headers).json()["id"]
    age_session(api, a, 30)
    age_session(api, b, 30)
    first = api.client.post(f"/api/study/sessions/{a}/heartbeat", headers=user.headers, json={"active": True}).json()
    second = api.client.post(f"/api/study/sessions/{b}/heartbeat", headers=user.headers, json={"active": True}).json()
    assert first["credited"] >= 29 and second["credited"] <= 1


def test_heartbeat_body_is_validated(api):
    user = api.user()
    sid = api.client.post("/api/study/sessions", headers=user.headers).json()["id"]
    assert api.client.post(f"/api/study/sessions/{sid}/heartbeat", headers=user.headers, json={"active": "maybe"}).status_code == 422


# ---------------------------------------------------------- overview and goals

def test_overview_for_a_new_user(api):
    data = api.client.get("/api/study/overview", headers=api.user().headers).json()
    assert data["today"] == {"seconds": 0, "videos_done": 0, "quizzes_taken": 0, "pomodoros": 0}
    assert data["goals"] == [] and data["streak"]["current"] == 0 and data["streak"]["longest"] == 0
    assert len(data["days"]) == 14 and all(d["seconds"] == 0 for d in data["days"])
    assert data["days"] == sorted(data["days"], key=lambda d: d["day"])


def test_overview_days_parameter(api):
    user = api.user()
    assert len(api.client.get("/api/study/overview?days=7", headers=user.headers).json()["days"]) == 7
    for bad in ("days=0", "days=91"):
        assert api.client.get(f"/api/study/overview?{bad}", headers=user.headers).status_code == 422


def test_overview_shows_todays_study_in_the_last_day(api):
    user = api.user()
    study(api, user, 40)
    data = api.client.get("/api/study/overview", headers=user.headers).json()
    assert data["days"][-1]["seconds"] == data["today"]["seconds"] >= 39


def test_goals_can_be_saved_updated_and_show_progress(api):
    user = api.user()
    res = set_goals(api, user, {"type": "minutes", "target": 30}, {"type": "videos", "target": 2, "active": True})
    assert res.status_code == 200
    goals = {g["type"]: g for g in res.json()["goals"]}
    assert goals["minutes"] == {"type": "minutes", "target": 30, "progress": 0, "unit": "min", "done": False, "active": True}
    assert goals["videos"]["target"] == 2
    again = set_goals(api, user, {"type": "minutes", "target": 45, "active": False}).json()["goals"]
    assert {g["type"]: g for g in again}["minutes"]["target"] == 45 and {g["type"]: g for g in again}["minutes"]["active"] is False
    assert api.sql("select count(*) from goals where user_id = %s", (user.id,))[0][0] == 2


@pytest.mark.parametrize("body", [
    {"goals": [{"type": "minutes", "target": 0}]}, {"goals": [{"type": "minutes", "target": 1441}]},
    {"goals": [{"type": "sleep", "target": 5}]}, {"goals": [{"type": "minutes", "target": 5}, {"type": "minutes", "target": 6}]},
    {"goals": [{"type": "minutes", "target": "lots"}]},
])
def test_invalid_goals_are_rejected(api, body):
    user = api.user()
    assert api.client.put("/api/study/goals", headers=user.headers, json=body).status_code in (400, 422)
    assert api.sql("select count(*) from goals")[0][0] == 0


def test_goals_are_private(api):
    alice, bob = api.user(), api.user()
    set_goals(api, alice, {"type": "minutes", "target": 10})
    assert api.client.get("/api/study/overview", headers=bob.headers).json()["goals"] == []


def test_minutes_goal_progress_and_completion(api):
    user = api.user()
    set_goals(api, user, {"type": "minutes", "target": 1})
    first = study(api, user, 30)
    assert first["goals"][0]["done"] is False and first["goals"][0]["progress"] == 0
    second = study(api, user, 40)
    assert second["goals"][0]["done"] is True and second["goals"][0]["progress"] == 1


# ------------------------------------------------------------ notifications from goals

def test_reaching_a_goal_sends_one_notification_per_day(api):
    user = api.user()
    set_goals(api, user, {"type": "minutes", "target": 1})
    study(api, user, 30)
    assert notifications(api, user)["unread"] == 0
    study(api, user, 40)
    data = notifications(api, user)
    assert data["unread"] == 1 and data["items"][0]["type"] == "goal_reached"
    study(api, user, 40)  # more study the same day: no second notification
    assert notifications(api, user)["unread"] == 1


def test_inactive_goals_do_not_notify(api):
    user = api.user()
    set_goals(api, user, {"type": "minutes", "target": 1, "active": False})
    study(api, user, 45)
    study(api, user, 45)
    assert notifications(api, user)["items"] == []


def test_goal_notification_can_also_go_to_email_when_enabled(api, inline_delivery):
    user = api.user()
    api.client.put("/api/notifications/settings", headers=user.headers, json={"prefs": {"goal_reached": {"email": True}}})
    set_goals(api, user, {"type": "minutes", "target": 1})
    study(api, user, 45)
    study(api, user, 45)
    assert len(inline_delivery["email"]) == 1 and inline_delivery["email"][0][0] == f"{user.id}@example.com"


# ----------------------------------------------------------------- streaks

def seed_days(api, user, days, seconds=600):
    for d in days:
        api.sql("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date - %s, %s) "
                "on conflict (user_id, day) do update set seconds = excluded.seconds", (user.id, d, seconds))


def test_streak_in_the_overview(api):
    user = api.user()
    seed_days(api, user, [1, 2, 3, 6, 7])
    streak = api.client.get("/api/study/overview", headers=user.headers).json()["streak"]
    assert streak == {"current": 3, "longest": 3, "today_done": False, "min_seconds": 600,
                      "freeze_available": True, "at_risk": False, "frozen_days": []}


def test_streak_minimum_is_configurable(api, monkeypatch):
    set_env(monkeypatch, STREAK_MIN_SECONDS="60")
    user = api.user()
    seed_days(api, user, [1, 2], seconds=120)
    assert api.client.get("/api/study/overview", headers=user.headers).json()["streak"]["current"] == 2


def test_three_day_streak_milestone_notification(api):
    user = api.user()
    seed_days(api, user, [1, 2])
    study(api, user, 45)  # today is below the minimum: no milestone yet
    assert notifications(api, user)["items"] == []
    api.sql("update daily_stats set seconds = 590 where user_id = %s and day = (now() at time zone 'UTC')::date", (user.id,))
    study(api, user, 45)  # crosses the 10-minute minimum: streak becomes 3
    items = notifications(api, user)["items"]
    assert [i["type"] for i in items] == ["streak_milestone"] and "3-day" in items[0]["title"]


# ------------------------------------------------------- progress and completion

def test_progress_is_saved_and_returned(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    res = api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 42})
    assert res.status_code == 200 and res.json() == {"saved": True, "completed": False}
    detail = api.client.get(f"/api/videos/{video}", headers=user.headers).json()
    assert detail["progress_seconds"] == 42 and detail["completed"] is False
    item = api.client.get("/api/videos", headers=user.headers).json()["items"][0]
    assert item["progress_seconds"] == 42 and item["completed"] is False


def test_finishing_a_video_counts_once(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)  # 120 seconds long
    set_goals(api, user, {"type": "videos", "target": 1})
    assert api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 107}).json()["completed"] is False
    done = api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 110}).json()
    assert done["completed"] is True
    again = api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 119}).json()
    assert again["completed"] is False  # already counted
    assert api.client.get("/api/study/overview", headers=user.headers).json()["today"]["videos_done"] == 1
    assert api.client.get(f"/api/videos/{video}", headers=user.headers).json()["completed"] is True
    assert [n["type"] for n in notifications(api, user)["items"]] == ["goal_reached"]


def test_the_client_can_supply_the_duration_when_the_server_does_not_know_it(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    api.sql("update videos set duration_seconds = 0")
    res = api.client.put(f"/api/videos/{video}/progress", headers=user.headers, json={"position_seconds": 95, "duration_seconds": 100})
    assert res.json()["completed"] is True


def test_progress_validation_and_ownership(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    assert api.client.put(f"/api/videos/{video}/progress", headers=bob.headers, json={"position_seconds": 5}).status_code == 404
    assert api.client.put("/api/videos/nope/progress", headers=alice.headers, json={"position_seconds": 5}).status_code == 404
    for body in ({"position_seconds": -1}, {"position_seconds": 10**9}, {"position_seconds": "x"}, {}):
        assert api.client.put(f"/api/videos/{video}/progress", headers=alice.headers, json=body).status_code == 422
    assert api.sql("select progress_seconds from user_videos where user_id = %s", (alice.id,))[0][0] == 0


def test_two_users_have_independent_progress_on_the_same_video(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    api.submit(bob, 1)
    api.client.put(f"/api/videos/{video}/progress", headers=alice.headers, json={"position_seconds": 100})
    assert api.client.get(f"/api/videos/{video}", headers=bob.headers).json()["progress_seconds"] == 0


# ---------------------------------------------------------------- quiz attempts

def test_quiz_attempts_count_toward_goals(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    set_goals(api, user, {"type": "quizzes", "target": 1})
    res = api.client.post(f"/api/videos/{video}/quiz-attempts", headers=user.headers, json={"score": 4, "total": 5, "difficulty": "hard"})
    assert res.status_code == 204
    assert api.client.get("/api/study/overview", headers=user.headers).json()["today"]["quizzes_taken"] == 1
    assert [n["type"] for n in notifications(api, user)["items"]] == ["goal_reached"]
    assert api.sql("select score, total, difficulty from quiz_attempts")[0] == (4, 5, "hard")


@pytest.mark.parametrize("body", [{"score": 6, "total": 5}, {"score": -1, "total": 5}, {"score": 0, "total": 0},
                                  {"score": 1, "total": 5, "difficulty": "impossible"}, {"score": 101, "total": 101}])
def test_invalid_quiz_attempts_are_rejected(api, tmp_path, body):
    user = api.user()
    video = ready_video(api, user, tmp_path)
    assert api.client.post(f"/api/videos/{video}/quiz-attempts", headers=user.headers, json=body).status_code in (400, 422)
    assert api.sql("select count(*) from quiz_attempts")[0][0] == 0


def test_quiz_attempt_needs_my_video(api, tmp_path):
    alice, bob = api.user(), api.user()
    video = ready_video(api, alice, tmp_path)
    assert api.client.post(f"/api/videos/{video}/quiz-attempts", headers=bob.headers, json={"score": 1, "total": 1}).status_code == 404


def test_all_study_endpoints_need_a_session(api):
    for method, path in [("post", "/api/study/sessions"), ("get", "/api/study/overview"), ("put", "/api/study/goals"),
                         ("put", f"/api/videos/{uuid.uuid4()}/progress"), ("post", f"/api/videos/{uuid.uuid4()}/quiz-attempts"),
                         ("get", f"/api/videos/{uuid.uuid4()}/notes"), ("get", "/api/playlists"), ("get", "/api/notifications")]:
        assert getattr(api.client, method)(path).status_code == 401, path
