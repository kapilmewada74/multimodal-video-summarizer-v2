"""Database tests: schema, row level security, limits and the job queue.

They run against a real throwaway PostgreSQL server with the same migrations
that are applied to Supabase.
"""
import threading
import uuid

import psycopg
import pytest
from psycopg import errors
from psycopg.rows import dict_row



@pytest.fixture()
def conn(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
        yield c


def add_user(conn, anonymous=False):
    uid = uuid.uuid4()
    conn.execute(
        "insert into auth.users (id, email, is_anonymous) values (%s, %s, %s)",
        (uid, None if anonymous else f"{uid}@example.com", anonymous),
    )
    return uid


def as_user(conn, uid, role="authenticated"):
    """Act like the browser: a restricted role plus the JWT subject."""
    conn.execute(f"set role {role}")
    conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (str(uid or ""),))


def as_admin(conn):
    conn.execute("reset role")


def enqueue(conn, uid, n=0, source="youtube"):
    if source == "youtube":
        return conn.execute(
            "select * from enqueue_ingest(%s, 'youtube', %s, %s, null, 'educational')",
            (uid, f"https://youtu.be/vid{n:08d}", f"vid{n:08d}"),
        ).fetchone()
    return conn.execute(
        "select * from enqueue_ingest(%s, 'upload', %s, null, %s, 'educational')",
        (uid, f"uploads/{n}.mp4", f"hash{n:08d}"),
    ).fetchone()


# ---------------------------------------------------------------- profiles

def test_new_auth_user_gets_a_profile(conn):
    uid = add_user(conn)
    profile = conn.execute("select * from profiles where user_id = %s", (uid,)).fetchone()
    assert profile["daily_video_limit"] == 10
    assert profile["timezone"] == "UTC"
    assert profile["is_anonymous"] is False


def test_guest_profile_is_flagged_and_follows_account_linking(conn):
    uid = add_user(conn, anonymous=True)
    assert conn.execute("select is_anonymous from profiles where user_id=%s", (uid,)).fetchone()["is_anonymous"]
    # Linking Google flips is_anonymous; the user id (and all data) stays.
    conn.execute("update auth.users set is_anonymous = false, email = 'a@b.c' where id = %s", (uid,))
    assert not conn.execute("select is_anonymous from profiles where user_id=%s", (uid,)).fetchone()["is_anonymous"]


def test_invalid_timezone_is_rejected(conn):
    uid = add_user(conn)
    with pytest.raises(errors.RaiseException):
        conn.execute("update profiles set timezone = 'Mars/Phobos' where user_id = %s", (uid,))
    conn.execute("update profiles set timezone = 'Asia/Kolkata' where user_id = %s", (uid,))


def test_deleting_a_user_removes_their_data(conn):
    uid = add_user(conn)
    enqueue(conn, uid, 1)
    conn.execute("delete from auth.users where id = %s", (uid,))
    assert conn.execute("select count(*) c from profiles").fetchone()["c"] == 0
    assert conn.execute("select count(*) c from jobs").fetchone()["c"] == 0
    assert conn.execute("select count(*) c from user_videos").fetchone()["c"] == 0


# --------------------------------------------------- row level security

def test_users_only_see_their_own_rows(conn):
    alice, bob = add_user(conn), add_user(conn)
    job_a = enqueue(conn, alice, 1)
    enqueue(conn, bob, 2)
    # Shared data for Alice's video.
    conn.execute("insert into transcripts (video_id, text) values (%s, 'alice transcript')", (job_a["video_id"],))
    conn.execute("insert into summaries (video_id, content_md) values (%s, 'alice summary')", (job_a["video_id"],))

    as_user(conn, alice)
    assert {r["user_id"] for r in conn.execute("select user_id from profiles").fetchall()} == {alice}
    assert [r["user_id"] for r in conn.execute("select user_id from jobs").fetchall()] == [alice]
    assert len(conn.execute("select * from user_videos").fetchall()) == 1
    assert len(conn.execute("select * from videos").fetchall()) == 1
    assert len(conn.execute("select * from transcripts").fetchall()) == 1
    assert len(conn.execute("select * from summaries").fetchall()) == 1

    as_user(conn, bob)
    assert conn.execute("select * from transcripts").fetchall() == []
    assert conn.execute("select * from summaries").fetchall() == []
    assert [r["user_id"] for r in conn.execute("select user_id from jobs").fetchall()] == [bob]


