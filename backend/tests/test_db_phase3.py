"""Phase 3 database tests: study time, streaks, goals, progress, playlists, notifications."""
import threading
import uuid

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row

from test_db_schema import add_user, as_admin, as_user, make_ready_video

MIN = 600  # seconds of study that make a day count for the streak


@pytest.fixture()
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
        yield c


def start_session(conn, uid, video=None, seconds_ago=0):
    sid = conn.execute(
        "insert into study_sessions (user_id, video_id, last_heartbeat_at) "
        "values (%s, %s, now() - make_interval(secs => %s)) returning id", (uid, video, seconds_ago)).fetchone()["id"]
    return sid


def heartbeat(conn, uid, sid, active=True, cap=45):
    return conn.execute("select * from record_heartbeat(%s, %s, %s, %s)", (uid, sid, active, cap)).fetchone()


def add_day(conn, uid, days_ago, seconds=MIN, tz="UTC"):
    conn.execute(
        "insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone %s)::date - %s, %s) "
        "on conflict (user_id, day) do update set seconds = excluded.seconds", (uid, tz, days_ago, seconds))


def streak(conn, uid):
    return conn.execute("select * from streak_info(%s, %s)", (uid, MIN)).fetchone()


# ------------------------------------------------------------ study time

def test_server_measures_the_time_and_credits_it_to_today(conn):
    uid = add_user(conn)
    sid = start_session(conn, uid, seconds_ago=20)
    result = heartbeat(conn, uid, sid)
    assert 19 <= result["credited"] <= 21 and result["today_seconds"] == result["credited"]
    assert conn.execute("select active_seconds from study_sessions where id=%s", (sid,)).fetchone()["active_seconds"] == result["credited"]


def test_a_long_silence_is_capped_not_credited_in_full(conn):
    uid = add_user(conn)
    sid = start_session(conn, uid, seconds_ago=3600)  # the tab slept for an hour
    assert heartbeat(conn, uid, sid)["credited"] == 45


def test_inactive_heartbeats_credit_nothing_but_keep_the_session_alive(conn):
    uid = add_user(conn)
    sid = start_session(conn, uid, seconds_ago=30)
    assert heartbeat(conn, uid, sid, active=False)["credited"] == 0
    row = conn.execute("select last_heartbeat_at > now() - interval '5 seconds' as fresh from study_sessions where id=%s", (sid,)).fetchone()
    assert row["fresh"]
    assert conn.execute("select count(*) c from daily_stats").fetchone()["c"] == 0


def test_a_client_cannot_claim_more_time_than_passed(conn):
    uid = add_user(conn)
    sid = start_session(conn, uid)
    for _ in range(5):  # hammering the endpoint right away credits only the real time
        heartbeat(conn, uid, sid)
    assert conn.execute("select coalesce(sum(seconds), 0)::int s from daily_stats").fetchone()["s"] <= 1


def test_two_tabs_cannot_count_the_same_minutes_twice(conn):
    uid = add_user(conn)
    a, b = start_session(conn, uid, seconds_ago=30), start_session(conn, uid, seconds_ago=30)
    first, second = heartbeat(conn, uid, a), heartbeat(conn, uid, b)
    assert first["credited"] >= 29 and second["credited"] <= 1
    assert conn.execute("select seconds from daily_stats").fetchone()["seconds"] <= 32


