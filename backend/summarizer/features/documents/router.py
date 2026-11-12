import logging
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, RedirectResponse
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.config import get_settings
from ...core.db import connection
from ...core.errors import AppError
from ...shared import signing
from ...shared.http import safe_download_header
from ...shared.storage import get_file_store
from ...shared.uploads import receive
from ..jobs.repository import parse_uuid
from ..playlists import repository as playlists_repo
from ..videos import repository as videos_repo
from . import extract, repository as repo, rules

logger = logging.getLogger("summarizer.documents")
router = APIRouter(prefix="/api", tags=["documents"])

DOWNLOAD_PURPOSE = "document-download"
VIEW_PURPOSE = "document-view"
# Files a browser can show itself without running anything: PDF and plain pictures (never SVG or HTML).
INLINE_VIEWABLE = {".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp"}


def _owned_video_id(conn, user: AuthUser, video_id: Optional[str]) -> Optional[str]:
    if not video_id:
        return None
    video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    return str(video["id"])


def _lesson(conn, user: AuthUser, item_id: Optional[str]):
    """The playlist item a file is attached to (and the video it stands for, if any). Files cannot be attached to a file row."""
    if not item_id:
        return None, None
    iid = parse_uuid(item_id)
    item = playlists_repo.get_item(conn, user.id, iid) if iid else None
    if not item:
        raise AppError(404, "item_not_found", "That playlist item was not found.")
    if item["document_id"]:
        raise AppError(400, "not_a_lesson", "Files can only be attached to a video, not to another file.")
    return str(item["id"]), playlists_repo.item_video_id(conn, user.id, item)


@router.post("/documents", status_code=201)
async def upload_document(file: UploadFile = File(...), video_id: Optional[str] = Form(default=None),
                          playlist_item_id: Optional[str] = Form(default=None),
                          user: AuthUser = Depends(current_user)):
    """Upload a study document, optionally attached to one of your videos or to a playlist item (a lesson)."""
    name = rules.safe_filename(file.filename or "")
    ext = rules.extension_of(name)
    if ext not in rules.ALLOWED:
        allowed = ", ".join(sorted(e.lstrip(".") for e in rules.ALLOWED))
        raise AppError(400, "unsupported_format", f"This file type is not supported. Allowed types: {allowed}.")

    settings = get_settings()
    with connection() as conn:  # quick checks before reading a large body
        attach_to = _owned_video_id(conn, user, video_id)
        item_id, item_video = _lesson(conn, user, playlist_item_id)
        attach_to = attach_to or item_video  # a lesson whose video is known also attaches to that video
        repo.check_room(conn, user.id, 0, new_documents=1)

    received = await receive(file, settings.max_document_bytes, ext)
    try:
        return await run_in_threadpool(_store_document, user.id, attach_to, name, ext, received, item_id)
    finally:
        received.discard()


@router.post("/playlists/{playlist_id}/documents", status_code=201)
async def add_document_to_playlist(playlist_id: str, file: UploadFile = File(...), user: AuthUser = Depends(current_user)):
    """Upload a file as a row of its own in a playlist (ordered and moved like the videos)."""
    name = rules.safe_filename(file.filename or "")
    ext = rules.extension_of(name)
    if ext not in rules.ALLOWED:
        allowed = ", ".join(sorted(e.lstrip(".") for e in rules.ALLOWED))
        raise AppError(400, "unsupported_format", f"This file type is not supported. Allowed types: {allowed}.")
    pid = parse_uuid(playlist_id)
    with connection() as conn:
        if not (pid and playlists_repo.get_playlist(conn, user.id, pid)):
            raise AppError(404, "playlist_not_found", "Playlist not found.")
        if playlists_repo.count_items(conn, pid) >= playlists_repo.MAX_ITEMS:
            raise AppError(409, "playlist_full", f"A playlist can hold up to {playlists_repo.MAX_ITEMS} items.")
        repo.check_room(conn, user.id, 0, new_documents=1)
    received = await receive(file, get_settings().max_document_bytes, ext)
    try:
        return await run_in_threadpool(_store_loose_document, user.id, pid, name, ext, received)
    finally:
        received.discard()