def test_shared_video_is_visible_to_each_user_who_added_it(conn):
    alice, bob = add_user(conn), add_user(conn)
    job_a = enqueue(conn, alice, 1)
    conn.execute("update videos set status = 'ready' where id = %s", (job_a["video_id"],))
    conn.execute("insert into summaries (video_id, content_md) values (%s, 's')", (job_a["video_id"],))
    enqueue(conn, bob, 1)  # same video: cache hit
    as_user(conn, bob)
    assert len(conn.execute("select * from summaries").fetchall()) == 1


def test_anonymous_role_sees_nothing(conn):
    uid = add_user(conn)
    enqueue(conn, uid, 1)
    as_user(conn, None, role="anon")
    for table in ("profiles", "jobs", "videos", "user_videos", "transcripts", "summaries"):
        with pytest.raises(errors.InsufficientPrivilege):
            conn.execute(f"select * from {table}")
        as_admin(conn)
        as_user(conn, None, role="anon")


def test_user_cannot_raise_their_own_limit_but_can_set_timezone(conn):
    uid = add_user(conn)
    as_user(conn, uid)
    with pytest.raises(errors.InsufficientPrivilege):
        conn.execute("update profiles set daily_video_limit = 9999 where user_id = %s", (uid,))
    as_admin(conn)
    as_user(conn, uid)
    conn.execute("update profiles set timezone = 'Asia/Kolkata', display_name = 'Rahul' where user_id = %s", (uid,))
    as_admin(conn)
    row = conn.execute("select * from profiles where user_id = %s", (uid,)).fetchone()
    assert (row["timezone"], row["display_name"], row["daily_video_limit"]) == ("Asia/Kolkata", "Rahul", 10)


def test_user_cannot_edit_someone_elses_profile(conn):
    alice, bob = add_user(conn), add_user(conn)
    as_user(conn, alice)
    cur = conn.execute("update profiles set display_name = 'hacked' where user_id = %s", (bob,))
    assert cur.rowcount == 0


@pytest.mark.parametrize("statement", [
    "insert into jobs (user_id, source, source_ref) values ('{uid}', 'youtube', 'x')",
    "insert into videos (source, youtube_id) values ('youtube', 'abcdefghijk')",
    "insert into transcripts (video_id, text) values (gen_random_uuid(), 'x')",
    "update jobs set status = 'completed'",
    "delete from jobs",
    "select * from ip_usage",
    "select * from enqueue_ingest('{uid}', 'youtube', 'u', 'abcdefghijk', null, 'educational')",
    "select * from claim_next_job('hacker')",
    "select bump_ip_usage('x')",
    "select requeue_stale_jobs('1 second')",
    "select * from usage_today('{uid}')",
])
def test_browser_roles_cannot_write_or_call_internal_functions(conn, statement):
    uid = add_user(conn)
    enqueue(conn, uid, 1)
    as_user(conn, uid)
    with pytest.raises((errors.InsufficientPrivilege, errors.UndefinedFunction)):
        conn.execute(statement.format(uid=uid))


def test_user_can_remove_a_video_from_their_library(conn):
    uid = add_user(conn)
    enqueue(conn, uid, 1)
    as_user(conn, uid)
    assert conn.execute("delete from user_videos").rowcount == 1


# ------------------------------------------------------------ daily limit