def test_parallel_heartbeats_from_many_tabs_credit_the_time_only_once(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as admin:
        uid = add_user(admin)
        sessions = [start_session(admin, uid, seconds_ago=40) for _ in range(10)]
    results = []

    def worker(sid):
        with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
            results.append(heartbeat(c, uid, sid)["credited"])

    threads = [threading.Thread(target=worker, args=(s,)) for s in sessions]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert 39 <= sum(results) <= 42  # about 40 real seconds, not 400


def test_sessions_are_private_and_can_end(conn):
    alice, bob = add_user(conn), add_user(conn)
    sid = start_session(conn, alice)
    with pytest.raises(errors.RaiseException, match="session_not_found"):
        heartbeat(conn, bob, sid)
    with pytest.raises(errors.RaiseException, match="session_not_found"):
        heartbeat(conn, alice, uuid.uuid4())
    conn.execute("update study_sessions set ended_at = now() where id = %s", (sid,))
    with pytest.raises(errors.RaiseException, match="session_not_found"):
        heartbeat(conn, alice, sid)


def test_study_time_lands_on_the_users_local_day(conn):
    uid = add_user(conn)
    conn.execute("update profiles set timezone = 'Pacific/Kiritimati' where user_id = %s", (uid,))  # UTC+14
    heartbeat(conn, uid, start_session(conn, uid, seconds_ago=10))
    local = conn.execute("select (now() at time zone 'Pacific/Kiritimati')::date d").fetchone()["d"]
    assert conn.execute("select day from daily_stats").fetchone()["day"] == local


# ------------------------------------------------------------- streaks

def test_streak_counts_consecutive_completed_days(conn):
    uid = add_user(conn)
    for d in (1, 2, 3):
        add_day(conn, uid, d)
    s = streak(conn, uid)
    assert (s["current_streak"], s["longest_streak"], s["today_done"]) == (3, 3, False)  # today is still open
    add_day(conn, uid, 0)
    s = streak(conn, uid)
    assert (s["current_streak"], s["today_done"]) == (4, True)


def test_a_missed_day_ends_the_current_streak_but_not_the_longest(conn):
    uid = add_user(conn)
    for d in (1, 2, 5, 6, 7, 8):
        add_day(conn, uid, d)
    s = streak(conn, uid)
    assert (s["current_streak"], s["longest_streak"]) == (2, 4)


def test_streak_is_zero_when_yesterday_was_missed(conn):
    uid = add_user(conn)
    add_day(conn, uid, 2)
    add_day(conn, uid, 3)
    assert streak(conn, uid)["current_streak"] == 0
    assert streak(conn, uid)["longest_streak"] == 2


def test_days_below_the_minimum_do_not_count(conn):
    uid = add_user(conn)
    add_day(conn, uid, 1)
    add_day(conn, uid, 2, seconds=MIN - 1)
    add_day(conn, uid, 3)
    assert (streak(conn, uid)["current_streak"], streak(conn, uid)["longest_streak"]) == (1, 1)


def test_new_user_has_no_streak(conn):
    uid = add_user(conn)
    assert dict(streak(conn, uid)) == {"current_streak": 0, "longest_streak": 0, "today_seconds": 0, "today_done": False}


def test_streaks_are_per_user_and_use_the_users_timezone(conn):
    a, b = add_user(conn), add_user(conn)
    conn.execute("update profiles set timezone = 'Pacific/Kiritimati' where user_id = %s", (b,))
    add_day(conn, a, 1)
    add_day(conn, b, 1, tz="Pacific/Kiritimati")
    assert streak(conn, a)["current_streak"] == 1 and streak(conn, b)["current_streak"] == 1
    with pytest.raises(errors.RaiseException, match="profile_not_found"):
        streak(conn, uuid.uuid4())


def test_reminder_candidates(conn):
    streaking, done_today, no_streak, late = (add_user(conn) for _ in range(4))
    for uid in (streaking, done_today, late):
        conn.execute("update profiles set reminder_hour = 0 where user_id = %s", (uid,))
        add_day(conn, uid, 1)
    add_day(conn, done_today, 0)  # already studied today
    conn.execute("update profiles set reminder_hour = 0 where user_id = %s", (no_streak,))
    hour = conn.execute("select extract(hour from now() at time zone 'UTC')::int h").fetchone()["h"]
    if hour < 23:
        conn.execute("update profiles set reminder_hour = %s where user_id = %s", (hour + 1, late))  # not time yet

    found = {r["user_id"] for r in conn.execute("select * from streak_reminder_candidates(%s)", (MIN,)).fetchall()}
    assert streaking in found
    assert done_today not in found and no_streak not in found
    if hour < 23:
        assert late not in found
    row = conn.execute("select * from streak_reminder_candidates(%s) where user_id = %s", (MIN, streaking)).fetchone()
    assert row["current_streak"] == 1 and row["email"].endswith("@example.com")


# ------------------------------------------------- progress and completion

def test_video_completion_counts_once(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    assert [conn.execute("select mark_video_completed(%s, %s) r", (uid, video)).fetchone()["r"] for _ in range(3)] == [True, False, False]
    assert conn.execute("select videos_done from daily_stats").fetchone()["videos_done"] == 1
    other = add_user(conn)
    assert conn.execute("select mark_video_completed(%s, %s) r", (other, video)).fetchone()["r"] is False  # not in their library


def test_progress_must_not_be_negative(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    with pytest.raises(errors.CheckViolation):
        conn.execute("update user_videos set progress_seconds = -1 where user_id=%s and video_id=%s", (uid, video))


def test_quiz_attempts_are_recorded_and_counted(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    conn.execute("select record_quiz_attempt(%s, %s, 4, 5, 'hard')", (uid, video))
    conn.execute("select record_quiz_attempt(%s, %s, 5, 5, 'hard')", (uid, video))
    assert conn.execute("select quizzes_taken from daily_stats").fetchone()["quizzes_taken"] == 2
    with pytest.raises(errors.CheckViolation):
        conn.execute("select record_quiz_attempt(%s, %s, 6, 5, 'easy')", (uid, video))
    with pytest.raises(errors.CheckViolation):
        conn.execute("select record_quiz_attempt(%s, %s, 0, 0, 'easy')", (uid, video))


# ------------------------------------------------------------------ goals

def test_goal_rules(conn):
    uid = add_user(conn)
    conn.execute("insert into goals (user_id, type, target) values (%s, 'minutes', 30)", (uid,))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into goals (user_id, type, target) values (%s, 'minutes', 45)", (uid,))
    for bad in ("insert into goals (user_id, type, target) values ('{u}', 'minutes', 0)",
                "insert into goals (user_id, type, target) values ('{u}', 'videos', 5000)",
                "insert into goals (user_id, type, target) values ('{u}', 'bogus', 5)"):
        with pytest.raises(errors.CheckViolation):
            conn.execute(bad.format(u=uid))


# ---------------------------------------------------------------- notes

def test_notes_are_per_user_and_video_and_size_limited(conn):
    alice, bob = add_user(conn), add_user(conn)
    video = make_ready_video(conn, alice)
    conn.execute("insert into notes (user_id, video_id, content) values (%s, %s, 'mine')", (alice, video))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into notes (user_id, video_id, content) values (%s, %s, 'again')", (alice, video))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into notes (user_id, video_id, content) values (%s, %s, repeat('x', 200001))", (bob, video))


# ------------------------------------------------------------- playlists

def test_playlist_items_are_either_youtube_or_uploaded_never_both_or_neither(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid, 1)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, 'abcdefghijk', 'a')", (pl,))
    conn.execute("insert into playlist_items (playlist_id, video_id, position) values (%s, %s, 'b')", (pl, video))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into playlist_items (playlist_id, position) values (%s, 'c')", (pl,))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into playlist_items (playlist_id, youtube_id, video_id, position) values (%s, 'abcdefghijl', %s, 'c')", (pl, video))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, 'abcdefghijk', 'd')", (pl,))


