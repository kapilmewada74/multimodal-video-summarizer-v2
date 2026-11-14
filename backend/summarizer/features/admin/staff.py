"""Who is staff. Only admins can see or change this.

Guard rails that hold even if an admin makes a mistake (or an admin account is hijacked):
* nobody changes or removes their own role, so there is always at least the person acting left as an admin;
* the last admin can never be removed or demoted (checked under a lock, so two admins acting at once cannot both win);
* the number of admins is capped (MAX_ADMINS, default 5) because admins are meant to be a handful of main leads;
* a role can only be given to a real account (not a guest) that has signed in before.
"""
import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from ...core.db import connection
from ...core.errors import AppError
from . import audit
from .guard import Staff, require
from .permissions import ADMIN, ROLES, permissions_for

router = APIRouter(prefix="/staff")

LOCK_KEY = 7_340_001   # serialises staff changes (pg_advisory_xact_lock)


def max_admins() -> int:
    try:
        return max(1, int(os.getenv("MAX_ADMINS", "5")))
    except ValueError:
        return 5


def _iso(value):
    return value.isoformat() if value else None


def _uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError:
        raise AppError(404, "user_not_found", "User not found.")


def _list(conn):
    return conn.execute(
        """select s.user_id, s.role, s.created_at, u.email, g.email as granted_by_email
             from public.staff_roles s
             join auth.users u on u.id = s.user_id
             left join auth.users g on g.id = s.granted_by
            order by (s.role <> 'admin'), s.created_at""").fetchall()


def _payload(conn) -> dict:
    return {"items": [_public(r) for r in _list(conn)], "max_admins": max_admins(),
            "roles": {role: sorted(permissions_for(role)) for role in ROLES}}


def _public(r) -> dict:
    return {"id": str(r["user_id"]), "email": r["email"], "role": r["role"], "granted_by": r["granted_by_email"],
            "created_at": _iso(r["created_at"]), "permissions": sorted(permissions_for(r["role"]))}


@router.get("")
def list_staff(staff: Staff = Depends(require("staff.view"))):
    with connection() as conn:
        return _payload(conn)


class GrantIn(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    role: Literal["admin", "sub_admin"]


class RoleIn(BaseModel):
    role: Literal["admin", "sub_admin"]


def _admin_count(conn) -> int:
    return conn.execute("select count(*) c from public.staff_roles where role = 'admin'").fetchone()["c"]


@router.post("", status_code=201)
def grant(payload: GrantIn, request: Request, staff: Staff = Depends(require("staff.manage"))):
    email = payload.email.strip().lower()
    with connection() as conn, conn.transaction():
        conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
        user = conn.execute(
            "select id, is_anonymous from auth.users where lower(email) = %s and not coalesce(is_anonymous, false)", (email,)).fetchone()
        if not user:
            raise AppError(404, "user_not_found", "There is no account with that email. They need to sign in once first.")
        uid = str(user["id"])
        if uid == staff.id:
            raise AppError(409, "own_account", "You cannot change your own role.")
        if conn.execute("select 1 from public.staff_roles where user_id = %s", (uid,)).fetchone():
            raise AppError(409, "already_staff", "This person is already staff. Change their role instead.")
        if payload.role == ADMIN and _admin_count(conn) >= max_admins():
            raise AppError(409, "too_many_admins", f"There can be at most {max_admins()} admins.")
        conn.execute("insert into public.staff_roles (user_id, role, granted_by) values (%s, %s, %s)", (uid, payload.role, staff.id))
        audit.record(conn, staff, request, "staff.grant", target_type="user", target_id=uid,
                     detail={"role": payload.role, "email": email})
        return _payload(conn)


def _existing(conn, staff: Staff, user_id: str) -> dict:
    uid = _uuid(user_id)
    row = conn.execute("select user_id, role from public.staff_roles where user_id = %s", (uid,)).fetchone()
    if not row:
        raise AppError(404, "not_staff", "That person is not staff.")
    if uid == staff.id:
        raise AppError(409, "own_account", "You cannot change your own role.")
    return {"id": uid, "role": row["role"]}


@router.put("/{user_id}")
def change_role(user_id: str, payload: RoleIn, request: Request, staff: Staff = Depends(require("staff.manage"))):
    with connection() as conn, conn.transaction():
        conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
        target = _existing(conn, staff, user_id)
        if target["role"] == payload.role:
            return _payload(conn)
        if payload.role == ADMIN and _admin_count(conn) >= max_admins():
            raise AppError(409, "too_many_admins", f"There can be at most {max_admins()} admins.")
        if target["role"] == ADMIN and _admin_count(conn) <= 1:
            raise AppError(409, "last_admin", "There must always be at least one admin.")
        conn.execute("update public.staff_roles set role = %s where user_id = %s", (payload.role, target["id"]))
        audit.record(conn, staff, request, "staff.role", target_type="user", target_id=target["id"],
                     detail={"from": target["role"], "to": payload.role})
        return _payload(conn)


@router.delete("/{user_id}")
def remove(user_id: str, request: Request, staff: Staff = Depends(require("staff.manage"))):
    with connection() as conn, conn.transaction():
        conn.execute("select pg_advisory_xact_lock(%s)", (LOCK_KEY,))
        target = _existing(conn, staff, user_id)
        if target["role"] == ADMIN and _admin_count(conn) <= 1:
            raise AppError(409, "last_admin", "There must always be at least one admin.")
        conn.execute("delete from public.staff_roles where user_id = %s", (target["id"],))
        # Their open tickets go back to the pool so nothing waits on someone who no longer has access.
        conn.execute("update public.support_tickets set assigned_to = null where assigned_to = %s", (target["id"],))
        audit.record(conn, staff, request, "staff.remove", target_type="user", target_id=target["id"],
                     detail={"role": target["role"]})
        return _payload(conn)
