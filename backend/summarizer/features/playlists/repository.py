from typing import Any, Dict, List, Optional

from . import fractional

Row = Dict[str, Any]

MAX_PLAYLISTS = 50
MAX_ITEMS = 200


def list_playlists(conn, user_id: str) -> List[Row]:
    return conn.execute(
        """select p.id, p.title, p.source, p.created_at, p.updated_at,
                  count(i.id)::int as item_count,
                  count(uv.completed_at)::int as completed_count
             from playlists p
             left join playlist_items i on i.playlist_id = p.id
             left join video_uploads up on up.id = i.upload_id
             left join lateral (select id from videos v
                                 where (i.youtube_id is not null and v.youtube_id = i.youtube_id)
                                    or (i.video_id is not null and v.id = i.video_id)
                                    or (up.video_id is not null and v.id = up.video_id) limit 1) v on true
             left join user_videos uv on uv.video_id = v.id and uv.user_id = p.user_id
            where p.user_id = %s
            group by p.id
            order by p.updated_at desc""", (user_id,)).fetchall()


def count_playlists(conn, user_id: str) -> int:
    return conn.execute("select count(*) c from playlists where user_id = %s", (user_id,)).fetchone()["c"]


def get_playlist(conn, user_id: str, playlist_id: str, lock: bool = False) -> Optional[Row]:
    suffix = " for update" if lock else ""
    return conn.execute("select * from playlists where id = %s and user_id = %s" + suffix, (playlist_id, user_id)).fetchone()


def create_playlist(conn, user_id: str, title: str, source: str = "custom", source_id: Optional[str] = None) -> Row:
    return conn.execute("insert into playlists (user_id, title, source, source_id) values (%s, %s, %s, %s) returning *",
                        (user_id, title, source, source_id)).fetchone()


def touch(conn, playlist_id: str) -> None:
    conn.execute("update playlists set updated_at = now() where id = %s", (playlist_id,))


def list_items(conn, user_id: str, playlist_id: str) -> List[Row]:
    return conn.execute(
        """select i.id, i.youtube_id, i.video_id as upload_video_id, i.upload_id, i.document_id, i.title as item_title,
                  i.duration_seconds as item_duration, i.position,
                  up.filename as upload_filename, up.size_bytes as upload_size,
                  doc.filename as doc_filename, doc.extension as doc_extension, doc.mime as doc_mime,
                  doc.size_bytes as doc_size, doc.text_status as doc_text_status,
                  v.id as video_id, v.title as video_title, v.duration_seconds as video_duration, v.status,
                  (uv.user_id is not null) as in_library,
                  coalesce(uv.progress_seconds, 0) as progress_seconds, uv.completed_at
             from playlist_items i
             left join video_uploads up on up.id = i.upload_id
             left join documents doc on doc.id = i.document_id
             left join lateral (select * from videos v
                                 where (i.youtube_id is not null and v.youtube_id = i.youtube_id)
                                    or (i.video_id is not null and v.id = i.video_id)
                                    or (up.video_id is not null and v.id = up.video_id) limit 1) v on true
             left join user_videos uv on uv.video_id = v.id and uv.user_id = %s
            where i.playlist_id = %s
            order by i.position""", (user_id, playlist_id)).fetchall()


def item_positions(conn, playlist_id: str) -> List[Row]:
    return conn.execute("select id, position from playlist_items where playlist_id = %s order by position",
                        (playlist_id,)).fetchall()


def count_items(conn, playlist_id: str) -> int:
    return conn.execute("select count(*) c from playlist_items where playlist_id = %s", (playlist_id,)).fetchone()["c"]


def add_items(conn, playlist_id: str, items: List[Dict[str, Any]]) -> int:
    """Append items to the end (in the given order). Skips ones already in the list.
    The caller holds the playlist row lock. Returns how many were added."""
    last = conn.execute("select position from playlist_items where playlist_id = %s order by position desc limit 1",
                        (playlist_id,)).fetchone()
    previous = last["position"] if last else None
    added = 0
    for item in items:
        position = fractional.key_between(previous, None)
        inserted = conn.execute(
            """insert into playlist_items (playlist_id, youtube_id, video_id, upload_id, document_id, title, duration_seconds, position)
               values (%s, %s, %s, %s, %s, %s, %s, %s) on conflict do nothing returning id""",
            (playlist_id, item.get("youtube_id"), item.get("video_id"), item.get("upload_id"), item.get("document_id"), item.get("title"),
             item.get("duration"), position)).fetchone()
        if inserted:
            previous = position
            added += 1
            item["new_id"] = str(inserted["id"])
    return added


def remove_item(conn, playlist_id: str, item_id: str) -> Optional[Row]:
    """Remove an item. Returns the removed row (so the caller can clean up a device upload), or None."""
    return conn.execute("delete from playlist_items where id = %s and playlist_id = %s returning id, upload_id, document_id",
                        (item_id, playlist_id)).fetchone()


def rebalance(conn, playlist_id: str) -> None:
    rows = item_positions(conn, playlist_id)
    for row, key in zip(rows, fractional.evenly_spaced(len(rows))):
        conn.execute("update playlist_items set position = %s where id = %s", (key, row["id"]))


def move_item(conn, playlist_id: str, item_id: str, after_id: Optional[str], before_id: Optional[str]) -> bool:
    """Put the item between `after_id` (the item that will be before it) and
    `before_id` (the item that will be after it). Either may be None (list ends).
    The caller holds the playlist row lock. Returns False if an id is unknown."""
    rows = {str(r["id"]): r["position"] for r in item_positions(conn, playlist_id)}
    if item_id not in rows:
        return False
    for neighbour in (after_id, before_id):
        if neighbour is not None and (neighbour not in rows or neighbour == item_id):
            return False

    def compute() -> str:
        lower = rows[after_id] if after_id else None
        upper = rows[before_id] if before_id else None
        return fractional.key_between(lower, upper)

    try:
        key = compute()
        if fractional.needs_rebalance(key):
            raise ValueError("long key")
    except ValueError:
        # Keys are crowded: renumber the list, then try again.
        rebalance(conn, playlist_id)
        rows = {str(r["id"]): r["position"] for r in item_positions(conn, playlist_id)}
        try:
            key = compute()
        except ValueError:
            return False  # the neighbours really are in the wrong order (a stale view of the list)
    conn.execute("update playlist_items set position = %s where id = %s", (key, item_id))
    return True


def get_item(conn, user_id: str, item_id: str) -> Optional[Row]:
    """An item of one of the user's playlists (with the playlist id), or None."""
    return conn.execute(
        """select i.id, i.playlist_id, i.document_id, i.youtube_id, i.video_id, i.upload_id
             from playlist_items i join playlists p on p.id = i.playlist_id
            where i.id = %s and p.user_id = %s""", (item_id, user_id)).fetchone()


def item_video_id(conn, user_id: str, item: Row) -> Optional[str]:
    """The video (in this user's library) that a playlist item stands for, if it has one yet."""
    row = conn.execute(
        """select v.id from videos v
             left join video_uploads up on up.id = %s
             join user_videos uv on uv.video_id = v.id and uv.user_id = %s
            where (%s::text is not null and v.youtube_id = %s)
               or (%s::uuid is not null and v.id = %s)
               or (up.video_id is not null and v.id = up.video_id)
            limit 1""",
        (item["upload_id"], user_id, item["youtube_id"], item["youtube_id"], item["video_id"], item["video_id"])).fetchone()
    return str(row["id"]) if row else None