def _store_loose_document(user_id: str, playlist_id: str, name: str, ext: str, received) -> dict:
    if not rules.content_matches(received.path, ext):
        raise AppError(400, "content_mismatch", f"This file does not look like a real {ext.lstrip('.').upper()} file.")
    status, text = extract.extract_text(received.path, ext)
    key = f"documents/{user_id}/{uuid.uuid4().hex}{ext}"
    store = get_file_store()
    with connection() as conn:
        repo.check_room(conn, user_id, received.size, new_documents=1)
        if repo.in_playlist_by_hash(conn, user_id, playlist_id, received.sha256):
            raise AppError(409, "already_uploaded", "This file is already in the playlist.")
        store.save(received.path, key)
        try:
            with conn.transaction():
                playlist = playlists_repo.get_playlist(conn, user_id, playlist_id, lock=True)
                if not playlist:
                    raise AppError(404, "playlist_not_found", "Playlist not found.")
                row = repo.insert(conn, user_id=user_id, video_id=None, filename=name, extension=ext.lstrip("."),
                                  mime=rules.ALLOWED[ext], size=received.size, sha256=received.sha256, storage_key=key,
                                  text_status=status, text=text)
                item = {"document_id": str(row["id"]), "title": name}
                playlists_repo.add_items(conn, playlist_id, [item])
                playlists_repo.touch(conn, playlist_id)
        except Exception:
            store.delete(key)
            raise
        return {**repo.view(row), "item_id": item.get("new_id")}


def _store_document(user_id: str, video_id: Optional[str], name: str, ext: str, received,
                    playlist_item_id: Optional[str] = None) -> dict:
    if not rules.content_matches(received.path, ext):
        raise AppError(400, "content_mismatch", f"This file does not look like a real {ext.lstrip('.').upper()} file.")
    status, text = extract.extract_text(received.path, ext)
    key = f"documents/{user_id}/{uuid.uuid4().hex}{ext}"
    store = get_file_store()
    with connection() as conn:
        repo.check_room(conn, user_id, received.size, new_documents=1)
        store.save(received.path, key)
        row = repo.insert(conn, user_id=user_id, video_id=video_id, filename=name, extension=ext.lstrip("."),
                          mime=rules.ALLOWED[ext], size=received.size, sha256=received.sha256, storage_key=key,
                          text_status=status, text=text, playlist_item_id=playlist_item_id)
        if row is None:
            store.delete(key)  # the same file is already there
            raise AppError(409, "already_uploaded", "You already uploaded this file here.")
        return repo.view(row)


@router.get("/documents")
def list_documents(video_id: Optional[str] = Query(default=None), standalone: bool = Query(default=False),
                   limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0),
                   user: AuthUser = Depends(current_user)):
    """Your documents. `video_id` = those attached to a video; `standalone=true` = those not attached to any."""
    with connection() as conn:
        vid = None
        if video_id:
            vid = parse_uuid(video_id)
            if not vid:
                raise AppError(404, "video_not_found", "Video not found.")
        items = [repo.view(r) for r in repo.list_documents(conn, user.id, video_id=vid, standalone=standalone, limit=limit, offset=offset)]
        return {"items": items, "total": repo.count(conn, user.id, video_id=vid, standalone=standalone),
                "storage": _storage(conn, user.id)}


def _storage(conn, user_id: str) -> dict:
    settings = get_settings()
    return {"used_bytes": repo.storage_used(conn, user_id), "quota_bytes": settings.user_storage_quota_bytes,
            "max_document_bytes": settings.max_document_bytes}


@router.get("/me/storage")
def my_storage(user: AuthUser = Depends(current_user)):
    with connection() as conn:
        return {**_storage(conn, user.id), "document_count": repo.document_count(conn, user.id)}


class DocumentPatch(BaseModel):
    filename: Optional[str] = Field(default=None, min_length=1, max_length=200)
    video_id: Optional[str] = None
    playlist_item_id: Optional[str] = None


@router.patch("/documents/{document_id}")
def update_document(document_id: str, payload: DocumentPatch, user: AuthUser = Depends(current_user)):
    """Rename a document, or attach it to a video / detach it (`video_id: null`)."""
    did = parse_uuid(document_id)
    with connection() as conn:
        current = repo.get(conn, user.id, did) if did else None
        if not current:
            raise AppError(404, "document_not_found", "Document not found.")
        name = None
        if payload.filename is not None:
            name = rules.safe_filename(payload.filename)
            if rules.extension_of(name) != "." + current["extension"]:
                name = rules.safe_filename(name.rsplit(".", 1)[0] + "." + current["extension"])
        change_video = "video_id" in payload.model_fields_set
        vid = _owned_video_id(conn, user, payload.video_id) if change_video else None
        change_item = "playlist_item_id" in payload.model_fields_set
        item_id = _lesson(conn, user, payload.playlist_item_id)[0] if change_item else None
        row = repo.update(conn, user.id, did, filename=name, video_id=vid, change_video=change_video,
                          playlist_item_id=item_id, change_item=change_item)
        return repo.view(row)


