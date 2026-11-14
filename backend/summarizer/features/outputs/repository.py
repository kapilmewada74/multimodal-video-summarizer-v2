import json
from typing import Any, Dict, List, Optional

Row = Dict[str, Any]

KINDS = ("flashcards", "quiz", "mindmap", "slides")


def get_output(conn, video_id: str, kind: str, variant: str = "") -> Optional[Dict[str, Any]]:
    row = conn.execute("select content from video_outputs where video_id = %s and kind = %s and variant = %s",
                       (video_id, kind, variant)).fetchone()
    return row["content"] if row else None


def put_output(conn, video_id: str, kind: str, variant: str, content: Dict[str, Any], *, replace: bool) -> Dict[str, Any]:
    """Store an output. Returns what is stored afterwards: if another request
    stored one first (and `replace` is false) that one wins."""
    payload = json.dumps(content)
    if replace:
        conn.execute(
            """insert into video_outputs (video_id, kind, variant, content) values (%s, %s, %s, %s::jsonb)
               on conflict (video_id, kind, variant) do update set content = excluded.content, created_at = now()""",
            (video_id, kind, variant, payload))
    else:
        conn.execute(
            """insert into video_outputs (video_id, kind, variant, content) values (%s, %s, %s, %s::jsonb)
               on conflict (video_id, kind, variant) do nothing""",
            (video_id, kind, variant, payload))
    return get_output(conn, video_id, kind, variant) or content


def list_kinds(conn, video_id: str) -> List[str]:
    rows = conn.execute("select distinct kind from video_outputs where video_id = %s", (video_id,)).fetchall()
    return sorted(r["kind"] for r in rows)


def all_outputs(conn, video_id: str) -> List[Row]:
    return conn.execute("select kind, variant, content from video_outputs where video_id = %s order by kind, variant",
                        (video_id,)).fetchall()


def bump_generation_usage(conn, user_id: str, limit: int) -> int:
    """Use one generation. Returns the new count, or -1 if the limit is reached."""
    return conn.execute("select bump_generation_usage(%s, %s) n", (user_id, limit)).fetchone()["n"]


def generations_today(conn, user_id: str) -> int:
    """AI generations used so far today (UTC day, the same day the daily limit counts)."""
    row = conn.execute("select count from generation_usage where user_id = %s and day = (now() at time zone 'UTC')::date",
                       (user_id,)).fetchone()
    return row["count"] if row else 0


def get_user_output(conn, user_id: str, video_id: str, kind: str, variant: str = "") -> Optional[Dict[str, Any]]:
    row = conn.execute("select content from user_outputs where user_id = %s and video_id = %s and kind = %s and variant = %s",
                       (user_id, video_id, kind, variant)).fetchone()
    return row["content"] if row else None


def put_user_output(conn, user_id: str, video_id: str, kind: str, variant: str, content: Dict[str, Any]) -> Dict[str, Any]:
    conn.execute(
        """insert into user_outputs (user_id, video_id, kind, variant, content) values (%s, %s, %s, %s, %s::jsonb)
           on conflict (user_id, video_id, kind, variant) do update set content = excluded.content, created_at = now()""",
        (user_id, video_id, kind, variant, json.dumps(content)))
    return content


def delete_user_output(conn, user_id: str, video_id: str, kind: str, variant: str) -> bool:
    return conn.execute("delete from user_outputs where user_id = %s and video_id = %s and kind = %s and variant = %s",
                        (user_id, video_id, kind, variant)).rowcount > 0


def delete_shared_outputs(conn, video_id: str, kind: str, variant: Optional[str] = None) -> int:
    """Staff only: remove the shared copy (one variant, or all of them for the kind). The next opener regenerates it."""
    if variant is None:
        return conn.execute("delete from video_outputs where video_id = %s and kind = %s", (video_id, kind)).rowcount
    return conn.execute("delete from video_outputs where video_id = %s and kind = %s and variant = %s",
                        (video_id, kind, variant)).rowcount


def document_texts(conn, user_id: str, video_id: str) -> List[Row]:
    """The user's own documents attached to this video that have readable text, oldest first."""
    return conn.execute(
        """select id, filename, extracted_text from documents
            where user_id = %s and video_id = %s and text_status = 'extracted' and extracted_text is not null
            order by created_at, id""", (user_id, video_id)).fetchall()
