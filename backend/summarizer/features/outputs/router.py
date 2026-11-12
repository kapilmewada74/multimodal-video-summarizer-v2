from typing import Literal, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ..videos import repository as videos_repo
from . import service

router = APIRouter(prefix="/api/videos", tags=["outputs"])

Kind = Literal["flashcards", "quiz", "mindmap", "slides"]


class OutputRequest(BaseModel):
    force: bool = False
    # Also give the AI the user's own documents attached to this video. The result stays private to the user.
    use_documents: bool = False
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    num_questions: int = Field(default=5, ge=1, le=20)


@router.post("/{video_id}/outputs/{kind}")
def open_output(video_id: str, kind: Kind, payload: Optional[OutputRequest] = None,
                user: AuthUser = Depends(current_user)):
    """Open flashcards, a quiz, a mind map or slides for a video.

    The first request generates it (and counts toward the daily generation
    limit); after that everyone with the video gets the stored copy instantly.
    """
    payload = payload or OutputRequest()
    with connection() as conn:
        video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    try:
        return service.get_or_generate(
            user.id, str(video["id"]), kind, force=payload.force,
            difficulty=payload.difficulty, num_questions=payload.num_questions,
            use_documents=payload.use_documents)
    except AppError:
        raise
    except Exception:
        service.logger.exception("Generating %s failed", kind)
        raise AppError(500, "generation_failed", "Could not generate this. Please try again.")
