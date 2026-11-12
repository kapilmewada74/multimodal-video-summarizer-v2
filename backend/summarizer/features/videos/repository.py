"""Library queries: which videos a user has, and one video's details."""
from typing import Any, Dict, List, Optional

from ..jobs.repository import parse_uuid

Row = Dict[str, Any]


def user_video(conn, user_id: str, video_id: str) -> Optional[Row]:
    """The video, but only if this user has it in their library."""
    video_id = parse_uuid(video_id)
    if not video_id:
        return None
    return conn.execute(
        """select v.*, uv.added_at, uv.progress_seconds, uv.completed_at from videos v
             join user_videos uv on uv.video_id = v.id
            where v.id = %s and uv.user_id = %s""",
        (video_id, user_id)).fetchone()


def list_library(conn, user_id: str, limit: int, offset: int) -> List[Row]:
    return conn.execute(
        """select v.id, v.source, v.youtube_id, v.title, v.duration_seconds, v.status, uv.added_at,
                  uv.progress_seconds, uv.completed_at,
                  (s.video_id is not null) as has_summary
             from user_videos uv
             join videos v on v.id = uv.video_id
             left join summaries s on s.video_id = v.id
            where uv.user_id = %s
            order by uv.added_at desc
            limit %s offset %s""",
        (user_id, limit, offset)).fetchall()


def count_library(conn, user_id: str) -> int:
    return conn.execute("select count(*) c from user_videos where user_id = %s", (user_id,)).fetchone()["c"]


def remove_from_library(conn, user_id: str, video_id: str) -> bool:
    """Remove the video from this user's library. The shared copy stays for
    other users, and this user's share links for it stop working."""
    with conn.transaction():
        conn.execute("update share_links set revoked_at = now() where owner_id = %s and video_id = %s "
                     "and revoked_at is null", (user_id, video_id))
        removed = conn.execute("delete from user_videos where user_id = %s and video_id = %s",
                               (user_id, video_id)).rowcount
    return removed > 0
