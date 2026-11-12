import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, model_validator

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ...shared.storage import get_file_store
from ..jobs.repository import parse_uuid
from ..documents import repository as documents_repo
from ..uploads import repository as uploads_repo
from ..videos import repository as videos_repo
from ..videos.youtube import extract_video_id, is_valid_youtube_url
from . import repository as repo
from . import sources
from .views import item_view as _item_view

logger = logging.getLogger("summarizer.playlists")
router = APIRouter(prefix="/api/playlists", tags=["playlists"])


def _playlist_view(row) -> Dict[str, Any]:
    return {"id": str(row["id"]), "title": row["title"], "source": row["source"],
            "item_count": row.get("item_count", 0), "completed_count": row.get("completed_count", 0),
            "updated_at": row["updated_at"].isoformat()}


def _owned(conn, user: AuthUser, playlist_id: str, lock: bool = False):
    pid = parse_uuid(playlist_id)
    playlist = repo.get_playlist(conn, user.id, pid, lock=lock) if pid else None
    if not playlist:
        raise AppError(404, "playlist_not_found", "Playlist not found.")
    return playlist


class PlaylistIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)

    @model_validator(mode="after")
    def clean(self):
        self.title = " ".join(self.title.split())
        if not self.title:
            raise ValueError("Title is required.")
        return self


@router.get("")
def list_playlists(user: AuthUser = Depends(current_user)):
    with connection() as conn:
        return {"items": [_playlist_view(r) for r in repo.list_playlists(conn, user.id)]}


