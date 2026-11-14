from fastapi import APIRouter, Depends

from ...core.db import connection
from ..ops.router import collect_stats, evaluate_alerts
from .guard import Staff, require

router = APIRouter()


@router.get("/overview")
def overview(staff: Staff = Depends(require("overview.view"))):
    with connection() as conn:
        users = conn.execute(
            """select count(*) filter (where not is_anonymous) as accounts,
                      count(*) filter (where is_anonymous) as guests,
                      count(*) filter (where created_at > now() - interval '24 hours' and not is_anonymous) as new_24h,
                      count(*) filter (where created_at > now() - interval '7 days' and not is_anonymous) as new_7d,
                      count(*) filter (where suspended_at is not null) as suspended
                 from public.profiles""").fetchone()
        activity = conn.execute(
            """select (select count(*) from public.videos) as videos_total,
                      (select count(*) from public.jobs where created_at > now() - interval '24 hours') as jobs_24h,
                      (select count(distinct user_id) from public.jobs where created_at > now() - interval '24 hours') as active_24h,
                      (select coalesce(sum(count), 0) from public.generation_usage
                        where day = (now() at time zone 'UTC')::date) as generations_today""").fetchone()
        support = conn.execute(
            """select count(*) filter (where status = 'open') as open,
                      count(*) filter (where status = 'in_progress') as in_progress,
                      coalesce(extract(epoch from now() - min(created_at) filter (where status = 'open')), 0)::bigint
                          as oldest_open_seconds
                 from public.support_tickets""").fetchone()
        system = alerts = None
        if staff.can("system.view"):
            system = collect_stats(conn)
            alerts = evaluate_alerts(system)
    return {"users": dict(users), "activity": dict(activity), "support": dict(support), "system": system, "alerts": alerts}
