from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ..videos import repository as videos_repo

router = APIRouter(prefix="/api/videos", tags=["notes"])

MAX_NOTE_CHARS = 200_000


class NoteIn(BaseModel):
    content: str = Field(max_length=MAX_NOTE_CHARS)


def _owned(conn, user: AuthUser, video_id: str) -> str:
    video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    return str(video["id"])


@router.get("/{video_id}/notes")
def get_note(video_id: str, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        row = conn.execute("select content, updated_at from notes where user_id = %s and video_id = %s",
                           (user.id, vid)).fetchone()
    if not row:
        return {"content": "", "updated_at": None}
    return {"content": row["content"], "updated_at": row["updated_at"].isoformat()}


@router.put("/{video_id}/notes")
def save_note(video_id: str, payload: NoteIn, user: AuthUser = Depends(current_user)):
    """Save the note (replaces the previous text). Called automatically while typing."""
    with connection() as conn:
        vid = _owned(conn, user, video_id)
        row = conn.execute(
            """insert into notes (user_id, video_id, content) values (%s, %s, %s)
               on conflict (user_id, video_id) do update set content = excluded.content, updated_at = now()
               returning updated_at""", (user.id, vid, payload.content)).fetchone()
    return {"updated_at": row["updated_at"].isoformat(), "length": len(payload.content)}
