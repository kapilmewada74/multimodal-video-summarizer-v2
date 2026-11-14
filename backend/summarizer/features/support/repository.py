from typing import Any, Dict, List, Optional

Row = Dict[str, Any]

CATEGORIES = ("general", "bug", "account", "content", "feature", "other")
STATUSES = ("open", "in_progress", "resolved", "spam")


def recent_from_ip(conn, ip_hash: str, hours: int = 24) -> int:
    return conn.execute(
        "select count(*) c from support_tickets where ip_hash = %s and created_at > now() - make_interval(hours => %s)",
        (ip_hash, hours)).fetchone()["c"]


def create(conn, *, user_id: Optional[str], email: str, name: Optional[str], category: str, subject: str,
           message: str, ip_hash: str) -> Row:
    return conn.execute(
        """insert into support_tickets (user_id, email, name, category, subject, message, ip_hash)
           values (%s, %s, %s, %s, %s, %s, %s) returning id, created_at""",
        (user_id, email, name, category, subject, message, ip_hash)).fetchone()


def my_tickets(conn, user_id: str, limit: int = 20) -> List[Row]:
    return conn.execute(
        "select id, subject, category, status, created_at from support_tickets where user_id = %s "
        "order by created_at desc limit %s", (user_id, limit)).fetchall()
