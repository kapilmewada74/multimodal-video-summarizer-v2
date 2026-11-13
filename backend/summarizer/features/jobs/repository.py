"""All SQL for jobs, videos and results. Functions take an open connection."""
import logging
from typing import Any, Dict, List, Optional
from uuid import UUID

import psycopg

from ...core.config import get_settings
from ...core.errors import AppError
from ...shared.public import public_engine, public_message

logger = logging.getLogger("summarizer.jobs")

# Job columns a worker is allowed to change while it runs.
_UPDATABLE = {"status", "step", "step_name", "progress", "message", "error", "error_kind",
              "video_id", "run_after", "finished_at", "locked_by", "locked_at"}

Row = Dict[str, Any]


def parse_uuid(value: str) -> Optional[str]:
    try:
        return str(UUID(str(value)))
    except ValueError:
        return None


def ensure_profile(conn, user_id: str) -> None:
    """Normally the database trigger creates this. This covers users who signed
    up before the trigger existed."""
    try:
        conn.execute("insert into profiles (user_id) values (%s) on conflict do nothing", (user_id,))
    except psycopg.errors.ForeignKeyViolation:
        raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")


def apply_tier(conn, user_id: str, is_guest: bool) -> None:
    """Guests get a smaller daily allowance; signing in restores the normal one (same user id, same data).
    Only a value that matches the other tier is changed, so a limit set by hand for someone is left alone."""
    settings = get_settings()
    guest_limit, normal_limit = settings.guest_daily_limit, settings.daily_video_limit
    if guest_limit == normal_limit:
        return
    if is_guest:
        conn.execute("update profiles set daily_video_limit = %s where user_id = %s and daily_video_limit = %s",
                     (guest_limit, user_id, normal_limit))
    else:
        conn.execute("update profiles set daily_video_limit = %s where user_id = %s and daily_video_limit = %s",
                     (normal_limit, user_id, guest_limit))


def usage(conn, user_id: str, is_guest: bool = False) -> Row:
    ensure_profile(conn, user_id)
    apply_tier(conn, user_id, is_guest)
    row = conn.execute("select * from usage_today(%s)", (user_id,)).fetchone()
    return {
        "used": row["used"],
        "limit": row["daily_limit"],
        "remaining": max(row["daily_limit"] - row["used"], 0),
        "resets_at": row["resets_at"].isoformat(),
    }


def enqueue_ingest(conn, user_id: str, source: str, source_ref: str,
                   youtube_id: Optional[str], file_hash: Optional[str], mode: str, is_guest: bool = False) -> Row:
    ensure_profile(conn, user_id)
    apply_tier(conn, user_id, is_guest)
    try:
        return conn.execute(
            "select * from enqueue_ingest(%s, %s, %s, %s, %s, %s)",
            (user_id, source, source_ref, youtube_id, file_hash, mode),
        ).fetchone()
    except psycopg.errors.RaiseException as exc:
        if "daily_limit_reached" in str(exc):
            info = usage(conn, user_id, is_guest)
            raise AppError(
                429, "daily_limit_reached",
                f"You have used {info['used']} of {info['limit']} videos today. "
                "Your limit resets at midnight.",
                extra={"usage": info},
            )
        raise


def get_job(conn, job_id: str, user_id: Optional[str] = None) -> Optional[Row]:
    job_id = parse_uuid(job_id)
    if not job_id:
        return None
    if user_id:
        return conn.execute("select * from jobs where id = %s and user_id = %s", (job_id, user_id)).fetchone()
    return conn.execute("select * from jobs where id = %s", (job_id,)).fetchone()


def get_result(conn, video_id: str, mode: str = "educational") -> Optional[Row]:
    row = conn.execute(
        """select v.title, v.duration_seconds, t.text as transcript,
                  s.content_md as summary, s.engine
             from videos v
             join summaries s on s.video_id = v.id
             join transcripts t on t.video_id = v.id
            where v.id = %s""",
        (video_id,),
    ).fetchone()
    if not row:
        return None
    return {"title": row["title"], "duration": row["duration_seconds"] or 0,
            "transcript": row["transcript"], "summary": row["summary"],
            "mode": mode, "engine": row["engine"]}


