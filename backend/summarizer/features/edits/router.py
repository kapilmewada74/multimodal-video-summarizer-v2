"""A user's own edited summary or slides, with version history.

The AI output is never changed. An edit is stored per user, so it cannot
affect anyone else, and deleting it brings the AI version back.
"""
import json
import uuid
from typing import Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ..videos import repository as videos_repo

router = APIRouter(prefix="/api/videos", tags=["edits"])

Kind = Literal["summary", "slides"]
MAX_VERSIONS = 20
MAX_SUMMARY_CHARS = 200_000
MAX_SLIDES = 40
MAX_FIELD = 2_000
MAX_BULLETS = 12


class EditIn(BaseModel):
    content: Dict[str, Any]
    # The updated_at the editor last saw. A different value means another tab saved since.
    base_updated_at: Optional[str] = None


def _owned(conn, user: AuthUser, video_id: str) -> str:
    video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    return str(video["id"])


def _text(value: Any, limit: int) -> str:
    return str(value if value is not None else "").strip()[:limit]


def validate(kind: str, content: Dict[str, Any]) -> Dict[str, Any]:
    """Keep only the expected fields and bound their sizes."""
    if kind == "summary":
        markdown = content.get("markdown")
        if not isinstance(markdown, str):
            raise AppError(422, "invalid_edit", "The summary must be text.")
        if len(markdown) > MAX_SUMMARY_CHARS:
            raise AppError(413, "edit_too_large", "The summary is too long.")
        return {"markdown": markdown}

    slides = content.get("slides")
    if not isinstance(slides, list) or not 1 <= len(slides) <= MAX_SLIDES:
        raise AppError(422, "invalid_edit", f"A presentation needs 1 to {MAX_SLIDES} slides.")
    clean: List[Dict[str, Any]] = []
    for raw in slides:
        if not isinstance(raw, dict):
            raise AppError(422, "invalid_edit", "Each slide must be an object.")
        bullets = raw.get("bullets") if isinstance(raw.get("bullets"), list) else []
        slide = {
            "title": _text(raw.get("title"), 200),
            "kicker": _text(raw.get("kicker"), 200),
            "summary": _text(raw.get("summary"), MAX_FIELD),
            "bullets": [_text(b, 400) for b in bullets[:MAX_BULLETS] if _text(b, 400)],
            "layout": _text(raw.get("layout"), 50),
            "image_asset": _text(raw.get("image_asset"), 300),
            "notes": _text(raw.get("notes"), MAX_FIELD),
        }
        if not slide["title"]:
            raise AppError(422, "invalid_edit", "Every slide needs a title.")
        clean.append(slide)
    return {"title": _text(content.get("title"), 500), "slides": clean,
            "provider": _text(content.get("provider"), 50)}


def _version_uuid(version_id: str) -> str:
    try:
        return str(uuid.UUID(version_id))
    except ValueError:
        raise AppError(404, "version_not_found", "Version not found.")


def _iso(value) -> str:
    return value.isoformat()


@router.get("/{video_id}/edits/{kind}")
def get_edit(video_id: str, kind: Kind, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        row = conn.execute("select content, updated_at from user_edits where user_id = %s and video_id = %s and kind = %s",
                           (user.id, vid, kind)).fetchone()
        versions = conn.execute(
            """select id, created_at from user_edit_versions where user_id = %s and video_id = %s and kind = %s
               order by created_at desc limit %s""", (user.id, vid, kind, MAX_VERSIONS)).fetchall()
    return {
        "content": row["content"] if row else None,
        "updated_at": _iso(row["updated_at"]) if row else None,
        "versions": [{"id": str(v["id"]), "created_at": _iso(v["created_at"])} for v in versions],
    }


def _snapshot(conn, user_id: str, vid: str, kind: str) -> None:
    """Keep the current edit as a version and trim the history."""
    conn.execute(
        """insert into user_edit_versions (user_id, video_id, kind, content)
           select user_id, video_id, kind, content from user_edits
            where user_id = %s and video_id = %s and kind = %s""", (user_id, vid, kind))
    conn.execute(
        """delete from user_edit_versions where id in (
               select id from user_edit_versions where user_id = %s and video_id = %s and kind = %s
               order by created_at desc, id offset %s)""", (user_id, vid, kind, MAX_VERSIONS))


@router.put("/{video_id}/edits/{kind}")
def save_edit(video_id: str, kind: Kind, payload: EditIn, user: AuthUser = Depends(current_user)):
    """Save an edit. The previous state is kept as a version when the text changed."""
    content = validate(kind, payload.content)
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        current = conn.execute(
            "select content, updated_at from user_edits where user_id = %s and video_id = %s and kind = %s for update",
            (user.id, vid, kind)).fetchone()
        if current:
            if payload.base_updated_at and payload.base_updated_at != _iso(current["updated_at"]):
                raise AppError(409, "edit_conflict", "This was changed in another tab. Reload to see the latest.")
            if current["content"] == content:
                return {"updated_at": _iso(current["updated_at"]), "changed": False}
            _snapshot(conn, user.id, vid, kind)
        row = conn.execute(
            """insert into user_edits (user_id, video_id, kind, content) values (%s, %s, %s, %s::jsonb)
               on conflict (user_id, video_id, kind) do update set content = excluded.content, updated_at = clock_timestamp()
               returning updated_at""", (user.id, vid, kind, json.dumps(content))).fetchone()
    return {"updated_at": _iso(row["updated_at"]), "changed": True}


@router.get("/{video_id}/edits/{kind}/versions/{version_id}")
def get_version(video_id: str, kind: Kind, version_id: str, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        row = conn.execute(
            """select content, created_at from user_edit_versions
                where id = %s and user_id = %s and video_id = %s and kind = %s""",
            (_version_uuid(version_id), user.id, vid, kind)).fetchone()
    if not row:
        raise AppError(404, "version_not_found", "Version not found.")
    return {"content": row["content"], "created_at": _iso(row["created_at"])}


@router.post("/{video_id}/edits/{kind}/versions/{version_id}/restore")
def restore_version(video_id: str, kind: Kind, version_id: str, user: AuthUser = Depends(current_user)):
    """Make an older version current. What was current becomes a version, so nothing is lost."""
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        row = conn.execute(
            """select content from user_edit_versions where id = %s and user_id = %s and video_id = %s and kind = %s""",
            (_version_uuid(version_id), user.id, vid, kind)).fetchone()
        if not row:
            raise AppError(404, "version_not_found", "Version not found.")
        _snapshot(conn, user.id, vid, kind)
        saved = conn.execute(
            """insert into user_edits (user_id, video_id, kind, content) values (%s, %s, %s, %s::jsonb)
               on conflict (user_id, video_id, kind) do update set content = excluded.content, updated_at = clock_timestamp()
               returning content, updated_at""", (user.id, vid, kind, json.dumps(row["content"]))).fetchone()
    return {"content": saved["content"], "updated_at": _iso(saved["updated_at"])}


@router.delete("/{video_id}/edits/{kind}", status_code=204)
def reset_edit(video_id: str, kind: Kind, user: AuthUser = Depends(current_user)):
    """Back to the AI version. The edit is kept as a version so it can be restored."""
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        _snapshot(conn, user.id, vid, kind)
        conn.execute("delete from user_edits where user_id = %s and video_id = %s and kind = %s", (user.id, vid, kind))