@router.post("", status_code=201)
def create_playlist(payload: PlaylistIn, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        if repo.count_playlists(conn, user.id) >= repo.MAX_PLAYLISTS:
            raise AppError(409, "too_many_playlists", f"You can have up to {repo.MAX_PLAYLISTS} playlists.")
        return _playlist_view(repo.create_playlist(conn, user.id, payload.title))


@router.get("/{playlist_id}")
def get_playlist(playlist_id: str, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        playlist = _owned(conn, user, playlist_id)
        rows = repo.list_items(conn, user.id, str(playlist["id"]))
        items = [_item_view(r) for r in rows]
        # Files attached to a lesson: to the playlist item itself, or to the video it stands for.
        attached = documents_repo.for_items(
            conn, user.id, [i["id"] for i in items if i["kind"] != "document"],
            [i["video_id"] for i in items if i["video_id"]])
        for item in items:
            if item["kind"] == "document":
                continue
            item["documents"] = [documents_repo.view(d) for d in attached
                                 if str(d["playlist_item_id"] or "") == item["id"]
                                 or (item["video_id"] and str(d["video_id"] or "") == item["video_id"])]
    view = {"id": str(playlist["id"]), "title": playlist["title"], "source": playlist["source"],
            "updated_at": playlist["updated_at"].isoformat(), "items": items}
    view["item_count"], view["completed_count"] = len(items), sum(1 for i in items if i["completed"])
    return view


@router.patch("/{playlist_id}")
def rename_playlist(playlist_id: str, payload: PlaylistIn, user: AuthUser = Depends(current_user)):
    with connection() as conn:
        playlist = _owned(conn, user, playlist_id)
        conn.execute("update playlists set title = %s, updated_at = now() where id = %s", (payload.title, playlist["id"]))
    return {"id": str(playlist["id"]), "title": payload.title}


@router.delete("/{playlist_id}", status_code=204)
def delete_playlist(playlist_id: str, user: AuthUser = Depends(current_user)):
    keys = []
    with connection() as conn:
        playlist = _owned(conn, user, playlist_id)
        with conn.transaction():
            # Videos uploaded from the device live only in this playlist, so they are removed with it.
            for row in conn.execute("select id, upload_id, document_id from playlist_items where playlist_id = %s",
                                    (playlist["id"],)).fetchall():
                if row["upload_id"]:
                    key = uploads_repo.delete(conn, user.id, str(row["upload_id"]))
                    if key:
                        keys.append(key)
                if row["document_id"]:  # a loose file lives only in this playlist
                    key = documents_repo.delete(conn, user.id, str(row["document_id"]))
                    if key:
                        keys.append(key)
                keys.extend(documents_repo.delete_attached_to_item(conn, user.id, str(row["id"])))
            conn.execute("delete from playlists where id = %s", (playlist["id"],))
    store = get_file_store()
    for key in keys:
        try:
            store.delete(key)
        except Exception:
            logger.warning("Could not delete an uploaded video file", exc_info=True)


class ImportIn(BaseModel):
    url: str = Field(max_length=2048)


@router.post("/import-youtube", status_code=201)
def import_youtube_playlist(payload: ImportIn, user: AuthUser = Depends(current_user)):
    """Create a playlist from a public YouTube playlist. Nothing is summarized
    yet, so importing does not use up any of the daily video limit."""
    playlist_id = sources.extract_playlist_id(payload.url)
    if not playlist_id:
        raise AppError(400, "invalid_playlist_url", "Enter a YouTube playlist link (it contains ?list=...).")
    with connection() as conn:
        if repo.count_playlists(conn, user.id) >= repo.MAX_PLAYLISTS:
            raise AppError(409, "too_many_playlists", f"You can have up to {repo.MAX_PLAYLISTS} playlists.")
    try:
        data = sources.fetch_playlist(playlist_id)  # slow network call, no connection held
    except Exception:
        logger.exception("Playlist import failed")
        raise AppError(502, "playlist_unavailable", "Could not read that playlist. Make sure it is public and try again.")
    if not data["entries"]:
        raise AppError(422, "playlist_empty", "That playlist has no videos we can use.")
    with connection() as conn:
        with conn.transaction():
            playlist = repo.create_playlist(conn, user.id, data["title"], "youtube", playlist_id)
            repo.add_items(conn, str(playlist["id"]), [
                {"youtube_id": e["id"], "title": e["title"], "duration": e["duration"]} for e in data["entries"]])
        view = _playlist_view(playlist)
    view["item_count"] = len(data["entries"])
    return view


class AddItemIn(BaseModel):
    url: Optional[str] = Field(default=None, max_length=2048)
    video_id: Optional[str] = None

    @model_validator(mode="after")
    def exactly_one(self):
        if bool(self.url) == bool(self.video_id):
            raise ValueError("Send either a YouTube link or a video from your library.")
        return self


@router.post("/{playlist_id}/items", status_code=201)
def add_item(playlist_id: str, payload: AddItemIn, user: AuthUser = Depends(current_user)):
    title = None
    item: Dict[str, Any]
    if payload.url:
        if not is_valid_youtube_url(payload.url.strip()):
            raise AppError(400, "invalid_url", "Enter a valid YouTube video link.")
        youtube_id = extract_video_id(payload.url.strip())
        title = sources.fetch_video_title(youtube_id)  # slow network call, no connection held
        item = {"youtube_id": youtube_id, "title": title}
    else:
        item = {}

    with connection() as conn:
        with conn.transaction():
            playlist = _owned(conn, user, playlist_id, lock=True)
            pid = str(playlist["id"])
            if repo.count_items(conn, pid) >= repo.MAX_ITEMS:
                raise AppError(409, "playlist_full", f"A playlist can hold up to {repo.MAX_ITEMS} videos.")
            if not payload.url:
                video = videos_repo.user_video(conn, user.id, payload.video_id or "")
                if not video:
                    raise AppError(404, "video_not_found", "Video not found.")
                if video["youtube_id"]:
                    item = {"youtube_id": video["youtube_id"], "title": video["title"]}
                else:
                    item = {"video_id": str(video["id"]), "title": video["title"]}
            if repo.add_items(conn, pid, [item]) == 0:
                raise AppError(409, "already_in_playlist", "This video is already in the playlist.")
            repo.touch(conn, pid)
    return {"ok": True}


@router.delete("/{playlist_id}/items/{item_id}", status_code=204)
def remove_item(playlist_id: str, item_id: str, user: AuthUser = Depends(current_user)):
    removed_keys = []
    with connection() as conn:
        playlist = _owned(conn, user, playlist_id)
        iid = parse_uuid(item_id)
        current = repo.get_item(conn, user.id, iid) if iid else None
        if not current or str(current["playlist_id"]) != str(playlist["id"]):
            raise AppError(404, "item_not_found", "Item not found.")
        # Files attached only to this lesson go with it (files also attached to a video stay with the video).
        # This must happen before the item is removed, which would detach them.
        removed_keys.extend(documents_repo.delete_attached_to_item(conn, user.id, iid))
        removed = repo.remove_item(conn, str(playlist["id"]), iid)
        if not removed:
            raise AppError(404, "item_not_found", "Item not found.")
        if removed["upload_id"]:
            # A video uploaded from the device lives only in this item, so its file goes too.
            removed_keys.append(uploads_repo.delete(conn, user.id, str(removed["upload_id"])))
        if removed["document_id"]:
            # A loose file lives only in this row.
            removed_keys.append(documents_repo.delete(conn, user.id, str(removed["document_id"])))
        repo.touch(conn, str(playlist["id"]))
    store = get_file_store()
    for key in removed_keys:
        if not key:
            continue
        try:
            store.delete(key)
        except Exception:
            logger.warning("Could not delete a file", exc_info=True)


class MoveIn(BaseModel):
    after_id: Optional[str] = None    # the item that should be directly before this one
    before_id: Optional[str] = None   # the item that should be directly after this one


@router.patch("/{playlist_id}/items/{item_id}/move", status_code=204)
def move_item(playlist_id: str, item_id: str, payload: MoveIn, user: AuthUser = Depends(current_user)):
    """Reorder: only the moved item changes."""
    after = parse_uuid(payload.after_id) if payload.after_id else None
    before = parse_uuid(payload.before_id) if payload.before_id else None
    if (payload.after_id and not after) or (payload.before_id and not before):
        raise AppError(400, "invalid_neighbour", "Unknown neighbouring item.")
    iid = parse_uuid(item_id)
    with connection() as conn:
        with conn.transaction():
            playlist = _owned(conn, user, playlist_id, lock=True)
            if not iid or not repo.move_item(conn, str(playlist["id"]), iid, after, before):
                raise AppError(400, "invalid_move", "That move is not possible.")
            repo.touch(conn, str(playlist["id"]))
