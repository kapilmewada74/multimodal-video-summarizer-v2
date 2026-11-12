from typing import Any, Dict, Optional

Row = Dict[str, Any]

COLUMNS = "id, user_id, video_id, filename, mime, size_bytes, sha256, storage_key, created_at"


def insert(conn, *, user_id: str, filename: str, mime: str, size: int, sha256: str, storage_key: str) -> Row:
    return conn.execute(
        f"""insert into video_uploads (user_id, filename, mime, size_bytes, sha256, storage_key)
            values (%s, %s, %s, %s, %s, %s) returning {COLUMNS}""",
        (user_id, filename, mime, size, sha256, storage_key)).fetchone()


def get(conn, user_id: str, upload_id: str) -> Optional[Row]:
    return conn.execute(f"select {COLUMNS} from video_uploads where id = %s and user_id = %s", (upload_id, user_id)).fetchone()


def get_any(conn, upload_id: str) -> Optional[Row]:
    """For signed stream links only (the token already proves permission)."""
    return conn.execute("select id, mime, storage_key, filename from video_uploads where id = %s", (upload_id,)).fetchone()


def link_video(conn, upload_id: str, video_id: str) -> None:
    conn.execute("update video_uploads set video_id = %s where id = %s", (video_id, upload_id))


def delete(conn, user_id: str, upload_id: str) -> Optional[str]:
    """Remove the row (its playlist item goes with it). Returns the storage key for the caller to delete."""
    row = conn.execute("delete from video_uploads where id = %s and user_id = %s returning storage_key", (upload_id, user_id)).fetchone()
    return row["storage_key"] if row else None