def test_playlist_positions_sort_bytewise(conn):
    uid = add_user(conn)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    for pos, yt in (("a", "aaaaaaaaaaa"), ("B", "bbbbbbbbbbb"), ("Z", "ccccccccccc"), ("0", "ddddddddddd")):
        conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, %s, %s)", (pl, yt, pos))
    order = [r["position"] for r in conn.execute("select position from playlist_items order by position").fetchall()]
    assert order == ["0", "B", "Z", "a"]  # digits, then uppercase, then lowercase (not locale dependent)


def test_playlist_title_rules_and_cascade(conn):
    uid = add_user(conn)
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into playlists (user_id, title) values (%s, '')", (uid,))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into playlists (user_id, title) values (%s, repeat('x', 121))", (uid,))
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, 'abcdefghijk', 'a')", (pl,))
    conn.execute("delete from playlists where id = %s", (pl,))
    assert conn.execute("select count(*) c from playlist_items").fetchone()["c"] == 0


# --------------------------------------------------------- notifications

def test_notification_dedupe_key_allows_one_per_user(conn):
    alice, bob = add_user(conn), add_user(conn)
    sql = "insert into notifications (user_id, type, title, dedupe_key) values (%s, 'goal_reached', 't', 'goal:minutes:2026-11-10')"
    conn.execute(sql, (alice,))
    conn.execute(sql, (bob,))  # another user may have the same key
    with pytest.raises(errors.UniqueViolation):
        conn.execute(sql, (alice,))
    conn.execute("insert into notifications (user_id, type, title) values (%s, 'summary_ready', 'a')", (alice,))
    conn.execute("insert into notifications (user_id, type, title) values (%s, 'summary_ready', 'b')", (alice,))  # no key: unlimited


