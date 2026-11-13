import hashlib
import logging
import os
import tempfile
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_actor, current_user
from ...core.config import get_settings
from ...core.db import connection
from ...core.errors import AppError
from ...shared.storage import get_file_store
from ..documents.rules import safe_filename
from ..jobs import repository as repo
from ..limits.service import enforce_ip_limit
from .youtube import extract_video_id, is_valid_youtube_url

logger = logging.getLogger("summarizer.videos")
router = APIRouter(prefix="/api", tags=["videos"])

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".mp3", ".wav", ".m4a"}
CHUNK_BYTES = 1024 * 1024


class URLRequest(BaseModel):
    url: str = Field(max_length=2048)
    mode: Optional[str] = Field(default="educational", max_length=50)


def _safe_name(name: str) -> str:
    return safe_filename(name)


def _precheck_upload(request: Request, user: AuthUser) -> None:
    """Cheap checks done before the (possibly large) body is read."""
    with connection() as conn:
        enforce_ip_limit(conn, request)
        # Reject early if the user has no videos left.
        info = repo.usage(conn, user.id)
        if info["remaining"] <= 0:
            raise AppError(429, "daily_limit_reached",
                           f"You have used {info['used']} of {info['limit']} videos today. "
                           "Your limit resets at midnight.", extra={"usage": info})


def _store_and_enqueue(tmp_path: Path, user_id: str, file_hash: str, safe_name: str, mode: str) -> dict:
    key = f"{file_hash}__{safe_name}"
    with connection() as conn:
        known = conn.execute("select status from videos where file_hash = %s", (file_hash,)).fetchone()
        if not known or known["status"] != "ready":
            get_file_store().save(tmp_path, key)  # only needed if it must be processed
        return repo.enqueue_ingest(conn, user_id, "upload", key, None, file_hash, mode)


@router.post("/summarize/url")
def summarize_url(payload: URLRequest, request: Request, user: AuthUser = Depends(current_actor),):
    """Open to guests (free try-out) as well as accounts; guests have a smaller daily allowance."""
    url = (payload.url or "").strip()
    if not url:
        raise AppError(400, "url_required", "YouTube URL is required.")
    if not is_valid_youtube_url(url):
        raise AppError(400, "invalid_url", "Invalid YouTube URL. Please enter a valid YouTube link "
                       "(e.g. https://www.youtube.com/watch?v=... or https://youtu.be/...).")
    youtube_id = extract_video_id(url)

    with connection() as conn:
        enforce_ip_limit(conn, request)
        job = repo.enqueue_ingest(conn, user.id, "youtube", url, youtube_id, None, payload.mode or "educational",
                                  is_guest=user.is_guest)
    return {"job_id": str(job["id"]), "status": job["status"], "message": "Video summarization task started."}


@router.post("/summarize/upload")
async def summarize_upload(request: Request, file: UploadFile = File(...), mode: str = Form("educational"),
                           user: AuthUser = Depends(current_user),):
    if not file or not file.filename:
        raise AppError(400, "no_file", "No file was uploaded.")
    safe_name = _safe_name(file.filename)
    ext = os.path.splitext(safe_name)[1]
    if ext not in ALLOWED_EXTENSIONS:
        raise AppError(400, "unsupported_format",
                       f"Unsupported format '{ext}'. Allowed formats: {', '.join(sorted(ALLOWED_EXTENSIONS))}")

    settings = get_settings()
    # Database, network and disk work is blocking, so it runs in a worker
    # thread. Only the (non-blocking) reading of the request body stays on the
    # event loop; this keeps the server responsive during a large upload.
    await run_in_threadpool(_precheck_upload, request, user)

    tmp_dir = settings.data_dir / "tmp"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    digest, written = hashlib.sha256(), 0
    fd, tmp_name = tempfile.mkstemp(prefix="upload-", suffix=ext, dir=tmp_dir)
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "wb") as buffer:
            while True:
                chunk = await file.read(CHUNK_BYTES)
                if not chunk:
                    break
                written += len(chunk)
                if written > settings.max_upload_bytes:
                    raise AppError(413, "file_too_large",
                                   f"File is too large. The maximum upload size is "
                                   f"{settings.max_upload_bytes // (1024 * 1024)} MB.")
                digest.update(chunk)
                buffer.write(chunk)
        if written == 0:
            raise AppError(400, "empty_file", "The uploaded file is empty.")

        file_hash = digest.hexdigest()
        job = await run_in_threadpool(_store_and_enqueue, tmp_path, user.id, file_hash, safe_name, mode)
    finally:
        tmp_path.unlink(missing_ok=True)

    return {"job_id": str(job["id"]), "status": job["status"], "message": "File upload accepted and processing."}


@router.get("/job/{job_id}")
@router.get("/jobs/{job_id}")
def job_status(job_id: str, user: AuthUser = Depends(current_actor)):
    with connection() as conn:
        job = repo.get_job(conn, job_id, user.id)
        if not job:
            raise AppError(404, "job_not_found", "Job not found.")
        return repo.job_to_api(conn, job)


@router.get("/history")
def history(user: AuthUser = Depends(current_user)):
    with connection() as conn:
        return repo.history(conn, user.id)
