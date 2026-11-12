from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ...shared.http import safe_download_header
from ..jobs import repository as jobs_repo
from ..outputs import repository as outputs_repo
from ..videos import repository as videos_repo
from . import drive
from .service import build_markdown

router = APIRouter(prefix="/api/videos", tags=["export"])


def _study_pack(user: AuthUser, video_id: str):
    """(title, Markdown) of everything the user has for this video."""
    with connection() as conn:
        video = videos_repo.user_video(conn, user.id, video_id)
        if not video:
            raise AppError(404, "video_not_found", "Video not found.")
        result = jobs_repo.get_result(conn, str(video["id"]))
        if not result:
            raise AppError(409, "video_not_ready", "This video is still being processed.")
        outputs = outputs_repo.all_outputs(conn, str(video["id"]))
        edited = conn.execute("select content from user_edits where user_id = %s and video_id = %s and kind = 'summary'",
                              (user.id, str(video["id"]))).fetchone()
    if edited:  # the user's own edited summary replaces the AI one in their export
        result = {**result, "summary": edited["content"].get("markdown", "")}
    return result["title"] or "study-notes", build_markdown(result, outputs)


@router.get("/{video_id}/export.md")
def export_markdown(video_id: str, user: AuthUser = Depends(current_user)):
    title, body = _study_pack(user, video_id)
    return Response(content=body, media_type="text/markdown; charset=utf-8",
                    headers={"Content-Disposition": safe_download_header(title, "md")})


class DriveRequest(BaseModel):
    # A short-lived Google access token with the drive.file permission. Used once, never stored.
    access_token: str = Field(min_length=10, max_length=4096, pattern=r"^[\x21-\x7e]+$")


@router.post("/{video_id}/export/drive")
def export_to_drive(video_id: str, payload: DriveRequest, user: AuthUser = Depends(current_user)):
    """Save the study pack as a Google Doc in the user's own Drive."""
    title, body = _study_pack(user, video_id)
    try:
        return drive.upload_document(payload.access_token, title, body)
    except drive.DriveAuthError:
        raise AppError(400, "drive_auth", "Google Drive did not accept the permission. Connect Google Drive again.")
    except drive.DriveError:
        raise AppError(502, "drive_failed", "Could not save to Google Drive. Please try again.")