def test_notification_and_pref_values_are_restricted(conn):
    uid = add_user(conn)
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into notifications (user_id, type, title) values (%s, 'spam', 't')", (uid,))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into notification_prefs (user_id, channel, type, enabled) values (%s, 'sms', 'goal_reached', true)", (uid,))
    conn.execute("insert into notification_prefs (user_id, channel, type, enabled) values (%s, 'email', 'goal_reached', true)", (uid,))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into notification_prefs (user_id, channel, type, enabled) values (%s, 'email', 'goal_reached', false)", (uid,))


def test_profile_notification_settings_are_validated(conn):
    uid = add_user(conn)
    conn.execute("update profiles set reminder_hour = 8, quiet_start = 22, quiet_end = 7 where user_id = %s", (uid,))
    for bad in ("reminder_hour = 24", "quiet_start = -1", "quiet_end = 25"):
        with pytest.raises(errors.CheckViolation):
            conn.execute(f"update profiles set {bad} where user_id = %s", (uid,))


# ----------------------------------------------------------- security

@pytest.mark.parametrize("statement", [
    "insert into daily_stats (user_id, day, seconds) values ('{u}', (now() at time zone 'UTC')::date, 99999)",
    "update daily_stats set seconds = 99999",
    "insert into goals (user_id, type, target) values ('{u}', 'minutes', 5)",
    "update goals set target = 1",
    "insert into notes (user_id, video_id, content) values ('{u}', gen_random_uuid(), 'x')",
    "insert into playlists (user_id, title) values ('{u}', 'x')",
    "update notifications set read_at = now()",
    "delete from notifications",
    "insert into notification_prefs (user_id, channel, type, enabled) values ('{u}', 'email', 'goal_reached', true)",
    "select * from push_subscriptions",
    "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ('{u}', 'https://x', 'k', 'a')",
    "insert into study_sessions (user_id) values ('{u}')",
    "update user_videos set progress_seconds = 5",
    "update user_videos set completed_at = now()",
    "select * from record_heartbeat('{u}', gen_random_uuid(), true, 45)",
    "select mark_video_completed('{u}', gen_random_uuid())",
    "select record_quiz_attempt('{u}', gen_random_uuid(), 1, 1, 'easy')",
    "select * from streak_info('{u}', 600)",
    "select * from streak_reminder_candidates(600)",
])
def test_browser_roles_cannot_write_study_data_or_call_internal_functions(conn, statement):
    uid = add_user(conn)
    make_ready_video(conn, uid)
    conn.execute("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date, 5)", (uid,))
    conn.execute("insert into goals (user_id, type, target) values (%s, 'videos', 3)", (uid,))
    conn.execute("insert into notifications (user_id, type, title) values (%s, 'summary_ready', 't')", (uid,))
    conn.execute("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (%s, 'https://e', 'k', 'a')", (uid,))
    before = conn.execute("select seconds from daily_stats").fetchone()["seconds"]
    as_user(conn, uid)
    try:
        cur = conn.execute(statement.format(u=uid))
        assert cur.rowcount in (0, -1) or statement.startswith("select")
    except (errors.InsufficientPrivilege, errors.UndefinedFunction):
        pass
    as_admin(conn)
    assert conn.execute("select seconds from daily_stats").fetchone()["seconds"] == before
    assert conn.execute("select count(*) c from user_videos where progress_seconds = 0 and completed_at is null").fetchone()["c"] == 1
    assert conn.execute("select read_at from notifications").fetchone()["read_at"] is None


def test_users_read_only_their_own_study_data(conn):
    alice, bob = add_user(conn), add_user(conn)
    video = make_ready_video(conn, alice)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (alice,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, 'abcdefghijk', 'a')", (pl,))
    conn.execute("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date, 5)", (alice,))
    conn.execute("insert into goals (user_id, type, target) values (%s, 'videos', 3)", (alice,))
    conn.execute("insert into notes (user_id, video_id, content) values (%s, %s, 'private')", (alice, video))
    conn.execute("insert into notifications (user_id, type, title) values (%s, 'summary_ready', 't')", (alice,))
    conn.execute("insert into notification_prefs (user_id, channel, type, enabled) values (%s, 'email', 'goal_reached', true)", (alice,))
    start_session(conn, alice)
    conn.execute("select record_quiz_attempt(%s, %s, 1, 1, 'easy')", (alice, video))
    tables = ["daily_stats", "goals", "notes", "notifications", "notification_prefs", "playlists", "playlist_items",
              "study_sessions", "quiz_attempts"]
    as_user(conn, alice)
    for table in tables:
        assert len(conn.execute(f"select * from {table}").fetchall()) == 1, table
    as_admin(conn)
    as_user(conn, bob)
    for table in tables:
        assert conn.execute(f"select * from {table}").fetchall() == [], table