@router.delete("/documents/{document_id}", status_code=204)
def delete_document(document_id: str, user: AuthUser = Depends(current_user)):
    did = parse_uuid(document_id)
    with connection() as conn:
        key = repo.delete(conn, user.id, did) if did else None
    if key is None:
        raise AppError(404, "document_not_found", "Document not found.")
    try:
        get_file_store().delete(key)
    except Exception:
        logger.warning("Could not delete a document file", exc_info=True)


@router.get("/documents/{document_id}/text")
def document_text(document_id: str, user: AuthUser = Depends(current_user)):
    """The text read from the document (for notes, search and AI features)."""
    did = parse_uuid(document_id)
    with connection() as conn:
        row = repo.get(conn, user.id, did, "id, filename, text_status, extracted_text") if did else None
    if not row:
        raise AppError(404, "document_not_found", "Document not found.")
    return {"id": str(row["id"]), "filename": row["filename"], "text_status": row["text_status"], "text": row["extracted_text"] or ""}


@router.get("/documents/{document_id}/download-url")
def download_url(document_id: str, user: AuthUser = Depends(current_user)):
    """A temporary download address (valid for 10 minutes)."""
    did = parse_uuid(document_id)
    with connection() as conn:
        row = repo.get(conn, user.id, did) if did else None
    if not row:
        raise AppError(404, "document_not_found", "Document not found.")
    token = signing.sign(DOWNLOAD_PURPOSE, str(row["id"]))
    return {"url": f"/api/documents/{row['id']}/file?token={token}", "expires_in": 600}


@router.get("/documents/{document_id}/file")
def download_file(document_id: str, token: str = Query(default=""), request: Request = None):
    """The file itself, always as a download. Needs the temporary token, not a login."""
    did = parse_uuid(document_id)
    if not did or not signing.verify(DOWNLOAD_PURPOSE, did, token):
        raise AppError(403, "link_expired", "This download link has expired. Please try again.")
    with connection() as conn:
        row = repo.get_any(conn, did)
    if not row:
        raise AppError(404, "document_not_found", "Document not found.")
    headers = {
        "Content-Disposition": safe_download_header(row["filename"].rsplit(".", 1)[0], row["filename"].rsplit(".", 1)[-1]),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    }
    store = get_file_store()
    path = store.local_path(row["storage_key"])
    if path:
        return FileResponse(path, media_type=row["mime"], headers=headers)
    url = store.signed_url(row["storage_key"], 120, download_name=row["filename"])
    if not url:
        raise AppError(404, "file_missing", "The file is no longer available.")
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})



@router.get("/documents/{document_id}/view-url")
def view_url(document_id: str, user: AuthUser = Depends(current_user)):
    """A temporary address to show the file inside the page (PDF and pictures only)."""
    did = parse_uuid(document_id)
    with connection() as conn:
        row = repo.get(conn, user.id, did) if did else None
    if not row:
        raise AppError(404, "document_not_found", "Document not found.")
    if "." + row["extension"] not in INLINE_VIEWABLE:
        raise AppError(415, "not_viewable", "This kind of file cannot be shown here. You can still download it.")
    token = signing.sign(VIEW_PURPOSE, str(row["id"]))
    return {"url": f"/api/documents/{row['id']}/view?token={token}", "kind": "pdf" if row["extension"] == "pdf" else "image",
            "expires_in": 600}


@router.get("/documents/{document_id}/view")
def view_file(document_id: str, token: str = Query(default="")):
    """The file shown inline. Only for PDF and pictures, only with a temporary token."""
    did = parse_uuid(document_id)
    if not did or not signing.verify(VIEW_PURPOSE, did, token):
        raise AppError(403, "link_expired", "This link has expired. Please open the file again.")
    with connection() as conn:
        row = conn.execute("select id, filename, extension, mime, storage_key from documents where id = %s", (did,)).fetchone()
    if not row or "." + row["extension"] not in INLINE_VIEWABLE:
        raise AppError(404, "document_not_found", "Document not found.")
    headers = {
        "Content-Disposition": safe_download_header(row["filename"].rsplit(".", 1)[0], row["extension"]).replace("attachment", "inline", 1),
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        # May be shown only inside our own pages; pictures also get no way to run anything.
        "Content-Security-Policy": "frame-ancestors 'self'" if row["extension"] == "pdf" else "default-src 'none'; img-src 'self' data:; frame-ancestors 'self'",
    }
    store = get_file_store()
    path = store.local_path(row["storage_key"])
    if path:
        return FileResponse(path, media_type=row["mime"], headers=headers)
    url = store.signed_url(row["storage_key"], 120)
    if not url:
        raise AppError(404, "file_missing", "The file is no longer available.")
    return RedirectResponse(url, status_code=302, headers={"Cache-Control": "no-store"})
