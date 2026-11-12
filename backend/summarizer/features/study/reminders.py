"""Scheduled study reminders (run by the worker)."""
import logging

from ...core.config import get_settings
from ...core.db import connection
from ..notifications.delivery import notify

logger = logging.getLogger("summarizer.reminders")


def send_streak_reminders() -> int:
    """Remind users whose streak would end today. At most one reminder per user and
    day (the notification's dedupe key). Returns how many reminders were sent."""
    minimum = get_settings().streak_min_seconds
    with connection() as conn:
        candidates = conn.execute("select * from streak_reminder_candidates(%s)", (minimum,)).fetchall()
    sent = 0
    for row in candidates:
        minutes = max(1, minimum // 60)
        created = notify(
            str(row["user_id"]), "streak_at_risk",
            f"Keep your {row['current_streak']}-day streak alive",
            f"Study for {minutes} minutes today to continue your streak.",
            "/study", dedupe_key=f"streak_risk:{row['local_day']}")
        if created:
            sent += 1
    return sent
