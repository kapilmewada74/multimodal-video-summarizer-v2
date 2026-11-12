from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ..videos import repository as videos_repo
from . import repository as repo

router = APIRouter(prefix="/api/videos", tags=["sharing"])
public_router = APIRouter(prefix="/api/public", tags=["public"])


def _owned_video(conn, user: AuthUser, video_id: str):
    video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    return video


@router.post("/{video_id}/share")
def create_share_link(video_id: str, user: AuthUser = Depends(current_user)):
    """Create (or return) the public read-only link for a video you own."""
    with connection() as conn:
        video = _owned_video(conn, user, video_id)
        if video["status"] != "ready":
            raise AppError(409, "video_not_ready", "Wait until the video has finished processing.")
        link = repo.create_or_get_link(conn, user.id, str(video["id"]))
        return {"token": link["token"], "active": True}


@router.delete("/{video_id}/share", status_code=204)
def revoke_share_link(video_id: str, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        video = _owned_video(conn, user, video_id)
        repo.revoke(conn, user.id, str(video["id"]))


@public_router.get("/{token}")
def public_video(token: str, request: Request):
    """No sign-in needed. Shows only what the owner chose to share."""
    if not (32 <= len(token) <= 64) or not all(c.isalnum() or c in "-_" for c in token):
        raise AppError(404, "link_not_found", "This link is not available.")
    with connection() as conn:
        view = repo.public_view(conn, token)
    if not view:
        raise AppError(404, "link_not_found", "This link is not available.")
    return JSONResponse(view, headers={"Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow"})
