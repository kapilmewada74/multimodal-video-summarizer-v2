from typing import Any, Dict, List, Optional

Row = Dict[str, Any]

TYPES = ("goal_reached", "streak_at_risk", "streak_milestone", "summary_ready")
CHANNELS = ("in_app", "email", "push")
# Without a saved choice: show in the app, but never email or push.
DEFAULT_PREFS = {"in_app": True, "email": False, "push": False}
MAX_SUBSCRIPTIONS_PER_USER = 10


def in_quiet_hours(hour: int, start: Optional[int], end: Optional[int]) -> bool:
    """True if `hour` (0-23) is inside the quiet period. Handles overnight
    periods such as 22 to 7. No quiet hours (either end unset) means never."""
    if start is None or end is None or start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


def effective_prefs(conn, user_id: str) -> Dict[str, Dict[str, bool]]:
    prefs = {t: dict(DEFAULT_PREFS) for t in TYPES}
    for row in conn.execute("select channel, type, enabled from notification_prefs where user_id = %s", (user_id,)).fetchall():
        prefs[row["type"]][row["channel"]] = row["enabled"]
    return prefs


def save_prefs(conn, user_id: str, changes: Dict[str, Dict[str, bool]]) -> None:
    with conn.transaction():
        for kind, channels in changes.items():
            for channel, enabled in channels.items():
                conn.execute(
                    """insert into notification_prefs (user_id, channel, type, enabled) values (%s, %s, %s, %s)
                       on conflict (user_id, channel, type) do update set enabled = excluded.enabled""",
                    (user_id, channel, kind, enabled))


def profile_settings(conn, user_id: str) -> Row:
    return conn.execute(
        """select reminder_hour, quiet_start, quiet_end, timezone,
                  extract(hour from (now() at time zone timezone))::int as local_hour
             from profiles where user_id = %s""", (user_id,)).fetchone()


def save_profile_settings(conn, user_id: str, **fields) -> None:
    allowed = {"reminder_hour", "quiet_start", "quiet_end"}
    assignments = [name for name in fields if name in allowed]
    if not assignments:
        return
    sets = ", ".join(f"{name} = %s" for name in assignments)
    conn.execute(f"update profiles set {sets} where user_id = %s", (*[fields[n] for n in assignments], user_id))


def user_email(conn, user_id: str) -> Optional[str]:
    row = conn.execute("select email from auth.users where id = %s", (user_id,)).fetchone()
    return row["email"] if row else None


def create_notification(conn, user_id: str, kind: str, title: str, body: Optional[str], link: Optional[str],
                        dedupe_key: Optional[str], in_app: bool = True) -> Optional[Row]:
    """Insert a notification. Returns None if one with the same dedupe key already exists."""
    return conn.execute(
        """insert into notifications (user_id, type, title, body, link, dedupe_key, in_app)
           values (%s, %s, %s, %s, %s, %s, %s)
           on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
           returning *""",
        (user_id, kind, title, body, link, dedupe_key, in_app)).fetchone()


def list_notifications(conn, user_id: str, limit: int) -> List[Row]:
    return conn.execute(
        "select id, type, title, body, link, created_at, read_at from notifications "
        "where user_id = %s and in_app order by created_at desc limit %s", (user_id, limit)).fetchall()


def unread_count(conn, user_id: str) -> int:
    return conn.execute("select count(*) c from notifications where user_id = %s and in_app and read_at is null",
                        (user_id,)).fetchone()["c"]


def mark_read(conn, user_id: str, ids: Optional[List[str]]) -> int:
    """Mark the given notifications (or all, when `ids` is None) as read."""
    if ids is None:
        return conn.execute("update notifications set read_at = now() where user_id = %s and read_at is null",
                            (user_id,)).rowcount
    return conn.execute("update notifications set read_at = now() where user_id = %s and read_at is null "
                        "and id = any(%s::uuid[])", (user_id, ids)).rowcount


# ----------------------------------------------------------------- push

def add_push_subscription(conn, user_id: str, endpoint: str, p256dh: str, auth: str) -> bool:
    """Store (or take over) a subscription. Returns False if the user is at the limit."""
    count = conn.execute("select count(*) c from push_subscriptions where user_id = %s and endpoint <> %s",
                         (user_id, endpoint)).fetchone()["c"]
    if count >= MAX_SUBSCRIPTIONS_PER_USER:
        return False
    conn.execute(
        """insert into push_subscriptions (user_id, endpoint, p256dh, auth) values (%s, %s, %s, %s)
           on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth""",
        (user_id, endpoint, p256dh, auth))
    return True


def list_push_subscriptions(conn, user_id: str) -> List[Row]:
    return conn.execute("select endpoint, p256dh, auth from push_subscriptions where user_id = %s", (user_id,)).fetchall()


def delete_push_subscription(conn, user_id: str, endpoint: str) -> bool:
    return conn.execute("delete from push_subscriptions where user_id = %s and endpoint = %s", (user_id, endpoint)).rowcount > 0


def delete_push_subscription_by_endpoint(conn, endpoint: str) -> None:
    conn.execute("delete from push_subscriptions where endpoint = %s", (endpoint,))


def touch_push_subscription(conn, endpoint: str) -> None:
    conn.execute("update push_subscriptions set last_success_at = now() where endpoint = %s", (endpoint,))
