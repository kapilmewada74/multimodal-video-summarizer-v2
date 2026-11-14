"""The Contact us form (public) and "my messages" (signed in).

Anyone can write to us without an account, so this endpoint is the one most exposed to spam. Defences, cheapest first:
a hidden field only bots fill in, a strict size/format check, a per-address and per-email rate limit in memory, and a
daily cap per address in the database. Nothing is emailed back to the sender automatically.
"""
import logging
import re
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, Request
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user, current_actor
from ...core.db import connection
from ...core.errors import AppError
from ...shared import throttle
from ...shared.net import client_ip, hash_ip
from . import mail, repository as repo

logger = logging.getLogger("summarizer.support")
router = APIRouter(prefix="/api", tags=["support"])

EMAIL = re.compile(r"^[^@\s<>\"',;:()\[\]\\]{1,64}@[A-Za-z0-9.-]{1,255}\.[A-Za-z]{2,24}$")
CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
MAX_PER_IP_PER_DAY = 30


class ContactIn(BaseModel):
    name: Optional[str] = Field(default=None, max_length=100)
    email: str = Field(max_length=254)
    category: str = "general"
    subject: Optional[str] = Field(default=None, max_length=150)
    message: str = Field(max_length=4000)
    # A field real people never see. A bot that fills in every field gives itself away.
    website: Optional[str] = Field(default=None, max_length=200)


def _clean(value: Optional[str]) -> str:
    return CONTROL.sub("", value or "").strip()


def _signed_in_user(authorization: Optional[str]) -> Optional[AuthUser]:
    """The sender's account if they are signed in (a guest counts). A missing or bad token just means "a visitor"."""
    if not authorization:
        return None
    try:
        return current_actor(authorization)
    except AppError:
        return None


@router.post("/contact", status_code=201)
def send_message(payload: ContactIn, request: Request, background: BackgroundTasks,
                 authorization: Optional[str] = Header(default=None)):
    if payload.website:   # a bot: look like success, store nothing
        return {"received": True}

    email, message = _clean(payload.email).lower(), _clean(payload.message)
    name = _clean(payload.name) or None
    category = payload.category if payload.category in repo.CATEGORIES else "general"
    subject = _clean(payload.subject) or message.replace("\n", " ")[:80]
    if not EMAIL.match(email):
        raise AppError(422, "invalid_email", "Please enter a valid email address so we can reply.")
    if len(message) < 10:
        raise AppError(422, "message_too_short", "Please write a little more so we can help (at least 10 characters).")
    if len(re.findall(r"https?://", message, flags=re.I)) > 3:
        raise AppError(422, "too_many_links", "Please remove some of the links and try again.")

    ip = client_ip(request)
    throttle.check(f"contact-ip:{ip}", 5, 3600, what="messages")
    throttle.check(f"contact-email:{email}", 3, 3600, what="messages")

    user = _signed_in_user(authorization)
    ip_hash = hash_ip(ip)
    with connection() as conn:
        if repo.recent_from_ip(conn, ip_hash) >= MAX_PER_IP_PER_DAY:
            raise AppError(429, "slow_down", "We have received a lot of messages from your network today. Please try again tomorrow.")
        ticket = repo.create(conn, user_id=user.id if user else None, email=email, name=name, category=category,
                             subject=subject, message=message, ip_hash=ip_hash)
    background.add_task(mail.notify_team, str(ticket["id"]), email=email, name=name, category=category,
                        subject=subject, message=message)
    return {"received": True}


@router.get("/me/messages")
def my_messages(user: AuthUser = Depends(current_user)):
    """What the person has sent us and whether it was answered (subject and status only)."""
    with connection() as conn:
        rows = repo.my_tickets(conn, user.id)
    return {"items": [{"id": str(r["id"]), "subject": r["subject"], "category": r["category"], "status": r["status"],
                       "created_at": r["created_at"].isoformat()} for r in rows]}
