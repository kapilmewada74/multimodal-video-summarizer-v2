"""End to end: API -> Postgres queue -> worker -> result, with fake externals."""
import threading

from apiutil import SUMMARY, make_deps
from conftest import set_env
from summarizer.features.jobs import repository as repo
from summarizer.features.jobs import worker

def job_of(api, user, job_id):
    return api.client.get(f"/api/job/{job_id}", headers=user.headers).json()


def test_url_job_runs_to_completion(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    deps = make_deps(tmp_path)

    assert worker.run_once(deps, "test-worker") is True
    job = job_of(api, user, job_id)
    assert job["status"] == "completed" and job["progress"] == 100
    assert job["result"]["title"] == "Test Video"
    assert job["result"]["duration"] == 120
    assert job["result"]["transcript"] == "hello world transcript"
    assert "It works." in job["result"]["summary"]
    assert job["result"]["engine"] == "AI"          # the vendor/model is never sent to the browser
    assert deps.calls["whisper"] == 0  # captions were used

    history = api.client.get("/api/history", headers=user.headers).json()
    assert len(history) == 1 and history[0]["title"] == "Test Video"
    assert worker.run_once(deps, "test-worker") is False  # queue is empty now


def test_whisper_is_used_when_there_are_no_captions(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    deps = make_deps(tmp_path, fetch_captions=lambda url: None)
    worker.run_once(deps, "w")
    job = job_of(api, user, job_id)
    assert job["result"]["transcript"] == "spoken words"
    assert api.sql("select provider from transcripts")[0][0] == "whisper"


def test_second_user_gets_the_cached_result_without_any_ai_work(api, tmp_path):
    alice, bob = api.user(), api.user()
    api.submit(alice, 1)
    deps = make_deps(tmp_path)
    worker.run_once(deps, "w")
    assert deps.calls["summarize"] == 1

    res = api.submit(bob, 1).json()
    assert res["status"] == "completed"  # instant: nothing is queued
    assert worker.run_once(deps, "w") is False
    job = job_of(api, bob, res["job_id"])
    assert job["result"]["title"] == "Test Video" and "It works." in job["result"]["summary"]
    assert deps.calls["summarize"] == 1
    assert api.client.get("/api/me/usage", headers=bob.headers).json()["used"] == 1  # still counts


def test_two_jobs_for_the_same_video_only_process_it_once(api, tmp_path):
    alice, bob = api.user(), api.user()
    first = api.submit(alice, 1).json()["job_id"]
    second = api.submit(bob, 1).json()["job_id"]  # queued before the first finished
    deps = make_deps(tmp_path)
    assert worker.run_once(deps, "w") and worker.run_once(deps, "w")
    assert deps.calls["summarize"] == 1
    assert job_of(api, alice, first)["status"] == "completed"
    assert job_of(api, bob, second)["status"] == "completed"


def test_video_that_is_too_long_fails_clearly_and_is_not_retried(api, tmp_path, monkeypatch):
    set_env(monkeypatch, MAX_VIDEO_SECONDS="60")
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    deps = make_deps(tmp_path)
    worker.run_once(deps, "w")
    job = job_of(api, user, job_id)
    assert job["status"] == "failed" and "maximum supported length" in job["error"]
    assert api.sql("select attempts, error_kind from jobs")[0] == (1, "user")
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 1  # user error: slot used


def test_empty_transcript_is_a_user_error(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    worker.run_once(make_deps(tmp_path, fetch_captions=lambda u: "   ", transcribe_youtube=lambda u, j: ""), "w")
    job = job_of(api, user, job_id)
    assert job["status"] == "failed" and "No audible speech" in job["error"]


def test_system_errors_are_retried_then_fail_and_refund_the_slot(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]

    def broken(transcript):
        raise RuntimeError("provider exploded: secret-detail-123")

    deps = make_deps(tmp_path, summarize=broken)
    worker.run_once(deps, "w")
    assert job_of(api, user, job_id)["status"] == "queued"  # scheduled for a retry
    assert api.sql("select attempts from jobs")[0][0] == 1
    assert worker.run_once(deps, "w") is False  # not runnable until the retry delay passes

    api.sql("update jobs set run_after = now() - interval '1 second'")
    worker.run_once(deps, "w")
    job = job_of(api, user, job_id)
    assert job["status"] == "failed"
    assert "secret-detail-123" not in str(job)  # internal details are never shown to users
    assert api.sql("select status from videos")[0][0] == "failed"
    assert api.client.get("/api/me/usage", headers=user.headers).json()["used"] == 0  # refunded


def test_transient_failure_succeeds_on_retry(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    attempts = {"n": 0}

    def flaky(transcript):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise RuntimeError("temporary glitch")
        return SUMMARY, "Fake (test-model)"

    deps = make_deps(tmp_path, summarize=flaky)
    worker.run_once(deps, "w")
    api.sql("update jobs set run_after = now() - interval '1 second'")
    worker.run_once(deps, "w")
    assert job_of(api, user, job_id)["status"] == "completed"


def test_crashed_worker_job_is_recovered(api, tmp_path):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    api.sql("select * from claim_next_job('dead-worker')")  # claimed, then the worker died
    api.sql("update jobs set locked_at = now() - interval '1 hour'")
    from summarizer.core.db import connection
    with connection() as conn:
        assert repo.requeue_stale(conn, 20 * 60) == 1
    worker.run_once(make_deps(tmp_path), "w2")
    assert job_of(api, user, job_id)["status"] == "completed"


def test_upload_job_uses_the_stored_file_and_removes_it(api, tmp_path):
    user = api.user()
    job_id = api.upload(user, "Physics Lecture.mp4", b"0123456789").json()["job_id"]
    store_dir = tmp_path / "data" / "uploads"
    assert len(list(store_dir.glob("*"))) == 1

    worker.run_once(make_deps(tmp_path), "w")
    job = job_of(api, user, job_id)
    assert job["status"] == "completed"
    assert job["result"]["title"] == "Physics Lecture.mp4"
    assert job["result"]["transcript"] == "transcript of 10 bytes"
    assert list(store_dir.glob("*")) == []  # original deleted after processing


def test_uploading_an_already_processed_file_skips_the_worker(api, tmp_path):
    alice, bob = api.user(), api.user()
    api.upload(alice, "a.mp4", b"identical")
    worker.run_once(make_deps(tmp_path), "w")
    res = api.upload(bob, "b.mp4", b"identical").json()
    assert res["status"] == "completed"
    assert list((tmp_path / "data" / "uploads").glob("*")) == []  # nothing was stored again


def test_parallel_workers_process_each_job_exactly_once(api, tmp_path):
    users = [api.user() for _ in range(4)]
    for i, user in enumerate(users):
        for j in range(3):
            api.submit(user, i * 10 + j)
    deps_list = [make_deps(tmp_path) for _ in range(4)]

    def run(deps, name):
        while worker.run_once(deps, name):
            pass

    threads = [threading.Thread(target=run, args=(d, f"w{i}")) for i, d in enumerate(deps_list)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(d.calls["summarize"] for d in deps_list) == 12
    assert api.sql("select count(*) from jobs where status = 'completed'")[0][0] == 12
    assert api.sql("select max(attempts) from jobs")[0][0] == 1


def test_progress_is_visible_to_the_owner_only_through_the_database_policy(api, tmp_path):
    """The browser can watch its own job row (Realtime) but nobody else's."""
    import psycopg
    alice, bob = api.user(), api.user()
    api.submit(alice, 1)
    with psycopg.connect(api.db_url, autocommit=True) as conn:
        conn.execute("set role authenticated")
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (bob.id,))
        assert conn.execute("select count(*) from jobs").fetchone()[0] == 0
        conn.execute("select set_config('request.jwt.claim.sub', %s, false)", (alice.id,))
        assert conn.execute("select count(*) from jobs").fetchone()[0] == 1


def test_background_worker_thread_processes_jobs(api, tmp_path, monkeypatch):
    user = api.user()
    job_id = api.submit(user, 1).json()["job_id"]
    deps = make_deps(tmp_path)
    stop = threading.Event()
    set_env(monkeypatch, WORKER_POLL_SECONDS="0.05")
    thread = threading.Thread(target=worker.run_forever, args=(stop, deps), daemon=True)
    thread.start()
    for _ in range(100):
        if job_of(api, user, job_id)["status"] == "completed":
            break
        stop.wait(0.05)
    stop.set()
    thread.join(timeout=5)
    assert job_of(api, user, job_id)["status"] == "completed"
