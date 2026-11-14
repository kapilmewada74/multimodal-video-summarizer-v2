"""Support tickets (from the Contact us form): list, read, take, change status, add a private note, reply by email."""
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...core.db import connection
from ...core.errors import AppError
from ..support import mail
from ..support.repository import STATUSES
from . import audit
from .guard import MAX_PAGE, Staff, like_pattern, require

router = APIRouter(prefix="/tickets")


def _iso(value):
    return value.isoformat() if value else None


def _uuid(value: str) -> str:
    try:
        return str(UUID(value))
    except ValueError:
        raise AppError(404, "ticket_not_found", "Ticket not found.")


def _summary(staff: Staff, r) -> dict:
    return {"id": str(r["id"]), "subject": r["subject"], "category": r["category"], "status": r["status"],
            "name": r["name"], "email": staff.see_email(r["email"]), "has_account": r["user_id"] is not None,
            "assigned_to": str(r["assigned_to"]) if r["assigned_to"] else None,
            "assigned_to_email": staff.see_email(r["assignee_email"]) if r["assignee_email"] else None,
            "created_at": _iso(r["created_at"]), "updated_at": _iso(r["updated_at"])}


@router.get("")
def list_tickets(status: str = Query(default="active", pattern="^(active|all|open|in_progress|resolved|spam)$"),
                 q: str = Query(default="", max_length=200), mine: bool = False,
                 limit: int = Query(default=25, ge=1, le=MAX_PAGE), offset: int = Query(default=0, ge=0, le=1_000_000),
                 staff: Staff = Depends(require("tickets.view"))):
    conditions, params = [], []
    if status == "active":
        conditions.append("t.status in ('open', 'in_progress')")
    elif status != "all":
        conditions.append("t.status = %s")
        params.append(status)
    if mine:
        conditions.append("t.assigned_to = %s")
        params.append(staff.id)
    if q.strip():
        pattern = like_pattern(q.strip())
        # The sender's address is searchable only by people who may see addresses (same reason as the user search).
        if staff.can("users.pii"):
            conditions.append("(t.subject ilike %s escape '\\' or t.message ilike %s escape '\\' or t.email ilike %s escape '\\')")
            params += [pattern, pattern, pattern]
        else:
            conditions.append("(t.subject ilike %s escape '\\' or t.message ilike %s escape '\\')")
            params += [pattern, pattern]
    where = " and ".join(conditions) or "true"
    with connection() as conn:
        total = conn.execute(f"select count(*) c from public.support_tickets t where {where}", params).fetchone()["c"]
        rows = conn.execute(
            f"""select t.*, a.email as assignee_email from public.support_tickets t
                  left join auth.users a on a.id = t.assigned_to
                 where {where}
                 order by (t.status in ('resolved', 'spam')), t.created_at desc
                 limit %s offset %s""", (*params, limit, offset)).fetchall()
        counts = conn.execute("select status, count(*) c from public.support_tickets group by status").fetchall()
    return {"total": total, "items": [_summary(staff, r) for r in rows],
            "counts": {s: 0 for s in STATUSES} | {c["status"]: c["c"] for c in counts}}


def _load(conn, ticket_id: str):
    row = conn.execute(
        "select t.*, a.email as assignee_email from public.support_tickets t left join auth.users a on a.id = t.assigned_to "
        "where t.id = %s", (_uuid(ticket_id),)).fetchone()
    if not row:
        raise AppError(404, "ticket_not_found", "Ticket not found.")
    return row


@router.get("/{ticket_id}")
def ticket_detail(ticket_id: str, staff: Staff = Depends(require("tickets.view"))):
    with connection() as conn:
        row = _load(conn, ticket_id)
        events = conn.execute(
            """select e.id, e.kind, e.body, e.created_at, u.email as actor_email from public.support_ticket_events e
                 left join auth.users u on u.id = e.actor_id where e.ticket_id = %s order by e.created_at, e.id""",
            (str(row["id"]),)).fetchall()
    return {**_summary(staff, row), "message": row["message"],
            "user_id": str(row["user_id"]) if row["user_id"] else None,
            "events": [{"id": e["id"], "kind": e["kind"], "body": e["body"], "by": staff.see_email(e["actor_email"]),
                        "created_at": _iso(e["created_at"])} for e in events]}


class TicketUpdate(BaseModel):
    status: Optional[Literal["open", "in_progress", "resolved", "spam"]] = None
    assign: Optional[Literal["me", "none"]] = None
    note: Optional[str] = Field(default=None, max_length=4000)


@router.post("/{ticket_id}")
def update_ticket(ticket_id: str, payload: TicketUpdate, request: Request, staff: Staff = Depends(require("tickets.manage"))):
    if payload.status is None and payload.assign is None and not (payload.note or "").strip():
        raise AppError(422, "nothing_to_change", "Nothing to change.")
    with connection() as conn:
        row = _load(conn, ticket_id)
        tid = str(row["id"])
        with conn.transaction():
            if payload.status and payload.status != row["status"]:
                conn.execute(
                    "update public.support_tickets set status = %s, resolved_at = case when %s in ('resolved', 'spam') then now() else null end where id = %s",
                    (payload.status, payload.status, tid))
                conn.execute("insert into public.support_ticket_events (ticket_id, actor_id, kind, body) values (%s, %s, 'status', %s)",
                             (tid, staff.id, f"{row['status']} -> {payload.status}"))
                audit.record(conn, staff, request, "ticket.status", target_type="ticket", target_id=tid,
                             detail={"from": row["status"], "to": payload.status})
            if payload.assign:
                owner = staff.id if payload.assign == "me" else None
                conn.execute("update public.support_tickets set assigned_to = %s where id = %s", (owner, tid))
                conn.execute("insert into public.support_ticket_events (ticket_id, actor_id, kind, body) values (%s, %s, 'assign', %s)",
                             (tid, staff.id, "took the ticket" if owner else "released the ticket"))
                audit.record(conn, staff, request, "ticket.assign", target_type="ticket", target_id=tid,
                             detail={"to": owner})
            note = (payload.note or "").strip()
            if note:
                conn.execute("insert into public.support_ticket_events (ticket_id, actor_id, kind, body) values (%s, %s, 'note', %s)",
                             (tid, staff.id, note))
                audit.record(conn, staff, request, "ticket.note", target_type="ticket", target_id=tid)
    return ticket_detail(tid, staff)


class ReplyIn(BaseModel):
    message: str = Field(min_length=5, max_length=4000)


@router.post("/{ticket_id}/reply")
def reply(ticket_id: str, payload: ReplyIn, request: Request, staff: Staff = Depends(require("tickets.manage"))):
    """Email an answer to the person who wrote in. The text is stored with the ticket."""
    if not mail.mail_available():
        raise AppError(409, "email_not_configured", "Email sending is not set up, so replies cannot be sent from here.")
    with connection() as conn:
        row = _load(conn, ticket_id)
    sent = mail.send_reply(row["email"], row["subject"], payload.message.strip())
    if not sent:
        raise AppError(502, "email_failed", "The email could not be sent. Please try again in a moment.")
    tid = str(row["id"])
    with connection() as conn, conn.transaction():
        conn.execute("insert into public.support_ticket_events (ticket_id, actor_id, kind, body) values (%s, %s, 'reply', %s)",
                     (tid, staff.id, payload.message.strip()))
        if row["status"] == "open":
            conn.execute("update public.support_tickets set status = 'in_progress' where id = %s", (tid,))
        audit.record(conn, staff, request, "ticket.reply", target_type="ticket", target_id=tid)
    return ticket_detail(tid, staff)