def test_users_cannot_change_reminder_settings_or_the_credit_marker_directly(conn):
    uid = add_user(conn)
    as_user(conn, uid)
    for column in ("reminder_hour = 3", "quiet_start = 1", "study_credited_until = now()"):
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(f"update profiles set {column} where user_id = %s", (uid,))
        as_admin(conn)
        as_user(conn, uid)


def test_deleting_a_user_removes_all_their_study_data(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, 'abcdefghijk', 'a')", (pl,))
    conn.execute("insert into daily_stats (user_id, day, seconds) values (%s, (now() at time zone 'UTC')::date, 5)", (uid,))
    conn.execute("insert into goals (user_id, type, target) values (%s, 'videos', 3)", (uid,))
    conn.execute("insert into notes (user_id, video_id, content) values (%s, %s, 'x')", (uid, video))
    conn.execute("insert into notifications (user_id, type, title) values (%s, 'summary_ready', 't')", (uid,))
    conn.execute("insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (%s, 'https://e', 'k', 'a')", (uid,))
    start_session(conn, uid)
    conn.execute("delete from auth.users where id = %s", (uid,))
    for table in ("daily_stats", "goals", "notes", "notifications", "push_subscriptions", "playlists", "playlist_items", "study_sessions"):
        assert conn.execute(f"select count(*) c from {table}").fetchone()["c"] == 0, table


# ------------------------------------------------ documents and device uploads

def add_document(conn, uid, video=None, sha="a" * 64, name="notes.pdf", size=10):
    return conn.execute(
        "insert into documents (user_id, video_id, filename, extension, mime, size_bytes, sha256, storage_key) "
        "values (%s, %s, %s, 'pdf', 'application/pdf', %s, %s, 'documents/k') returning id", (uid, video, name, size, sha)).fetchone()["id"]


def add_upload(conn, uid, sha="b" * 64, size=100):
    return conn.execute(
        "insert into video_uploads (user_id, filename, mime, size_bytes, sha256, storage_key) "
        "values (%s, 'lecture.mp4', 'video/mp4', %s, %s, 'uploads/k') returning id", (uid, size, sha)).fetchone()["id"]


