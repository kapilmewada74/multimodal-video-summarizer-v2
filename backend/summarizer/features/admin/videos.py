"""Find a video and, if its shared flashcards, quiz, mind map or slides are bad, remove that copy.

Removing the shared copy does not delete anything people made themselves (their own regenerated copies, edits,
notes). The next person to open it generates a fresh shared copy. Staff never see transcripts or summaries here.
"""
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field

from ...core.db import connection
from ...core.errors import AppError
from ..outputs import repository as outputs_repo
from . import audit
from .guard import MAX_PAGE, Staff, like_pattern, require

router = APIRouter(prefix="/videos")

YOUTUBE_ID_LEN = 11


def _iso(value):
    return value.isoformat() if value else None


def _uuid(value: str) -> Optional[str]:
    try:
        return str(UUID(value))
    except ValueError:
        return None


def _card(r) -> dict:
    return {"id": str(r["id"]), "title": r["title"], "source": r["source"], "youtube_id": r["youtube_id"],
            "status": r["status"], "duration_seconds": r["duration_seconds"], "created_at": _iso(r["created_at"]),
            "users": r["users"], "outputs": r["outputs"] or []}


SELECT = """select v.id, v.title, v.source, v.youtube_id, v.status, v.duration_seconds, v.created_at,
                   (select count(*) from public.user_videos uv where uv.video_id = v.id) as users,
                   (select array_agg(distinct o.kind order by o.kind) from public.video_outputs o where o.video_id = v.id) as outputs
              from public.videos v"""


@router.get("")
def list_videos(q: str = Query(default="", max_length=200), limit: int = Query(default=25, ge=1, le=MAX_PAGE),
                offset: int = Query(default=0, ge=0, le=1_000_000), staff: Staff = Depends(require("videos.view"))):
    q = q.strip()
    if not q:
        where, params = "true", ()
    elif _uuid(q):
        where, params = "v.id = %s", (_uuid(q),)
    elif len(q) == YOUTUBE_ID_LEN and " " not in q:
        where, params = "(v.youtube_id = %s or v.title ilike %s escape '\\')", (q, like_pattern(q))
    else:
        where, params = "v.title ilike %s escape '\\'", (like_pattern(q),)
    with connection() as conn:
        total = conn.execute(f"select count(*) c from public.videos v where {where}", params).fetchone()["c"]
        rows = conn.execute(f"{SELECT} where {where} order by v.created_at desc limit %s offset %s",
                            (*params, limit, offset)).fetchall()
    return {"total": total, "items": [_card(r) for r in rows]}


@router.get("/{video_id}")
def video_detail(video_id: str, staff: Staff = Depends(require("videos.view"))):
    vid = _uuid(video_id)
    with connection() as conn:
        row = conn.execute(f"{SELECT} where v.id = %s", (vid,)).fetchone() if vid else None
        if not row:
            raise AppError(404, "video_not_found", "Video not found.")
        shared = conn.execute("select kind, variant, created_at from public.video_outputs where video_id = %s order by kind, variant",
                              (vid,)).fetchall()
        personal = conn.execute(
            "select kind, count(*) c from public.user_outputs where video_id = %s group by kind", (vid,)).fetchall()
    return {**_card(row),
            "shared_outputs": [{"kind": s["kind"], "variant": s["variant"], "created_at": _iso(s["created_at"])} for s in shared],
            "personal_copies": {p["kind"]: p["c"] for p in personal}}


class ResetIn(BaseModel):
    kind: Literal["flashcards", "quiz", "mindmap", "slides"]
    # For quizzes: one difficulty/length ("medium:5"). Left out, every variant of that kind is removed.
    variant: Optional[str] = Field(default=None, max_length=40)
    reason: str = Field(min_length=3, max_length=300)


@router.post("/{video_id}/outputs/reset")
def reset_shared_output(video_id: str, payload: ResetIn, request: Request, staff: Staff = Depends(require("outputs.reset"))):
    vid = _uuid(video_id)
    with connection() as conn:
        if not vid or not conn.execute("select 1 from public.videos where id = %s", (vid,)).fetchone():
            raise AppError(404, "video_not_found", "Video not found.")
        with conn.transaction():
            removed = outputs_repo.delete_shared_outputs(conn, vid, payload.kind, payload.variant)
            audit.record(conn, staff, request, "output.reset", target_type="video", target_id=vid,
                         detail={"kind": payload.kind, "variant": payload.variant, "removed": removed,
                                 "reason": payload.reason.strip()})
    return {"removed": removed}
