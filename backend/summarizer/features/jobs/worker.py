"""The job worker: takes queued jobs from Postgres and runs them.

Run it as its own process (production / GPU machine):

    python -m summarizer.features.jobs.worker

or let the API start one in the background (development).
"""
import logging
import os
import socket
import threading
import time
from typing import Optional

from ...core.config import get_settings
from ...core.db import connection
from ...shared.storage import get_file_store
from . import repository as repo
from ..notifications.delivery import notify
from ..study.reminders import send_streak_reminders
from .runner import PipelineDeps, UserError, process_job

logger = logging.getLogger("summarizer.worker")

RETRY_DELAY_SECONDS = 30


def worker_name() -> str:
    return f"{socket.gethostname()}-{os.getpid()}"


def handle_failure(conn, job: dict, exc: Exception) -> None:
    """Retry system errors a limited number of times; fail user errors at once."""
    message = str(exc) if isinstance(exc, UserError) else "Something went wrong while processing this video."
    if isinstance(exc, UserError):
        kind, retry = "user", False
    else:
        kind, retry = "system", job["attempts"] < job["max_attempts"]
        logger.error("Job %s failed on attempt %s: %s", job["id"], job["attempts"], exc, exc_info=exc)

    if retry:
        repo.update_job(
            conn, job["id"], status="queued", message="A problem occurred. Retrying shortly...",
            locked_by=None, locked_at=None,
            run_after=conn.execute("select now() + make_interval(secs => %s) t", (RETRY_DELAY_SECONDS,)).fetchone()["t"],
        )
        repo.set_video_status(conn, job["video_id"], "pending")
        return

    repo.update_job(conn, job["id"], status="failed", error=message, error_kind=kind,
                    message=message, finished_at=conn.execute("select now() n").fetchone()["n"])
    repo.set_video_status(conn, job["video_id"], "failed")


def _announce_summary(conn, job: dict) -> None:
    """Tell the user their summary is ready (a failure here never fails the job)."""
    try:
        video = repo.get_video(conn, job["video_id"])
        if video and video["status"] == "ready":
            notify(str(job["user_id"]), "summary_ready", "Your summary is ready", video["title"] or "Your video",
                   f"/video/{video['id']}", dedupe_key=f"summary:{job['id']}")
    except Exception:
        logger.exception("Could not create the summary-ready notification")


def run_once(deps: Optional[PipelineDeps] = None, name: Optional[str] = None) -> bool:
    """Process at most one job. Returns True if a job was handled."""
    with connection() as conn:
        job = repo.claim_next(conn, name or worker_name())
        if not job:
            return False
        if deps is None:
            deps = PipelineDeps(file_store=get_file_store())
        try:
            process_job(conn, job, deps)
        except Exception as exc:
            handle_failure(conn, job, exc)
        else:
            _announce_summary(conn, job)
        return True


def run_forever(stop: Optional[threading.Event] = None, deps: Optional[PipelineDeps] = None) -> None:
    stop = stop or threading.Event()
    settings = get_settings()
    last_housekeeping = 0.0
    last_reminders = 0.0
    logger.info("Worker %s started.", worker_name())
    while not stop.is_set():
        try:
            if time.monotonic() - last_housekeeping > 60:
                with connection() as conn:
                    revived = repo.requeue_stale(conn, settings.stale_job_seconds)
                    conn.execute("select purge_old_ip_usage()")
                if revived:
                    logger.warning("Re-queued %d stale job(s).", revived)
                last_housekeeping = time.monotonic()
            if time.monotonic() - last_reminders > 600:
                last_reminders = time.monotonic()
                sent = send_streak_reminders()
                if sent:
                    logger.info("Sent %d streak reminder(s).", sent)
            if not run_once(deps):
                stop.wait(settings.worker_poll_seconds)
        except Exception:
            logger.exception("Worker loop error; continuing.")
            stop.wait(5)
    logger.info("Worker stopped.")


def start_background_worker() -> tuple[threading.Thread, threading.Event]:
    stop = threading.Event()
    thread = threading.Thread(target=run_forever, args=(stop,), name="embedded-worker", daemon=True)
    thread.start()
    return thread, stop


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    run_forever()
