from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends

from ...core.auth import AuthUser, current_actor, current_user
from ...core.config import get_settings
from ...core.db import connection
from ..documents import repository as documents_repo
from ..documents.rules import ALLOWED as DOCUMENT_TYPES
from ..jobs import repository as repo
from ..outputs import repository as outputs_repo
from ..videos.router import ALLOWED_EXTENSIONS as VIDEO_EXTENSIONS

router = APIRouter(prefix="/api/me", tags=["usage"])


@router.get("/usage")
def my_usage(user: AuthUser = Depends(current_actor)):
    """Videos used today, the daily limit and when it resets."""
    with connection() as conn:
        return {**repo.usage(conn, user.id, user.is_guest), "guest": user.is_guest}


@router.get("/limits")
def my_limits(user: AuthUser = Depends(current_user)):
    """Everything the account page shows: today's usage and every limit that applies to the person."""
    settings = get_settings()
    now = datetime.now(timezone.utc)
    next_utc_midnight = datetime.combine(now.date() + timedelta(days=1), time.min, tzinfo=timezone.utc)
    with connection() as conn:
        videos = repo.usage(conn, user.id)
        generations_used = outputs_repo.generations_today(conn, user.id)
        storage_used = documents_repo.storage_used(conn, user.id)
        document_count = documents_repo.document_count(conn, user.id)
    return {
        "videos": videos,
        "generations": {"used": generations_used, "limit": settings.generation_daily_limit,
                        "resets_at": next_utc_midnight.isoformat()},
        "uploads": {"max_bytes": settings.max_upload_bytes, "extensions": sorted(VIDEO_EXTENSIONS),
                    "max_video_seconds": settings.max_video_seconds},
        "documents": {"max_bytes": settings.max_document_bytes, "max_count": settings.max_documents_per_user,
                      "count": document_count, "extensions": sorted(DOCUMENT_TYPES)},
        "storage": {"used_bytes": storage_used, "quota_bytes": settings.user_storage_quota_bytes},
    }
