"""The user's library and the video detail used by the workspace page."""
from fastapi import APIRouter, Depends, Query

from ...core.auth import AuthUser, current_actor, current_user
from ...core.db import connection
from ...core.errors import AppError
from ...shared.public import public_engine
from ..jobs import repository as jobs_repo
from ..outputs import repository as outputs_repo
from ..sharing import repository as sharing_repo
from . import repository as repo

router = APIRouter(prefix="/api/videos", tags=["library"])


def _summary_item(row) -> dict:
    return {
        "id": str(row["id"]),
        "title": row["title"],
        "duration": row["duration_seconds"] or 0,
        "status": row["status"],
        "source": row["source"],
        "youtube_id": row["youtube_id"],
        "added_at": row["added_at"].isoformat(),
        "has_summary": bool(row.get("has_summary")),
        "progress_seconds": row.get("progress_seconds") or 0,
        "completed": row.get("completed_at") is not None,
    }


@router.get("")
def list_videos(limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0),
                user: AuthUser = Depends(current_user)):
    with connection() as conn:
        items = [_summary_item(r) for r in repo.list_library(conn, user.id, limit, offset)]
        return {"items": items, "total": repo.count_library(conn, user.id), "limit": limit, "offset": offset}


@router.get("/{video_id}")
def video_detail(video_id: str, user: AuthUser = Depends(current_actor)):
    with connection() as conn:
        video = repo.user_video(conn, user.id, video_id)
        if not video:
            raise AppError(404, "video_not_found", "Video not found.")
        vid = str(video["id"])
        detail = {
            "id": vid,
            "title": video["title"],
            "duration": video["duration_seconds"] or 0,
            "status": video["status"],
            "source": video["source"],
            "youtube_id": video["youtube_id"],
            "added_at": video["added_at"].isoformat(),
            "progress_seconds": video["progress_seconds"],
            "completed": video["completed_at"] is not None,
            "summary": None,
            "transcript": None,
            "outputs": [],
            "share": {"active": False, "token": None},
        }
        result = jobs_repo.get_result(conn, vid) if video["status"] == "ready" else None
        if result:
            detail["summary"] = result["summary"]
            detail["transcript"] = result["transcript"]
            detail["engine"] = public_engine(result["engine"])
        detail["outputs"] = outputs_repo.list_kinds(conn, vid)
        upload = conn.execute("select id from video_uploads where user_id = %s and video_id = %s order by created_at desc limit 1",
                              (user.id, vid)).fetchone()
        detail["upload_id"] = str(upload["id"]) if upload else None
        link = sharing_repo.active_link(conn, user.id, vid)
        if link:
            detail["share"] = {"active": True, "token": link["token"]}
        return detail


@router.delete("/{video_id}", status_code=204)
def remove_video(video_id: str, user: AuthUser = Depends(current_user)):
    """Remove from the user's library (the shared copy remains for others)."""
    with connection() as conn:
        video = repo.user_video(conn, user.id, video_id)
        if not video or not repo.remove_from_library(conn, user.id, str(video["id"])):
            raise AppError(404, "video_not_found", "Video not found.")
