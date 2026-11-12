"""Pomodoros, recent sessions, time per video and the week view."""
from apiutil import ready_video


def start(api, user, video=None):
    body = {"video_id": video} if video else None
    return api.client.post("/api/study/sessions", headers=user.headers, json=body).json()["id"]


def pomodoro(api, user, sid):
    return api.client.post(f"/api/study/sessions/{sid}/pomodoro", headers=user.headers)


def age_last_pomodoro(api, sid, seconds=600):
    api.sql("update study_sessions set last_pomodoro_at = now() - make_interval(secs => %s) where id = %s", (seconds, sid))


def set_active(api, sid, seconds):
    api.sql("update study_sessions set active_seconds = %s where id = %s", (seconds, sid))


# ------------------------------------------------------------------ pomodoros

def test_a_finished_focus_block_is_counted_for_today_and_the_session(api):
    user = api.user()
    sid = start(api, user)
    res = pomodoro(api, user, sid)
    assert res.status_code == 200 and res.json() == {"counted": True, "today": 1}
    assert api.sql("select pomodoros from study_sessions where id = %s", (sid,))[0][0] == 1
    today = api.client.get("/api/study/overview", headers=user.headers).json()["today"]
    assert today["pomodoros"] == 1


def test_blocks_must_be_minutes_apart_so_a_script_cannot_inflate_the_count(api):
    user = api.user()
    sid = start(api, user)
    assert pomodoro(api, user, sid).json()["counted"] is True
    assert pomodoro(api, user, sid).json() == {"counted": False, "today": None}      # straight away: ignored
    age_last_pomodoro(api, sid, 600)
    assert pomodoro(api, user, sid).json() == {"counted": True, "today": 2}
    assert api.sql("select pomodoros from study_sessions where id = %s", (sid,))[0][0] == 2


def test_there_is_a_daily_cap_and_a_refused_block_is_not_counted_on_the_session(api):
    user = api.user()
    sid = start(api, user)
    for _ in range(48):
        age_last_pomodoro(api, sid)
        assert pomodoro(api, user, sid).json()["counted"] is True
    age_last_pomodoro(api, sid)
    assert pomodoro(api, user, sid).json()["counted"] is False
    assert api.sql("select pomodoros from study_sessions where id = %s", (sid,))[0][0] == 48
    assert api.client.get("/api/study/overview", headers=user.headers).json()["today"]["pomodoros"] == 48


def test_only_your_own_open_session_can_count_pomodoros(api):
    alice, bob = api.user(), api.user()
    sid = start(api, alice)
    assert pomodoro(api, bob, sid).json()["counted"] is False
    assert pomodoro(api, alice, "not-a-uuid").status_code == 404
    api.client.post(f"/api/study/sessions/{sid}/end", headers=alice.headers)
    assert pomodoro(api, alice, sid).json()["counted"] is False                  # ended sessions do not count
    assert api.client.post(f"/api/study/sessions/{sid}/pomodoro").status_code in (401, 403)


def test_pomodoros_show_per_day_in_the_overview(api):
    user = api.user()
    sid = start(api, user)
    pomodoro(api, user, sid)
    days = api.client.get("/api/study/overview?days=3", headers=user.headers).json()["days"]
    assert [d["pomodoros"] for d in days] == [0, 0, 1]


# ------------------------------------------------------------------ sessions and time per video

def test_recent_sessions_list_only_real_study_newest_first_with_titles(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path, 1)
    first, second, empty = start(api, user, video), start(api, user), start(api, user)
    set_active(api, first, 900)
    set_active(api, second, 120)
    api.sql("update study_sessions set started_at = now() - interval '1 hour' where id = %s", (first,))
    items = api.client.get("/api/study/sessions", headers=user.headers).json()["items"]
    assert [i["id"] for i in items] == [second, first]                  # the empty one is left out; newest first
    assert items[1]["seconds"] == 900 and items[1]["title"] and items[1]["video_id"] == video
    assert items[0]["title"] is None and items[0]["video_id"] is None
    assert empty not in [i["id"] for i in items]
    assert len(api.client.get("/api/study/sessions?limit=1", headers=user.headers).json()["items"]) == 1
    assert api.client.get("/api/study/sessions?limit=0", headers=user.headers).status_code == 422


def test_sessions_are_private(api, tmp_path):
    alice, bob = api.user(), api.user()
    sid = start(api, alice)
    set_active(api, sid, 300)
    assert api.client.get("/api/study/sessions", headers=bob.headers).json()["items"] == []
    assert api.client.get("/api/study/videos", headers=bob.headers).json()["items"] == []


def test_time_per_video_adds_up_sessions_and_ranks_them(api, tmp_path):
    user = api.user()
    v1, v2 = ready_video(api, user, tmp_path, 1), ready_video(api, user, tmp_path, 2)
    for video, seconds in ((v1, 300), (v1, 400), (v2, 1000)):
        set_active(api, start(api, user, video), seconds)
    set_active(api, start(api, user), 5000)                                # not tied to a video: not listed here
    items = api.client.get("/api/study/videos", headers=user.headers).json()["items"]
    assert [(i["video_id"], i["seconds"], i["sessions"]) for i in items] == [(v2, 1000, 1), (v1, 700, 2)]


def test_time_per_video_respects_the_window(api, tmp_path):
    user = api.user()
    video = ready_video(api, user, tmp_path, 1)
    sid = start(api, user, video)
    set_active(api, sid, 600)
    api.sql("update study_sessions set started_at = now() - interval '40 days' where id = %s", (sid,))
    assert api.client.get("/api/study/videos?days=30", headers=user.headers).json()["items"] == []
    assert len(api.client.get("/api/study/videos?days=60", headers=user.headers).json()["items"]) == 1


# ------------------------------------------------------------------ the week and the streak details

def test_the_overview_has_the_week_and_streak_details(api):
    user = api.user()
    data = api.client.get("/api/study/overview", headers=user.headers).json()
    assert len(data["week"]) == 7
    assert sum(1 for d in data["week"] if d["is_today"]) == 1
    assert data["week"][0]["day"] <= data["week"][6]["day"]
    streak = data["streak"]
    assert streak["freeze_available"] is True and streak["at_risk"] is False and streak["frozen_days"] == []


def test_the_overview_applies_the_streak_rules_to_the_real_daily_totals(api):
    from datetime import datetime, timedelta, timezone

    from summarizer.features.study.streaks import compute_streak

    user = api.user()
    studied = (1, 3, 4, 5)                                      # a gap two days ago
    for ago in studied:
        api.sql("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date - %s, 700)", (user.id, ago))
    today = datetime.now(timezone.utc).date()
    expected = compute_streak({today - timedelta(days=a): 700 for a in studied}, today, 600)
    streak = api.client.get("/api/study/overview", headers=user.headers).json()["streak"]
    assert streak["current"] == expected["current"] and streak["longest"] == expected["longest"]
    assert streak["frozen_days"] == [d.isoformat() for d in expected["frozen_days"]]
    assert streak["freeze_available"] == expected["freeze_available"]
    week = api.client.get("/api/study/overview", headers=user.headers).json()["week"]
    frozen_in_week = {d["day"] for d in week if d["frozen"]}
    assert frozen_in_week <= set(streak["frozen_days"])
