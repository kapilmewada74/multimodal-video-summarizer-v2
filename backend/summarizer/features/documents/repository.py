from typing import Any, Dict, List, Optional

import psycopg

from ...core.config import get_settings
from ...core.errors import AppError

Row = Dict[str, Any]

LIST_COLUMNS = "id, video_id, playlist_item_id, filename, extension, mime, size_bytes, text_status, created_at"


def view(row: Row) -> Dict[str, Any]:
    return {
        "id": str(row["id"]),
        "video_id": str(row["video_id"]) if row["video_id"] else None,
        "playlist_item_id": str(row["playlist_item_id"]) if row.get("playlist_item_id") else None,
        "filename": row["filename"],
        "extension": row["extension"],
        "mime": row["mime"],
        "size_bytes": row["size_bytes"],
        "has_text": row["text_status"] == "extracted",
        "text_status": row["text_status"],
        "created_at": row["created_at"].isoformat(),
    }


def storage_used(conn, user_id: str) -> int:
    return conn.execute("select storage_used(%s) s", (user_id,)).fetchone()["s"]


def document_count(conn, user_id: str) -> int:
    return conn.execute("select count(*) c from documents where user_id = %s", (user_id,)).fetchone()["c"]


def check_room(conn, user_id: str, incoming_bytes: int, *, new_documents: int = 0) -> None:
    """Refuse an upload that would take the user over their storage or file-count limit."""
    settings = get_settings()
    if storage_used(conn, user_id) + incoming_bytes > settings.user_storage_quota_bytes:
        raise AppError(413, "storage_full",
                       f"You have used your {settings.user_storage_quota_bytes // (1024 * 1024)} MB of storage. "
                       "Delete some files to make room.")
    if new_documents and document_count(conn, user_id) + new_documents > settings.max_documents_per_user:
        raise AppError(409, "too_many_documents", f"You can keep up to {settings.max_documents_per_user} documents.")


def insert(conn, *, user_id: str, video_id: Optional[str], filename: str, extension: str, mime: str, size: int,
           sha256: str, storage_key: str, text_status: str, text: Optional[str],
           playlist_item_id: Optional[str] = None) -> Optional[Row]:
    """Insert a document. Returns None if the same file is already in that place."""
    try:
        return conn.execute(
            f"""insert into documents (user_id, video_id, playlist_item_id, filename, extension, mime, size_bytes, sha256,
                                       storage_key, text_status, extracted_text)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s) returning {LIST_COLUMNS}""",
            (user_id, video_id, playlist_item_id, filename, extension, mime, size, sha256, storage_key, text_status, text)).fetchone()
    except psycopg.errors.UniqueViolation:
        return None


def get(conn, user_id: str, document_id: str, columns: str = LIST_COLUMNS) -> Optional[Row]:
    return conn.execute(f"select {columns} from documents where id = %s and user_id = %s", (document_id, user_id)).fetchone()


def get_any(conn, document_id: str) -> Optional[Row]:
    """For signed download links only (the token already proves permission)."""
    return conn.execute("select id, filename, mime, storage_key from documents where id = %s", (document_id,)).fetchone()


def list_documents(conn, user_id: str, *, video_id: Optional[str], standalone: bool, limit: int, offset: int) -> List[Row]:
    where, params = ["user_id = %s"], [user_id]
    if video_id:
        where.append("video_id = %s")
        params.append(video_id)
    elif standalone:
        where.append("video_id is null and playlist_item_id is null")
    params += [limit, offset]
    return conn.execute(
        f"select {LIST_COLUMNS} from documents where {' and '.join(where)} order by created_at desc limit %s offset %s",
        params).fetchall()


def count(conn, user_id: str, *, video_id: Optional[str], standalone: bool) -> int:
    where, params = ["user_id = %s"], [user_id]
    if video_id:
        where.append("video_id = %s")
        params.append(video_id)
    elif standalone:
        where.append("video_id is null and playlist_item_id is null")
    return conn.execute(f"select count(*) c from documents where {' and '.join(where)}", params).fetchone()["c"]


def update(conn, user_id: str, document_id: str, *, filename: Optional[str] = None,
           video_id: Optional[str] = None, change_video: bool = False,
           playlist_item_id: Optional[str] = None, change_item: bool = False) -> Optional[Row]:
    sets, params = [], []
    if change_item:
        sets.append("playlist_item_id = %s")
        params.append(playlist_item_id)
    if filename is not None:
        sets.append("filename = %s")
        params.append(filename)
    if change_video:
        sets.append("video_id = %s")
        params.append(video_id)
    if not sets:
        return get(conn, user_id, document_id)
    params += [document_id, user_id]
    try:
        return conn.execute(f"update documents set {', '.join(sets)} where id = %s and user_id = %s returning {LIST_COLUMNS}",
                            params).fetchone()
    except psycopg.errors.UniqueViolation:
        raise AppError(409, "already_there", "The same file is already in that place.")


def delete(conn, user_id: str, document_id: str) -> Optional[str]:
    """Remove the row; returns the storage key so the caller can delete the file."""
    row = conn.execute("delete from documents where id = %s and user_id = %s returning storage_key", (document_id, user_id)).fetchone()
    return row["storage_key"] if row else None


def for_items(conn, user_id: str, item_ids: List[str], video_ids: List[str]) -> List[Row]:
    """The user's documents attached to any of these playlist items or videos (newest last)."""
    if not item_ids and not video_ids:
        return []
    return conn.execute(
        f"""select {LIST_COLUMNS} from documents
             where user_id = %s and (playlist_item_id = any(%s::uuid[]) or video_id = any(%s::uuid[]))
             order by created_at, id""", (user_id, item_ids, video_ids)).fetchall()


def in_playlist_by_hash(conn, user_id: str, playlist_id: str, sha256: str) -> bool:
    """Is a loose file with this content already a row of this playlist?"""
    return conn.execute(
        """select 1 from playlist_items i join documents d on d.id = i.document_id
            where i.playlist_id = %s and d.user_id = %s and d.sha256 = %s limit 1""",
        (playlist_id, user_id, sha256)).fetchone() is not None


def delete_attached_to_item(conn, user_id: str, item_id: str) -> List[str]:
    """Delete files that belong only to a lesson (not to a video too). Returns their storage keys."""
    rows = conn.execute(
        "delete from documents where user_id = %s and playlist_item_id = %s and video_id is null returning storage_key",
        (user_id, item_id)).fetchall()
    return [r["storage_key"] for r in rows]
