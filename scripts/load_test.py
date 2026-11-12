#!/usr/bin/env python3
"""Load tests for the job queue and the API (Phase 5: "50 users each submitting 10 videos at once").

QUEUE test (default). Uses a throwaway local PostgreSQL (needs the postgres binaries, like the unit tests),
or any disposable database via --database-url. Real code, fake AI: each job just sleeps, so it measures the
queue, the locking and the database, not the AI providers.

    python3 scripts/load_test.py                          # 50 users x 10 videos, 4 workers
    python3 scripts/load_test.py --users 200 --workers 16 --job-seconds 0.2
    python3 scripts/load_test.py --database-url postgresql://...   # a STAGING database, never production

It checks: nobody gets more than the daily limit, no job runs twice, every job finishes, and how long jobs
wait. Then it prints the worker count you need for a target waiting time.

HTTP test. Hits a running API with many parallel requests and reports requests per second and latency:

    python3 scripts/load_test.py --http https://staging.example.com --token "$ACCESS_TOKEN" --requests 2000 --concurrency 50
"""
import argparse
import os
import sys
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def percentile(values, p):
    if not values:
        return 0.0
    values = sorted(values)
    return values[min(len(values) - 1, int(round(p / 100 * (len(values) - 1))))]


def youtube_id(n: int) -> str:
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
    code = ""
    for _ in range(11):
        code += alphabet[n % 62]
        n //= 62
    return code


# ----------------------------------------------------------------------- HTTP

def http_test(args) -> int:
    import httpx

    base = args.http.rstrip("/")
    headers = {"Authorization": f"Bearer {args.token}"} if args.token else {}
    paths = ["/api/health/ready"] + (["/api/me/usage", "/api/videos"] if args.token else [])
    latencies, errors = [], 0
    lock = threading.Lock()
    counter = iter(range(args.requests))

    def worker():
        nonlocal errors
        with httpx.Client(timeout=30, headers=headers) as client:
            while True:
                with lock:
                    i = next(counter, None)
                if i is None:
                    return
                started = time.perf_counter()
                try:
                    ok = client.get(base + paths[i % len(paths)]).status_code < 500
                except Exception:
                    ok = False
                elapsed = (time.perf_counter() - started) * 1000
                with lock:
                    latencies.append(elapsed)
                    errors += 0 if ok else 1

    started = time.perf_counter()
    with ThreadPoolExecutor(args.concurrency) as pool:
        for _ in range(args.concurrency):
            pool.submit(worker)
    total = time.perf_counter() - started
    print(f"{args.requests} requests, {args.concurrency} at a time, over {total:.1f}s -> {args.requests / total:.0f} req/s")
    print(f"latency ms: p50 {percentile(latencies, 50):.0f}  p95 {percentile(latencies, 95):.0f}  p99 {percentile(latencies, 99):.0f}  max {max(latencies):.0f}")
    print(f"errors (5xx or no answer): {errors}")
    return 1 if errors > args.requests * 0.01 else 0


# ---------------------------------------------------------------------- QUEUE

def start_temp_postgres():
    sys.path.insert(0, str(ROOT / "backend" / "tests"))
    import platform, shutil, subprocess, tempfile
    from pgserver import AUTH_STUB, MIGRATIONS, find_binary, free_port
    import psycopg

    initdb, pg_ctl = find_binary("initdb"), find_binary("pg_ctl")
    if not initdb or not pg_ctl:
        sys.exit("PostgreSQL server binaries not found. Install PostgreSQL, or pass --database-url of a disposable database.")
    data, sock = tempfile.mkdtemp(prefix="pgload-", dir="/tmp"), tempfile.mkdtemp(prefix="pgsock-", dir="/tmp")
    port = free_port()
    locale = "en_US.UTF-8" if platform.system() == "Darwin" else "C.UTF-8"
    env = {**os.environ, "LC_ALL": locale, "LANG": locale}
    subprocess.run([initdb, "-D", data, "-A", "trust", "-U", "postgres", "-E", "UTF8"], check=True, capture_output=True, env=env)
    subprocess.run([pg_ctl, "start", "-D", data, "-w", "-l", f"{data}/log", "-o",
                    f"-p {port} -c listen_addresses=127.0.0.1 -c unix_socket_directories={sock} -c max_connections=300"],
                   check=True, capture_output=True, env=env)
    url = f"postgresql://postgres@127.0.0.1:{port}/postgres"
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(AUTH_STUB.read_text())
        for migration in MIGRATIONS:
            conn.execute(migration.read_text())

    def stop():
        subprocess.run([pg_ctl, "stop", "-D", data, "-m", "immediate"], capture_output=True, env=env)
        shutil.rmtree(data, ignore_errors=True)
        shutil.rmtree(sock, ignore_errors=True)
    return url, stop


