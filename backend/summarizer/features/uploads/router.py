import logging
import tempfile
import uuid
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.config import get_settings
from ...core.db import connection
from ...core.errors import AppError
from ...shared import signing
from ...shared.storage import get_file_store
from ...shared.uploads import receive
from ..documents import repository as documents_repo
from ..documents import rules
from ..jobs.repository import parse_uuid
from ..limits.service import enforce_ip_limit
from ..playlists import repository as playlists_repo
from ..playlists.views import item_view
from ..videos.router import _store_and_enqueue
from . import repository as repo

logger = logging.getLogger("summarizer.uploads")
router = APIRouter(prefix="/api", tags=["uploads"])

STREAM_PURPOSE = "upload-stream"


@router.post("/playlists/{playlist_id}/uploads", status_code=201)
async def upload_to_playlist(playlist_id: str, file: UploadFile = File(...), user: AuthUser = Depends(current_user)):
    """Upload a video or audio file from your device into a playlist.

    It is stored so you can play it. It is not summarized (and does not use your daily
    videos) until you press Summarize on it.
    """
    name = rules.safe_filename(file.filename or "")
    ext = rules.extension_of(name)
    if ext not in rules.VIDEO_TYPES:
        allowed = ", ".join(sorted(e.lstrip(".") for e in rules.VIDEO_TYPES))
        raise AppError(400, "unsupported_format", f"This file type is not supported. Allowed types: {allowed}.")

    pid = parse_uuid(playlist_id)
    with connection() as conn:
        playlist = playlists_repo.get_playlist(conn, user.id, pid) if pid else None
        if not playlist:
            raise AppError(404, "playlist_not_found", "Playlist not found.")
        if playlists_repo.count_items(conn, str(playlist["id"])) >= playlists_repo.MAX_ITEMS:
            raise AppError(409, "playlist_full", f"A playlist can hold up to {playlists_repo.MAX_ITEMS} videos.")
        documents_repo.check_room(conn, user.id, 0)

    received = await receive(file, get_settings().max_upload_bytes, ext)
    try:
        return await run_in_threadpool(_store_upload, user.id, str(playlist["id"]), name, ext, received)
    finally:
        received.discard()


def _store_upload(user_id: str, playlist_id: str, name: str, ext: str, received) -> dict:
    if not rules.video_content_matches(received.path, ext):
        raise AppError(400, "content_mismatch", f"This file does not look like a real {ext.lstrip('.').upper()} file.")
    key = f"kept-videos/{user_id}/{uuid.uuid4().hex}{ext}"
    store = get_file_store()
    with connection() as conn:
        documents_repo.check_room(conn, user_id, received.size)
        store.save(received.path, key)
        try:
            with conn.transaction():
                playlist = playlists_repo.get_playlist(conn, user_id, playlist_id, lock=True)
                if not playlist:
                    raise AppError(404, "playlist_not_found", "Playlist not found.")
                if playlists_repo.count_items(conn, playlist_id) >= playlists_repo.MAX_ITEMS:
                    raise AppError(409, "playlist_full", f"A playlist can hold up to {playlists_repo.MAX_ITEMS} videos.")
                upload = repo.insert(conn, user_id=user_id, filename=name, mime=rules.VIDEO_TYPES[ext],
                                     size=received.size, sha256=received.sha256, storage_key=key)
                item = {"upload_id": str(upload["id"]), "title": name}
                playlists_repo.add_items(conn, playlist_id, [item])
                playlists_repo.touch(conn, playlist_id)
        except BaseException:
            store.delete(key)  # nothing refers to the file any more
            raise
        row = next(r for r in playlists_repo.list_items(conn, user_id, playlist_id) if str(r["id"]) == item["new_id"])
        return item_view(row)


@router.get("/uploads/{upload_id}/stream-url")
def stream_url(upload_id: str, user: AuthUser = Depends(current_user)):
    """A temporary address for playing the uploaded video in the browser (valid for 10 minutes)."""
    uid = parse_uuid(upload_id)
    with connection() as conn:
        row = repo.get(conn, user.id, uid) if uid else None
    if not row:
        raise AppError(404, "upload_not_found", "Upload not found.")
    return {"url": f"/api/uploads/{row['id']}/stream?token={signing.sign(STREAM_PURPOSE, str(row['id']))}", "expires_in": 600,
            "mime": row["mime"]}


@router.get("/uploads/{upload_id}/stream")
def stream(upload_id: str, token: str = Query(default=""), request: Request = None):
    """The video itself, with support for seeking. Needs the temporary token, not a login."""
    uid = parse_uuid(upload_id)
    if not uid or not signing.verify(STREAM_PURPOSE, uid, token):
        raise AppError(403, "link_expired", "This video link has expired. Please reload the page.")
    with connection() as conn:
        row = repo.get_any(conn, uid)
    if not row:
        raise AppError(404, "upload_not_found", "Upload not found.")
    store = get_file_store()
    headers = {"X-Content-Type-Options": "nosniff", "Cache-Control": "private, no-store"}
    path = store.local_path(row["storage_key"])
    if path:
        return FileResponse(path, media_type=row["mime"], headers=headers)  # supports Range requests
    url = store.signed_url(row["storage_key"], 600)
    if not url:
        raise AppError(404, "file_missing", "The file is no longer available.")
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})


class SummarizeIn(BaseModel):
    mode: Optional[str] = Field(default="educational", max_length=50)


@router.post("/uploads/{upload_id}/summarize")
def summarize_upload(upload_id: str, request: Request, payload: Optional[SummarizeIn] = None,
                     user: AuthUser = Depends(current_user)):
    """Send an uploaded video to the summarizer. This counts as one of your daily videos."""
    uid = parse_uuid(upload_id)
    mode = (payload.mode if payload else None) or "educational"
    with connection() as conn:
        upload = repo.get(conn, user.id, uid) if uid else None
        if not upload:
            raise AppError(404, "upload_not_found", "Upload not found.")
        if upload["video_id"]:
            video = conn.execute("select status from videos where id = %s", (upload["video_id"],)).fetchone()
            if video and video["status"] in ("pending", "processing"):
                raise AppError(409, "already_processing", "This video is already being summarized.")
            if video and video["status"] == "ready":
                raise AppError(409, "already_summarized", "This video has already been summarized.")
        enforce_ip_limit(conn, request)

    # The summarizer works on (and then deletes) its own copy; the original stays for playback.
    store = get_file_store()
    tmp_dir = get_settings().data_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(dir=tmp_dir) as work:
        local = Path(work) / upload["filename"]
        try:
            store.fetch(upload["storage_key"], local)
        except Exception:
            logger.warning("Could not read an uploaded video", exc_info=True)
            raise AppError(404, "file_missing", "The uploaded file is no longer available.")
        job = _store_and_enqueue(local, user.id, upload["sha256"], upload["filename"], mode)
    with connection() as conn:
        if job.get("video_id"):
            repo.link_video(conn, str(upload["id"]), str(job["video_id"]))
    return {"job_id": str(job["id"]), "status": job["status"], "video_id": str(job["video_id"]) if job["video_id"] else None}


@router.delete("/uploads/{upload_id}", status_code=204)
def delete_upload(upload_id: str, user: AuthUser = Depends(current_user)):
    uid = parse_uuid(upload_id)
    with connection() as conn:
        key = repo.delete(conn, user.id, uid) if uid else None
    if key is None:
        raise AppError(404, "upload_not_found", "Upload not found.")
    try:
        get_file_store().delete(key)
    except Exception:
        logger.warning("Could not delete an uploaded video file", exc_info=True)

