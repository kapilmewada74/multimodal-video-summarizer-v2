"""Look at accounts, suspend them, change their daily allowance.

Staff see account facts and counts, never what a person studied: no summaries, transcripts, notes or documents.
Opening one person's details is itself written to the audit log.
"""
import re
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...core import suspension
from ...core.db import connection
from ...core.errors import AppError
from . import audit
from .guard import MAX_PAGE, Staff, like_pattern, require

router = APIRouter(prefix="/users")

EMAIL_LIKE = re.compile(r"^[^@\s]+@[^@\s]+$")
MAX_DAILY_LIMIT = 1000


def _uuid(value: str) -> Optional[str]:
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _iso(value):
    return value.isoformat() if value else None


def _row(staff: Staff, r) -> dict:
    return {
        "id": str(r["user_id"]), "email": staff.see_email(r["email"]), "name": r["display_name"],
        "guest": r["is_anonymous"], "created_at": _iso(r["created_at"]), "last_sign_in_at": _iso(r["last_sign_in_at"]),
        "daily_video_limit": r["daily_video_limit"], "suspended": r["suspended_at"] is not None,
        "videos": r["videos"], "role": r["role"],
    }


def _search(staff: Staff, q: str):
    """(sql condition, params). Staff who may see addresses can search any part of one. The others must type the whole
    address (or the person's id, or the start of their name): otherwise searching "a", "ab", ... would reveal the
    addresses they are not allowed to see, one letter at a time."""
    q = q.strip()
    if not q:
        return "true", ()
    uid = _uuid(q)
    if uid:
        return "p.user_id = %s", (uid,)
    if staff.can("users.pii"):
        pattern = like_pattern(q)
        return "(u.email ilike %s escape '\\' or p.display_name ilike %s escape '\\')", (pattern, pattern)
    if EMAIL_LIKE.match(q):
        return "lower(u.email) = lower(%s)", (q,)
    prefix = like_pattern(q)[1:]
    return "p.display_name ilike %s escape '\\'", (prefix,)