def test_limit_of_ten_videos_per_day(conn):
    uid = add_user(conn)
    for i in range(10):
        enqueue(conn, uid, i)
    with pytest.raises(errors.RaiseException, match="daily_limit_reached"):
        enqueue(conn, uid, 99)
    usage = conn.execute("select * from usage_today(%s)", (uid,)).fetchone()
    assert (usage["used"], usage["daily_limit"]) == (10, 10)


def test_limit_applies_to_guests_and_accounts_alike(conn):
    guest = add_user(conn, anonymous=True)
    for i in range(10):
        enqueue(conn, guest, i)
    with pytest.raises(errors.RaiseException, match="daily_limit_reached"):
        enqueue(conn, guest, 50)
    conn.execute("update auth.users set is_anonymous = false where id = %s", (guest,))
    with pytest.raises(errors.RaiseException, match="daily_limit_reached"):
        enqueue(conn, guest, 51)  # signing in does not reset today's count


def test_limit_is_per_user(conn):
    alice, bob = add_user(conn), add_user(conn)
    for i in range(10):
        enqueue(conn, alice, i)
    enqueue(conn, bob, 100)  # Bob is unaffected


def test_system_failures_refund_the_slot_but_user_errors_do_not(conn):
    uid = add_user(conn)
    j1, j2 = enqueue(conn, uid, 1), enqueue(conn, uid, 2)
    conn.execute("update jobs set status='failed', error_kind='system' where id=%s", (j1["id"],))
    conn.execute("update jobs set status='failed', error_kind='user' where id=%s", (j2["id"],))
    assert conn.execute("select used from usage_today(%s)", (uid,)).fetchone()["used"] == 1


def test_limit_can_be_changed_per_user_by_an_admin(conn):
    uid = add_user(conn)
    conn.execute("update profiles set daily_video_limit = 2 where user_id = %s", (uid,))
    enqueue(conn, uid, 1)
    enqueue(conn, uid, 2)
    with pytest.raises(errors.RaiseException, match="daily_limit_reached"):
        enqueue(conn, uid, 3)


def test_day_boundary_follows_the_users_timezone(conn):
    uid = add_user(conn)
    conn.execute("update profiles set timezone = 'Pacific/Kiritimati' where user_id = %s", (uid,))  # UTC+14
    for i in range(3):
        enqueue(conn, uid, i)
    # Move two of the jobs to 30 hours ago: always before today's start.
    conn.execute("update jobs set created_at = now() - interval '30 hours' where id in "
                 "(select id from jobs order by created_at limit 2)")
    usage = conn.execute("select * from usage_today(%s)", (uid,)).fetchone()
    assert usage["used"] == 1
    assert 0 < (usage["resets_at"] - conn.execute("select now() n").fetchone()["n"]).total_seconds() <= 86400


def test_unknown_profile_is_an_error(conn):
    with pytest.raises(errors.RaiseException, match="profile_not_found"):
        enqueue(conn, uuid.uuid4(), 1)