def queue_test(args) -> int:
    stop_db = None
    url = args.database_url
    if not url:
        print("Starting a throwaway PostgreSQL ...")
        url, stop_db = start_temp_postgres()
    os.environ.update(DATABASE_URL=url, DB_POOL_MAX=str(args.workers + args.users + 5), RUN_EMBEDDED_WORKER="false",
                      DATA_DIR=str(ROOT / "data"), ENVIRONMENT="development")
    sys.path.insert(0, str(ROOT / "backend"))
    import psycopg
    from summarizer.core.db import close_pool, connection
    from summarizer.core.errors import AppError
    from summarizer.features.jobs import repository as repo, worker
    from summarizer.features.jobs.runner import PipelineDeps
    from summarizer.shared.storage import LocalFileStore

    import tempfile
    store = LocalFileStore(Path(tempfile.mkdtemp(prefix="loadstore-")))
    run_tag = uuid.uuid4().hex[:6]
    users = [str(uuid.uuid4()) for _ in range(args.users)]
    with psycopg.connect(url, autocommit=True) as admin:
        for u in users:
            admin.execute("insert into auth.users (id, email, is_anonymous) values (%s, %s, false)", (u, f"{u}@load.test"))
    print(f"{args.users} users x {args.videos_each} videos; {args.workers} workers; ~{args.job_seconds}s per job")

    # ---- 1. everyone submits at once
    enqueue_ms, blocked, accepted = [], 0, 0
    lock = threading.Lock()
    seq = iter(range(10**9))

    def submit_all(user_id):
        nonlocal blocked, accepted
        for _ in range(args.videos_each):
            n = next(seq)
            ref = f"https://www.youtube.com/watch?v={youtube_id(n + 7_000_000)}"
            started = time.perf_counter()
            try:
                with connection() as conn:
                    repo.enqueue_ingest(conn, user_id, "youtube", ref, youtube_id(n + 7_000_000), None, "educational")
                with lock:
                    accepted += 1
            except AppError as exc:
                if exc.code != "daily_limit_reached":
                    raise
                with lock:
                    blocked += 1
            with lock:
                enqueue_ms.append((time.perf_counter() - started) * 1000)

    started_all = time.perf_counter()
    with ThreadPoolExecutor(min(args.users, 100)) as pool:
        list(pool.map(submit_all, users))
    print(f"submitted in {time.perf_counter() - started_all:.1f}s: {accepted} accepted, {blocked} stopped by the daily limit")
    print(f"enqueue ms: p50 {percentile(enqueue_ms, 50):.0f}  p95 {percentile(enqueue_ms, 95):.0f}  max {max(enqueue_ms):.0f}")

    # ---- 2. workers drain the queue
    processed = {}
    plock = threading.Lock()

    def fake_deps():
        def nap(*_a, **_k):
            time.sleep(args.job_seconds * (0.5 + (hash(threading.get_ident()) % 100) / 100))
            return "transcript text"
        return PipelineDeps(
            fetch_metadata=lambda u: ("Load video", 300), fetch_captions=nap, transcribe_youtube=nap,
            transcribe_file=nap, summarize=lambda t: ("# Video Summary\n\n## 1. Main Topic\nok\n\n## 2. Key Concepts\n- a: b", "Fake"),
            to_roman=lambda t: t, file_store=store)

    stop = threading.Event()

    def run_worker(i):
        deps = fake_deps()
        name = f"load-{run_tag}-{i}"
        while not stop.is_set():
            try:
                handled = worker.run_once(deps, name)
            except Exception as exc:  # a crash here is a finding, not something to hide
                print("worker error:", exc)
                handled = False
            if not handled:
                if stop.wait(0.05):
                    return
            else:
                with plock:
                    processed[name] = processed.get(name, 0) + 1

    drain_start = time.perf_counter()
    threads = [threading.Thread(target=run_worker, args=(i,), daemon=True) for i in range(args.workers)]
    for t in threads:
        t.start()
    deadline = time.time() + args.timeout
    with psycopg.connect(url, autocommit=True) as admin:
        while time.time() < deadline:
            left = admin.execute("select count(*) from jobs where status in ('queued','processing') and user_id = any(%s::uuid[])", (users,)).fetchone()[0]
            if left == 0:
                break
            time.sleep(0.5)
    drained = time.perf_counter() - drain_start
    stop.set()
    for t in threads:
        t.join(timeout=5)

    # ---- 3. verify
    with psycopg.connect(url, autocommit=True) as admin:
        rows = admin.execute(
            """select status, count(*), coalesce(max(attempts), 0),
                      percentile_cont(0.5) within group (order by extract(epoch from started_at - created_at)),
                      percentile_cont(0.95) within group (order by extract(epoch from started_at - created_at)),
                      max(extract(epoch from started_at - created_at))
               from jobs where user_id = any(%s::uuid[]) group by status""", (users,)).fetchall()
        per_user_max = admin.execute(
            "select coalesce(max(c), 0) from (select count(*) c from jobs where user_id = any(%s::uuid[]) group by user_id) s", (users,)).fetchone()[0]
        dupes = admin.execute("select count(*) from (select video_id from jobs where user_id = any(%s::uuid[]) group by video_id having count(*) > 1) s", (users,)).fetchone()[0]
    by_status = {r[0]: r for r in rows}
    done = by_status.get("completed", (0, 0, 0, 0, 0, 0))
    failed = by_status.get("failed", (0, 0))[1]
    stuck = sum(r[1] for s, r in by_status.items() if s in ("queued", "processing"))
    total_processed = sum(processed.values())
    throughput = done[1] / drained * 60 if drained else 0
    print(f"\ndrained in {drained:.1f}s: {done[1]} completed, {failed} failed, {stuck} stuck -> {throughput:.0f} jobs/min with {args.workers} workers")
    print(f"waiting before start (s): p50 {done[3] or 0:.1f}  p95 {done[4] or 0:.1f}  max {done[5] or 0:.1f}")
    print(f"jobs per worker: min {min(processed.values(), default=0)}  max {max(processed.values(), default=0)}")

    problems = []
    if per_user_max > 10:
        problems.append(f"a user got {per_user_max} jobs (limit is 10)")
    if total_processed != done[1] + failed:
        problems.append(f"{total_processed} runs for {done[1] + failed} finished jobs: some job ran twice or was lost")
    if stuck:
        problems.append(f"{stuck} jobs never finished within {args.timeout}s")
    if failed:
        problems.append(f"{failed} jobs failed")
    if dupes:
        problems.append(f"{dupes} videos have more than one job")
    expected_blocked = args.users * max(args.videos_each - 10, 0)
    if blocked != expected_blocked:
        problems.append(f"expected {expected_blocked} submissions stopped by the daily limit, saw {blocked}")

    # ---- capacity planning
    per_job = args.job_seconds
    target = args.target_wait
    jobs_at_peak = args.users * min(args.videos_each, 10)
    need = max(1, int(-(-jobs_at_peak * per_job // target)))
    print(f"\nPlanning: if all {args.users} users submit {min(args.videos_each, 10)} videos at once ({jobs_at_peak} jobs of ~{per_job}s), "
          f"the LAST job starts after ~{jobs_at_peak * per_job / args.workers:.0f}s with {args.workers} workers; "
          f"you need ~{need} workers for that to stay under {target}s.")
    print("Use your real per-video time (Whisper RTF x video length, plus AI calls) as --job-seconds.")

    close_pool()
    if stop_db:
        stop_db()
    if problems:
        print("\nFAILED:\n- " + "\n- ".join(problems))
        return 1
    print("\nPASS: limits held, no job ran twice, every job finished.")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--users", type=int, default=50)
    ap.add_argument("--videos-each", type=int, default=10, help="videos each user tries to submit (more than 10 tests the daily limit)")
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--job-seconds", type=float, default=0.05, help="simulated time per job")
    ap.add_argument("--target-wait", type=float, default=300, help="longest acceptable wait for the planning line (seconds)")
    ap.add_argument("--timeout", type=float, default=300)
    ap.add_argument("--database-url", help="a disposable (staging) database; default: a throwaway local PostgreSQL")
    ap.add_argument("--http", metavar="URL", help="run the HTTP test against this API address instead")
    ap.add_argument("--token", help="a signed-in user's access token (for the HTTP test)")
    ap.add_argument("--requests", type=int, default=1000)
    ap.add_argument("--concurrency", type=int, default=25)
    args = ap.parse_args()
    return http_test(args) if args.http else queue_test(args)


if __name__ == "__main__":
    raise SystemExit(main())