@router.get("")
def list_users(q: str = Query(default="", max_length=200), kind: str = Query(default="all", pattern="^(all|accounts|guests|suspended)$"),
               limit: int = Query(default=25, ge=1, le=MAX_PAGE), offset: int = Query(default=0, ge=0, le=1_000_000),
               staff: Staff = Depends(require("users.view"))):
    condition, params = _search(staff, q)
    extra = {"all": "true", "accounts": "not p.is_anonymous", "guests": "p.is_anonymous",
             "suspended": "p.suspended_at is not null"}[kind]
    where = f"{condition} and {extra}"
    with connection() as conn:
        total = conn.execute(
            f"select count(*) c from public.profiles p join auth.users u on u.id = p.user_id where {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""select p.user_id, u.email, p.display_name, p.is_anonymous, p.created_at, u.last_sign_in_at,
                       p.daily_video_limit, p.suspended_at, s.role,
                       (select count(*) from public.user_videos uv where uv.user_id = p.user_id) as videos
                  from public.profiles p
                  join auth.users u on u.id = p.user_id
                  left join public.staff_roles s on s.user_id = p.user_id
                 where {where}
                 order by p.created_at desc, p.user_id
                 limit %s offset %s""", (*params, limit, offset)).fetchall()
    return {"total": total, "items": [_row(staff, r) for r in rows]}


@router.get("/{user_id}")
def user_detail(user_id: str, request: Request, staff: Staff = Depends(require("users.view"))):
    uid = _uuid(user_id)
    if not uid:
        raise AppError(404, "user_not_found", "User not found.")
    with connection() as conn:
        base = conn.execute(
            """select p.user_id, u.email, p.display_name, p.is_anonymous, p.created_at, u.last_sign_in_at,
                      p.daily_video_limit, p.suspended_at, p.suspended_reason, s.role,
                      (select count(*) from public.user_videos uv where uv.user_id = p.user_id) as videos
                 from public.profiles p
                 join auth.users u on u.id = p.user_id
                 left join public.staff_roles s on s.user_id = p.user_id
                where p.user_id = %s""", (uid,)).fetchone()
        if not base:
            raise AppError(404, "user_not_found", "User not found.")
        usage = conn.execute(
            """select (select count(*) from public.jobs where user_id = %(u)s) as jobs_total,
                      (select count(*) from public.jobs where user_id = %(u)s and status = 'failed'
                          and created_at > now() - interval '7 days') as jobs_failed_7d,
                      (select coalesce(count, 0) from public.generation_usage
                        where user_id = %(u)s and day = (now() at time zone 'UTC')::date) as generations_today,
                      (select count(*) from public.documents where user_id = %(u)s) as documents,
                      (select coalesce(sum(size_bytes), 0) from public.documents where user_id = %(u)s) as document_bytes
            """, {"u": uid}).fetchone()
        jobs = conn.execute(
            """select id, status, error_kind, error, source, created_at from public.jobs
                where user_id = %s order by created_at desc limit 10""", (uid,)).fetchall()
        tickets = conn.execute(
            "select id, subject, status, created_at from public.support_tickets where user_id = %s order by created_at desc limit 10",
            (uid,)).fetchall()
        audit.record(conn, staff, request, "user.view", target_type="user", target_id=uid)
    return {
        **_row(staff, base),
        "suspended_reason": base["suspended_reason"] if staff.can("users.suspend") else None,
        "usage": {k: int(v or 0) for k, v in dict(usage).items()},
        "recent_jobs": [{"id": str(j["id"]), "status": j["status"], "source": j["source"], "error_kind": j["error_kind"],
                         "error": (j["error"] or "")[:200] or None, "created_at": _iso(j["created_at"])} for j in jobs],
        "tickets": [{"id": str(t["id"]), "subject": t["subject"], "status": t["status"], "created_at": _iso(t["created_at"])}
                    for t in tickets],
    }


class SuspendIn(BaseModel):
    reason: str = Field(min_length=3, max_length=500)


class LimitIn(BaseModel):
    daily_video_limit: int = Field(ge=0, le=MAX_DAILY_LIMIT)


def _target(conn, staff: Staff, user_id: str) -> str:
    """The account to change. Staff cannot be suspended or limited here (take their role away first), and nobody
    changes their own account: that keeps one mistake from locking everyone out."""
    uid = _uuid(user_id)
    row = conn.execute(
        "select p.user_id, s.role from public.profiles p left join public.staff_roles s on s.user_id = p.user_id "
        "where p.user_id = %s", (uid,)).fetchone() if uid else None
    if not row:
        raise AppError(404, "user_not_found", "User not found.")
    if uid == staff.id:
        raise AppError(409, "own_account", "You cannot change your own account here.")
    if row["role"]:
        raise AppError(409, "staff_account", "This person is staff. Remove their staff role first.")
    return uid


@router.post("/{user_id}/suspend")
def suspend(user_id: str, payload: SuspendIn, request: Request, staff: Staff = Depends(require("users.suspend"))):
    with connection() as conn:
        uid = _target(conn, staff, user_id)
        with conn.transaction():
            conn.execute(
                "update public.profiles set suspended_at = now(), suspended_reason = %s, suspended_by = %s where user_id = %s",
                (payload.reason.strip(), staff.id, uid))
            audit.record(conn, staff, request, "user.suspend", target_type="user", target_id=uid,
                         detail={"reason": payload.reason.strip()})
    suspension.forget(uid)
    return {"suspended": True}


@router.post("/{user_id}/unsuspend")
def unsuspend(user_id: str, request: Request, staff: Staff = Depends(require("users.suspend"))):
    with connection() as conn:
        uid = _target(conn, staff, user_id)
        with conn.transaction():
            conn.execute(
                "update public.profiles set suspended_at = null, suspended_reason = null, suspended_by = null where user_id = %s",
                (uid,))
            audit.record(conn, staff, request, "user.unsuspend", target_type="user", target_id=uid)
    suspension.forget(uid)
    return {"suspended": False}


@router.post("/{user_id}/limit")
def set_limit(user_id: str, payload: LimitIn, request: Request, staff: Staff = Depends(require("users.limits"))):
    with connection() as conn:
        uid = _target(conn, staff, user_id)
        with conn.transaction():
            before = conn.execute("select daily_video_limit from public.profiles where user_id = %s", (uid,)).fetchone()
            conn.execute("update public.profiles set daily_video_limit = %s where user_id = %s",
                         (payload.daily_video_limit, uid))
            audit.record(conn, staff, request, "user.limit", target_type="user", target_id=uid,
                         detail={"from": before["daily_video_limit"], "to": payload.daily_video_limit})
    return {"daily_video_limit": payload.daily_video_limit}