def test_parallel_requests_cannot_exceed_the_limit(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as admin:
        uid = add_user(admin)
    results = []

    def worker(n):
        with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
            try:
                enqueue(c, uid, n)
                results.append("ok")
            except errors.RaiseException:
                results.append("limited")

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(25)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert results.count("ok") == 10
    assert results.count("limited") == 15


# ------------------------------------------------------- shared video cache

def test_new_video_creates_job_video_and_library_entry(conn):
    uid = add_user(conn)
    job = enqueue(conn, uid, 1)
    assert job["status"] == "queued" and job["progress"] == 0
    video = conn.execute("select * from videos where id=%s", (job["video_id"],)).fetchone()
    assert video["status"] == "pending" and video["youtube_id"] == "vid00000001"
    assert conn.execute("select count(*) c from user_videos where user_id=%s", (uid,)).fetchone()["c"] == 1


def test_same_video_is_one_shared_row(conn):
    alice, bob = add_user(conn), add_user(conn)
    a, b = enqueue(conn, alice, 1), enqueue(conn, bob, 1)
    assert a["video_id"] == b["video_id"]
    assert conn.execute("select count(*) c from videos").fetchone()["c"] == 1


def test_ready_video_is_served_from_cache_but_still_counts(conn):
    alice, bob = add_user(conn), add_user(conn)
    first = enqueue(conn, alice, 1)
    conn.execute("update videos set status='ready' where id=%s", (first["video_id"],))
    cached = enqueue(conn, bob, 1)
    assert (cached["status"], cached["progress"]) == ("completed", 100)
    assert conn.execute("select used from usage_today(%s)", (bob,)).fetchone()["used"] == 1


def test_failed_video_is_retried_on_next_request(conn):
    uid = add_user(conn)
    job = enqueue(conn, uid, 1)
    conn.execute("update videos set status='failed' where id=%s", (job["video_id"],))
    again = enqueue(conn, uid, 1)
    assert again["status"] == "queued"
    assert conn.execute("select status from videos where id=%s", (job["video_id"],)).fetchone()["status"] == "pending"


def test_uploads_are_deduplicated_by_file_hash(conn):
    alice, bob = add_user(conn), add_user(conn)
    a = conn.execute("select * from enqueue_ingest(%s,'upload','uploads/a.mp4',null,'samehash','educational')", (alice,)).fetchone()
    b = conn.execute("select * from enqueue_ingest(%s,'upload','uploads/b.mp4',null,'samehash','educational')", (bob,)).fetchone()
    assert a["video_id"] == b["video_id"]


def test_video_needs_an_identity(conn):
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into videos (source) values ('youtube')")


# ---------------------------------------------------------------- queue

def test_claim_takes_oldest_first_and_counts_attempts(conn):
    uid = add_user(conn)
    first, second = enqueue(conn, uid, 1), enqueue(conn, uid, 2)
    conn.execute("update jobs set created_at = now() - interval '1 hour' where id=%s", (first["id"],))
    claimed = conn.execute("select * from claim_next_job('w1')").fetchone()
    assert claimed["id"] == first["id"]
    assert (claimed["status"], claimed["attempts"], claimed["locked_by"]) == ("processing", 1, "w1")
    assert conn.execute("select * from claim_next_job('w1')").fetchone()["id"] == second["id"]
    assert conn.execute("select * from claim_next_job('w1')").fetchone()["id"] is None  # empty queue


def test_claim_respects_run_after(conn):
    uid = add_user(conn)
    job = enqueue(conn, uid, 1)
    conn.execute("update jobs set run_after = now() + interval '1 hour' where id=%s", (job["id"],))
    assert conn.execute("select * from claim_next_job('w1')").fetchone()["id"] is None


def test_many_workers_never_claim_the_same_job(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as admin:
        for u in range(5):
            uid = add_user(admin)
            for i in range(4):
                enqueue(admin, uid, u * 10 + i)
    claimed, lock = [], threading.Lock()

    def worker(name):
        with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
            while True:
                row = c.execute("select * from claim_next_job(%s)", (name,)).fetchone()
                if row["id"] is None:
                    return
                with lock:
                    claimed.append(row["id"])

    threads = [threading.Thread(target=worker, args=(f"w{i}",)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(claimed) == 20 and len(set(claimed)) == 20


def test_stale_jobs_are_retried_then_failed(conn):
    uid = add_user(conn)
    job = enqueue(conn, uid, 1)
    conn.execute("select * from claim_next_job('w1')")
    conn.execute("update jobs set locked_at = now() - interval '1 hour' where id=%s", (job["id"],))
    assert conn.execute("select requeue_stale_jobs('10 minutes') n").fetchone()["n"] == 1
    row = conn.execute("select * from jobs where id=%s", (job["id"],)).fetchone()
    assert (row["status"], row["locked_by"]) == ("queued", None)

    conn.execute("select * from claim_next_job('w2')")  # attempt 2 of 2
    conn.execute("update jobs set locked_at = now() - interval '1 hour' where id=%s", (job["id"],))
    conn.execute("select requeue_stale_jobs('10 minutes')")
    row = conn.execute("select * from jobs where id=%s", (job["id"],)).fetchone()
    assert (row["status"], row["error_kind"]) == ("failed", "system")
    assert conn.execute("select used from usage_today(%s)", (uid,)).fetchone()["used"] == 0  # refunded


def test_fresh_jobs_are_not_considered_stale(conn):
    uid = add_user(conn)
    enqueue(conn, uid, 1)
    conn.execute("select * from claim_next_job('w1')")
    assert conn.execute("select requeue_stale_jobs('10 minutes') n").fetchone()["n"] == 0


def test_progress_must_stay_between_0_and_100(conn):
    uid = add_user(conn)
    job = enqueue(conn, uid, 1)
    with pytest.raises(errors.CheckViolation):
        conn.execute("update jobs set progress = 101 where id=%s", (job["id"],))


# --------------------------------------------------------------- ip usage

def test_ip_counter_counts_per_hash(conn):
    assert [conn.execute("select bump_ip_usage('a') n").fetchone()["n"] for _ in range(3)] == [1, 2, 3]
    assert conn.execute("select bump_ip_usage('b') n").fetchone()["n"] == 1


def test_old_ip_counters_are_purged(conn):
    conn.execute("insert into ip_usage values ('old', current_date - 5, 7), ('new', current_date, 1)")
    assert conn.execute("select purge_old_ip_usage() n").fetchone()["n"] == 1
    assert conn.execute("select ip_hash from ip_usage").fetchone()["ip_hash"] == "new"


def test_profile_trigger_fires_when_the_auth_service_is_a_limited_role(conn):
    """Supabase's auth service is not a superuser. The 'create a profile for
    every new user' trigger must still work after our permission lockdown."""
    conn.execute("create role auth_service_sim nologin")
    conn.execute("grant usage on schema auth to auth_service_sim")
    conn.execute("grant select, insert, update, delete on auth.users to auth_service_sim")
    uid = uuid.uuid4()
    conn.execute("set role auth_service_sim")
    conn.execute("insert into auth.users (id, email, is_anonymous) values (%s, null, true)", (uid,))
    conn.execute("update auth.users set is_anonymous = false where id = %s", (uid,))
    conn.execute("reset role")
    row = conn.execute("select is_anonymous from profiles where user_id = %s", (uid,)).fetchone()
    assert row is not None and row["is_anonymous"] is False


# ------------------------------------------------------- Phase 2: outputs, sharing

def make_ready_video(conn, uid, n=1):
    job = enqueue(conn, uid, n)
    conn.execute("update videos set status='ready' where id=%s", (job["video_id"],))
    return job["video_id"]


def test_outputs_are_visible_only_to_users_who_have_the_video(conn):
    alice, bob = add_user(conn), add_user(conn)
    video = make_ready_video(conn, alice)
    conn.execute("insert into video_outputs (video_id, kind, content) values (%s, 'mindmap', '{\"title\": \"T\"}')", (video,))
    as_user(conn, alice)
    assert len(conn.execute("select * from video_outputs").fetchall()) == 1
    as_admin(conn)
    as_user(conn, bob)
    assert conn.execute("select * from video_outputs").fetchall() == []
    as_admin(conn)
    enqueue(conn, bob, 1)  # Bob adds the same (cached) video
    as_user(conn, bob)
    assert len(conn.execute("select * from video_outputs").fetchall()) == 1


def test_output_kinds_are_restricted_and_unique_per_variant(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    with pytest.raises(errors.CheckViolation):
        conn.execute("insert into video_outputs (video_id, kind, content) values (%s, 'bogus', '{}')", (video,))
    conn.execute("insert into video_outputs (video_id, kind, variant, content) values (%s, 'quiz', 'easy:5', '{}')", (video,))
    conn.execute("insert into video_outputs (video_id, kind, variant, content) values (%s, 'quiz', 'hard:5', '{}')", (video,))
    with pytest.raises(errors.UniqueViolation):
        conn.execute("insert into video_outputs (video_id, kind, variant, content) values (%s, 'quiz', 'easy:5', '{}')", (video,))


@pytest.mark.parametrize("statement", [
    "insert into video_outputs (video_id, kind, content) values (gen_random_uuid(), 'quiz', '{{}}')",
    "update video_outputs set content = '{{}}'",
    "delete from video_outputs",
    "insert into share_links (token, video_id, owner_id) values (repeat('a', 40), gen_random_uuid(), '{uid}')",
    "update share_links set revoked_at = now()",
    "select * from generation_usage",
    "select bump_generation_usage('{uid}', 5)",
])
def test_browser_roles_cannot_write_outputs_or_call_the_generation_counter(conn, statement):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    conn.execute("insert into video_outputs (video_id, kind, content) values (%s, 'quiz', '{}')", (video,))
    conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('b', 40), %s, %s)", (video, uid))
    as_user(conn, uid)
    cur_before = conn.execute("select count(*) c from video_outputs").fetchone()["c"]
    try:
        cur = conn.execute(statement.format(uid=uid))
        # A policy-filtered update/delete simply matches nothing.
        assert cur.rowcount in (0, -1) or "select" in statement.lower()
    except (errors.InsufficientPrivilege, errors.UndefinedFunction):
        pass
    as_admin(conn)
    assert conn.execute("select count(*) c from video_outputs").fetchone()["c"] == cur_before


def test_share_links_are_private_to_their_owner(conn):
    alice, bob = add_user(conn), add_user(conn)
    video = make_ready_video(conn, alice)
    conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('c', 40), %s, %s)", (video, alice))
    as_user(conn, alice)
    assert len(conn.execute("select * from share_links").fetchall()) == 1
    as_admin(conn)
    as_user(conn, bob)
    assert conn.execute("select * from share_links").fetchall() == []


def test_share_link_rules(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    with pytest.raises(errors.CheckViolation):  # tokens must be long enough to be unguessable
        conn.execute("insert into share_links (token, video_id, owner_id) values ('short', %s, %s)", (video, uid))
    conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('d', 40), %s, %s)", (video, uid))
    with pytest.raises(errors.UniqueViolation):  # one active link per owner and video
        conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('e', 40), %s, %s)", (video, uid))
    conn.execute("update share_links set revoked_at = now()")
    conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('e', 40), %s, %s)", (video, uid))


def test_generation_counter_counts_and_stops_at_the_limit(conn):
    uid = add_user(conn)
    assert [conn.execute("select bump_generation_usage(%s, 3) n", (uid,)).fetchone()["n"] for _ in range(5)] == [1, 2, 3, -1, -1]
    assert conn.execute("select count from generation_usage").fetchone()["count"] == 3
    other = add_user(conn)
    assert conn.execute("select bump_generation_usage(%s, 3) n", (other,)).fetchone()["n"] == 1


def test_parallel_generations_cannot_exceed_the_cap(db_url):
    with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as admin:
        uid = add_user(admin)
    results = []

    def worker():
        with psycopg.connect(db_url, autocommit=True, row_factory=dict_row) as c:
            results.append(c.execute("select bump_generation_usage(%s, 5) n", (uid,)).fetchone()["n"])

    threads = [threading.Thread(target=worker) for _ in range(20)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(r for r in results if r > 0) == [1, 2, 3, 4, 5]
    assert results.count(-1) == 15


def test_deleting_a_video_removes_its_outputs_and_links(conn):
    uid = add_user(conn)
    video = make_ready_video(conn, uid)
    conn.execute("insert into video_outputs (video_id, kind, content) values (%s, 'quiz', '{}')", (video,))
    conn.execute("insert into share_links (token, video_id, owner_id) values (repeat('f', 40), %s, %s)", (video, uid))
    conn.execute("delete from videos where id = %s", (video,))
    assert conn.execute("select count(*) c from video_outputs").fetchone()["c"] == 0
    assert conn.execute("select count(*) c from share_links").fetchone()["c"] == 0
