import secrets
from typing import Any, Dict, Optional

Row = Dict[str, Any]


def new_token() -> str:
    """256 bits of randomness, URL safe (43 characters)."""
    return secrets.token_urlsafe(32)


def active_link(conn, user_id: str, video_id: str) -> Optional[Row]:
    return conn.execute(
        """select * from share_links where owner_id = %s and video_id = %s and revoked_at is null
              and (expires_at is null or expires_at > now())""",
        (user_id, video_id)).fetchone()


def create_or_get_link(conn, user_id: str, video_id: str) -> Row:
    """The person's active link for this video, creating it if there is none.

    Two requests at once (a double click, two tabs) must end up with the SAME link. Without a lock one request could
    retire the link the other had just created, and hand back a token that no longer works. A lock held for this
    person and video only (released when the transaction ends) makes them take turns; other videos and people are
    not affected."""
    with conn.transaction():
        conn.execute("select pg_advisory_xact_lock(hashtextextended(%s, 0))", (f"share:{user_id}:{video_id}",))
        existing = active_link(conn, user_id, video_id)
        if existing:
            return existing
        # Whatever is still unrevoked now has expired, and would block the unique index; retire it.
        conn.execute("update share_links set revoked_at = now() where owner_id = %s and video_id = %s "
                     "and revoked_at is null", (user_id, video_id))
        return conn.execute(
            "insert into share_links (token, video_id, owner_id) values (%s, %s, %s) returning *",
            (new_token(), video_id, user_id)).fetchone()


def revoke(conn, user_id: str, video_id: str) -> bool:
    return conn.execute(
        "update share_links set revoked_at = now() where owner_id = %s and video_id = %s and revoked_at is null",
        (user_id, video_id)).rowcount > 0


def public_view(conn, token: str) -> Optional[Row]:
    """What an anonymous visitor may see through a share link: the title,
    length, summary, mind map and flashcards. Never the transcript or quiz."""
    link = conn.execute(
        """select sl.video_id from share_links sl
             join videos v on v.id = sl.video_id
            where sl.token = %s and sl.revoked_at is null
              and (sl.expires_at is null or sl.expires_at > now()) and v.status = 'ready'""",
        (token,)).fetchone()
    if not link:
        return None
    video_id = link["video_id"]
    video = conn.execute(
        """select v.title, v.duration_seconds, v.youtube_id, s.content_md as summary
             from videos v join summaries s on s.video_id = v.id where v.id = %s""",
        (video_id,)).fetchone()
    if not video:
        return None
    outputs = {r["kind"]: r["content"] for r in conn.execute(
        "select kind, content from video_outputs where video_id = %s and kind in ('mindmap', 'flashcards') "
        "and variant = ''", (video_id,)).fetchall()}
    return {
        "title": video["title"],
        "duration": video["duration_seconds"] or 0,
        "youtube_id": video["youtube_id"],
        "summary": video["summary"],
        "mindmap": outputs.get("mindmap"),
        "flashcards": (outputs.get("flashcards") or {}).get("flashcards"),
    }