def test_the_same_file_cannot_be_added_twice_to_the_same_place(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    add_document(conn, uid, video)
    with pytest.raises(errors.UniqueViolation):
        add_document(conn, uid, video)
    # Loose files (rows of their own in a playlist) are de-duplicated per playlist by the API, not by the database.
    add_document(conn, uid, None)
    add_document(conn, uid, None)
    other = make_ready_video(conn, uid, 2)
    add_document(conn, uid, other)            # same file on another video is fine
    add_document(conn, add_user(conn))        # and another user may have the same file


def test_the_same_file_cannot_be_added_twice_to_one_lesson(conn):
    uid = add_user(conn)
    playlist = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    items = [conn.execute("insert into playlist_items (playlist_id, youtube_id, position) values (%s, %s, %s) returning id",
                          (playlist, f"yt{n:09d}"[:11], f"a{n}")).fetchone()["id"] for n in (1, 2)]
    attach = lambda item: conn.execute(
        "insert into documents (user_id, playlist_item_id, filename, extension, mime, size_bytes, sha256, storage_key) "
        "values (%s, %s, 'a.pdf', 'pdf', 'application/pdf', 5, %s, 'k') returning id", (uid, item, "c" * 64)).fetchone()["id"]
    attach(items[0])
    with pytest.raises(errors.UniqueViolation):
        attach(items[0])
    attach(items[1])                          # the same file on another lesson is fine


def test_a_playlist_item_has_exactly_one_source_including_files(conn):
    uid = add_user(conn)
    playlist = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    doc = add_document(conn, uid)
    conn.execute("insert into playlist_items (playlist_id, document_id, position) values (%s, %s, 'a1')", (playlist, doc))
    with pytest.raises(errors.CheckViolation):   # two sources
        conn.execute("insert into playlist_items (playlist_id, youtube_id, document_id, position) values (%s, 'abcdefghijk', %s, 'a2')",
                     (playlist, doc))
    with pytest.raises(errors.CheckViolation):   # no source
        conn.execute("insert into playlist_items (playlist_id, position) values (%s, 'a3')", (playlist,))
    # deleting the file removes its row
    conn.execute("delete from documents where id = %s", (doc,))
    assert conn.execute("select count(*) c from playlist_items where playlist_id = %s", (playlist,)).fetchone()["c"] == 0


def test_document_limits_and_constraints(conn):
    uid = add_user(conn)
    for bad in (dict(size=0), dict(name=""), dict(name="x" * 201), dict(sha="short")):
        with pytest.raises(errors.CheckViolation):
            add_document(conn, uid, **bad)


def test_deleting_a_video_keeps_its_documents_as_standalone(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    doc = add_document(conn, uid, video)
    conn.execute("delete from videos where id = %s", (video,))
    assert conn.execute("select video_id from documents where id = %s", (doc,)).fetchone()["video_id"] is None


def test_storage_used_adds_documents_and_uploads(conn):
    uid = add_user(conn)
    add_document(conn, uid, size=1000)
    add_document(conn, uid, sha="c" * 64, size=500)
    add_upload(conn, uid, size=4000)
    add_user(conn)
    assert conn.execute("select storage_used(%s) s", (uid,)).fetchone()["s"] == 5500
    assert conn.execute("select storage_used(%s) s", (add_user(conn),)).fetchone()["s"] == 0


def test_playlist_item_has_exactly_one_source_including_uploads(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    upload = add_upload(conn, uid)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, upload_id, position) values (%s, %s, 'a')", (pl, upload))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into playlist_items (playlist_id, upload_id, position) values (%s, %s, 'b')", (pl, upload))
    combos = [
        ("youtube_id, upload_id", ("abcdefghijk", upload)),
        ("video_id, upload_id", (video, upload)),
        ("youtube_id, video_id", ("abcdefghijl", video)),
    ]
    for columns, values in combos:
        with pytest.raises(errors.CheckViolation):
            conn.execute(f"insert into playlist_items (playlist_id, {columns}, position) values (%s, %s, %s, 'c')", (pl, *values))
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into playlist_items (playlist_id, position) values (%s, 'd')", (pl,))


def test_deleting_an_upload_removes_its_playlist_item(conn):
    uid = add_user(conn)
    upload = add_upload(conn, uid)
    pl = conn.execute("insert into playlists (user_id, title) values (%s, 'P') returning id", (uid,)).fetchone()["id"]
    conn.execute("insert into playlist_items (playlist_id, upload_id, position) values (%s, %s, 'a')", (pl, upload))
    conn.execute("delete from video_uploads where id = %s", (upload,))
    assert conn.execute("select count(*) c from playlist_items").fetchone()["c"] == 0


def test_users_read_their_own_documents_but_never_the_storage_key_or_text(conn):
    alice, bob = add_user(conn), add_user(conn)
    add_document(conn, alice)
    add_upload(conn, alice)
    conn.execute("update documents set extracted_text = 'secret text'")
    as_user(conn, alice)
    assert conn.execute("select filename from documents").fetchone()["filename"] == "notes.pdf"
    assert conn.execute("select filename from video_uploads").fetchone()["filename"] == "lecture.mp4"
    for query in ("select storage_key from documents", "select extracted_text from documents",
                  "select sha256 from documents", "select storage_key from video_uploads"):
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(query)
        as_admin(conn)
        as_user(conn, alice)
    as_admin(conn)
    as_user(conn, bob)
    assert conn.execute("select id from documents").fetchall() == []
    assert conn.execute("select id from video_uploads").fetchall() == []


@pytest.mark.parametrize("statement", [
    "insert into documents (user_id, filename, extension, mime, size_bytes, sha256, storage_key) values ('{u}', 'x', 'pdf', 'a/b', 1, repeat('d', 64), 'k')",
    "update documents set filename = 'hacked'", "delete from documents",
    "insert into video_uploads (user_id, filename, mime, size_bytes, sha256, storage_key) values ('{u}', 'x', 'a/b', 1, repeat('d', 64), 'k')",
    "update video_uploads set filename = 'hacked'", "delete from video_uploads", "select storage_used('{u}')",
])
def test_browser_roles_cannot_write_documents_or_uploads(conn, statement):
    uid = add_user(conn)
    add_document(conn, uid)
    add_upload(conn, uid)
    as_user(conn, uid)
    with pytest.raises((errors.InsufficientPrivilege, errors.UndefinedFunction)):
        conn.execute(statement.format(u=uid))
