from typing import Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator

from ...core.auth import AuthUser, current_user
from ...core.config import get_settings
from ...core.db import connection
from ...core.errors import AppError
from ..jobs.repository import parse_uuid
from . import email as email_channel
from . import push as push_channel
from . import repository as repo

router = APIRouter(prefix="/api", tags=["notifications"])

Kind = Literal["goal_reached", "streak_at_risk", "streak_milestone", "summary_ready"]
Channel = Literal["in_app", "email", "push"]


def _item(row) -> dict:
    return {"id": str(row["id"]), "type": row["type"], "title": row["title"], "body": row["body"],
            "link": row["link"], "created_at": row["created_at"].isoformat(), "read": row["read_at"] is not None}


@router.get("/notifications")
def list_notifications(limit: int = Query(30, ge=1, le=100), user: AuthUser = Depends(current_user)):
    with connection() as conn:
        return {"items": [_item(r) for r in repo.list_notifications(conn, user.id, limit)],
                "unread": repo.unread_count(conn, user.id)}


class ReadRequest(BaseModel):
    ids: Optional[List[str]] = Field(default=None, max_length=100)
    all: bool = False


@router.post("/notifications/read")
def mark_read(payload: ReadRequest, user: AuthUser = Depends(current_user)):
    """Mark some (`ids`) or all (`all: true`) notifications as read."""
    if not payload.all and not payload.ids:
        raise AppError(400, "nothing_to_mark", "Choose which notifications to mark as read.")
    ids = None if payload.all else [i for i in (parse_uuid(x) for x in payload.ids or []) if i]
    with connection() as conn:
        repo.mark_read(conn, user.id, ids)
        return {"unread": repo.unread_count(conn, user.id)}


class SettingsUpdate(BaseModel):
    prefs: Optional[Dict[Kind, Dict[Channel, bool]]] = None
    reminder_hour: Optional[int] = Field(default=None, ge=0, le=23)
    quiet_start: Optional[int] = Field(default=None, ge=0, le=23)
    quiet_end: Optional[int] = Field(default=None, ge=0, le=23)
    clear_quiet_hours: bool = False


def _settings_view(conn, user_id: str) -> dict:
    s = repo.profile_settings(conn, user_id)
    return {
        "prefs": repo.effective_prefs(conn, user_id),
        "reminder_hour": s["reminder_hour"], "quiet_start": s["quiet_start"], "quiet_end": s["quiet_end"],
        "timezone": s["timezone"],
        "email_available": email_channel.email_available(),
        "push_available": push_channel.push_available(),
        "push_subscribed": bool(repo.list_push_subscriptions(conn, user_id)),
    }


@router.get("/notifications/settings")
def get_settings_view(user: AuthUser = Depends(current_user)):
    with connection() as conn:
        return _settings_view(conn, user.id)


@router.put("/notifications/settings")
def update_settings(payload: SettingsUpdate, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        if payload.prefs:
            repo.save_prefs(conn, user.id, payload.prefs)
        fields = {}
        if payload.reminder_hour is not None:
            fields["reminder_hour"] = payload.reminder_hour
        if payload.clear_quiet_hours:
            fields.update(quiet_start=None, quiet_end=None)
        elif payload.quiet_start is not None or payload.quiet_end is not None:
            if payload.quiet_start is None or payload.quiet_end is None:
                raise AppError(400, "quiet_hours_incomplete", "Set both the start and the end of quiet hours.")
            fields.update(quiet_start=payload.quiet_start, quiet_end=payload.quiet_end)
        repo.save_profile_settings(conn, user.id, **fields)
        return _settings_view(conn, user.id)


class PushKeys(BaseModel):
    p256dh: str = Field(min_length=10, max_length=300)
    auth: str = Field(min_length=10, max_length=100)


class PushSubscription(BaseModel):
    endpoint: str = Field(max_length=1000)
    keys: PushKeys

    @field_validator("endpoint")
    @classmethod
    def only_real_push_services(cls, value: str) -> str:
        if not push_channel.is_allowed_endpoint(value):
            raise ValueError("Unsupported push service address.")
        return value


@router.get("/push/public-key")
def push_public_key(user: AuthUser = Depends(current_user)):
    if not push_channel.push_available():
        raise AppError(404, "push_unavailable", "Browser notifications are not set up on this server.")
    return {"public_key": get_settings().vapid_public_key}


@router.post("/push/subscribe", status_code=204)
def subscribe(payload: PushSubscription, user: AuthUser = Depends(current_user)):
    if not push_channel.push_available():
        raise AppError(404, "push_unavailable", "Browser notifications are not set up on this server.")
    with connection() as conn:
        if not repo.add_push_subscription(conn, user.id, payload.endpoint, payload.keys.p256dh, payload.keys.auth):
            raise AppError(409, "too_many_devices",
                           f"You can enable notifications on up to {repo.MAX_SUBSCRIPTIONS_PER_USER} browsers.")


class Unsubscribe(BaseModel):
    endpoint: str = Field(max_length=1000)


@router.post("/push/unsubscribe", status_code=204)
def unsubscribe(payload: Unsubscribe, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        repo.delete_push_subscription(conn, user.id, payload.endpoint)
