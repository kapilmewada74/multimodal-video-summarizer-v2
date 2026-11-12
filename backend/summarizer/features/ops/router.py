"""Numbers for dashboards and alerts (queue depth, failures, throughput).

Closed unless OPS_TOKEN is set; callers send it as the X-Ops-Token header. It is
meant for an uptime/alert monitor, not for browsers, and returns no personal data.
"""
import hmac
import os

from fastapi import APIRouter, Header

from ...core.db import connection
from ...core.errors import AppError

router = APIRouter(prefix="/api/internal", tags=["ops"])


def _require_token(provided: str) -> None:
    expected = os.getenv("OPS_TOKEN", "")
    # 404 (not 401) when the feature is off, so the route does not advertise itself.
    if not expected:
        raise AppError(404, "not_found", "Not found.")
    if not hmac.compare_digest(provided.encode(), expected.encode()):
        raise AppError(401, "unauthorized", "Invalid token.")


def collect_stats(conn) -> dict:
    queue = conn.execute(
        """select count(*) filter (where status = 'queued' and run_after <= now()) as waiting,
                  count(*) filter (where status = 'queued' and run_after > now()) as retrying,
                  count(*) filter (where status = 'processing') as processing,
                  coalesce(extract(epoch from now() - min(created_at) filter
                      (where status = 'queued' and run_after <= now())), 0)::int as oldest_waiting_seconds
           from public.jobs where status in ('queued', 'processing')""").fetchone()
    day = conn.execute(
        """select count(*) filter (where status = 'completed') as completed,
                  count(*) filter (where status = 'failed') as failed,
                  count(*) filter (where status = 'failed' and error_kind = 'system') as failed_system,
                  count(distinct user_id) as active_users,
                  coalesce(avg(extract(epoch from finished_at - started_at))
                      filter (where status = 'completed' and started_at is not null), 0)::int as avg_processing_seconds,
                  coalesce(percentile_cont(0.95) within group (order by extract(epoch from finished_at - started_at))
                      filter (where status = 'completed' and started_at is not null), 0)::int as p95_processing_seconds
           from public.jobs where created_at > now() - interval '24 hours'""").fetchone()
    hour = conn.execute(
        """select count(*) filter (where status = 'failed' and error_kind = 'system') as failed_system,
                  count(*) as submitted
           from public.jobs where created_at > now() - interval '1 hour'""").fetchone()
    users = conn.execute("select count(*) as total from public.profiles").fetchone()
    return {"queue": dict(queue), "last_24h": dict(day), "last_hour": dict(hour), "users_total": users["total"]}


def evaluate_alerts(stats: dict) -> list[str]:
    """Plain-language problems an on-call person should look at (empty list = healthy)."""
    alerts = []
    q, d, h = stats["queue"], stats["last_24h"], stats["last_hour"]
    if q["oldest_waiting_seconds"] > 300:
        alerts.append(f"Jobs have waited {q['oldest_waiting_seconds']}s: workers are down or too few.")
    if q["waiting"] > 50:
        alerts.append(f"{q['waiting']} jobs are waiting.")
    if h["submitted"] >= 5 and h["failed_system"] / h["submitted"] > 0.2:
        alerts.append("More than 20% of the last hour's jobs failed on our side.")
    if d["completed"] + d["failed"] >= 20 and d["failed_system"] / (d["completed"] + d["failed"]) > 0.1:
        alerts.append("More than 10% of today's jobs failed on our side.")
    return alerts


@router.get("/stats")
def stats(x_ops_token: str = Header(default="")):
    _require_token(x_ops_token)
    with connection() as conn:
        data = collect_stats(conn)
    return {**data, "alerts": evaluate_alerts(data)}