def job_to_api(conn, job: Row) -> Row:
    """The JSON shape the frontend expects."""
    payload = {
        "id": str(job["id"]),
        "type": "url" if job["source"] == "youtube" else "upload",
        "status": job["status"],
        "step": job["step"],
        "step_name": job["step_name"],
        "progress": job["progress"],
        "message": public_message(job["message"]),
        "error": job["error"],
        "video_id": str(job["video_id"]) if job["video_id"] else None,
        "result": None,
    }
    if job["status"] == "completed" and job["video_id"]:
        payload["result"] = get_result(conn, str(job["video_id"]), job["mode"])
        if payload["result"]:
            payload["result"] = {**payload["result"], "engine": public_engine(payload["result"]["engine"])}
            payload["video_title"] = payload["result"]["title"]
    return payload


def history(conn, user_id: str, limit: int = 20) -> List[Row]:
    rows = conn.execute(
        """select v.id as video_id, v.title, v.duration_seconds, uv.added_at,
                  s.content_md as summary, t.text as transcript, s.engine
             from user_videos uv
             join videos v on v.id = uv.video_id
             join summaries s on s.video_id = v.id
             join transcripts t on t.video_id = v.id
            where uv.user_id = %s
            order by uv.added_at desc
            limit %s""",
        (user_id, limit),
    ).fetchall()
    return [{
        "job_id": str(r["video_id"]),
        "title": r["title"],
        "duration": r["duration_seconds"] or 0,
        "timestamp": r["added_at"].timestamp(),
        "summary": r["summary"],
        "transcript": r["transcript"],
        "engine": public_engine(r["engine"]),
    } for r in rows]


# --------------------------------------------------------------- worker side

def claim_next(conn, worker: str) -> Optional[Row]:
    row = conn.execute("select * from claim_next_job(%s)", (worker,)).fetchone()
    return row if row and row["id"] is not None else None


def requeue_stale(conn, timeout_seconds: int) -> int:
    return conn.execute("select requeue_stale_jobs(make_interval(secs => %s)) n",
                        (timeout_seconds,)).fetchone()["n"]


def update_job(conn, job_id, **fields) -> None:
    unknown = set(fields) - _UPDATABLE
    if unknown:
        raise ValueError(f"Cannot update job columns: {sorted(unknown)}")
    if not fields:
        return
    assignments = ", ".join(f"{name} = %s" for name in fields)
    conn.execute(f"update jobs set {assignments} where id = %s", (*fields.values(), job_id))


def get_video(conn, video_id) -> Optional[Row]:
    return conn.execute("select * from videos where id = %s", (video_id,)).fetchone()


def set_video_status(conn, video_id, status: str, **extra) -> None:
    sets = ["status = %s"]
    values: list = [status]
    for column in ("title", "duration_seconds", "language"):
        if column in extra:
            sets.append(f"{column} = %s")
            values.append(extra[column])
    conn.execute(f"update videos set {', '.join(sets)} where id = %s", (*values, video_id))


def save_result(conn, video_id, *, title: str, duration: int, language: Optional[str],
                transcript: str, provider: str, summary: str, engine: str) -> None:
    """Store the finished result and mark the video ready, all or nothing."""
    with conn.transaction():
        conn.execute(
            """insert into transcripts (video_id, language, provider, text)
               values (%s, %s, %s, %s)
               on conflict (video_id) do update
                 set text = excluded.text, provider = excluded.provider, language = excluded.language""",
            (video_id, language, provider, transcript),
        )
        conn.execute(
            """insert into summaries (video_id, content_md, engine) values (%s, %s, %s)
               on conflict (video_id) do update
                 set content_md = excluded.content_md, engine = excluded.engine""",
            (video_id, summary, engine),
        )
        conn.execute(
            "update videos set status = 'ready', title = %s, duration_seconds = %s, language = %s where id = %s",
            (title, duration, language, video_id),
        )
