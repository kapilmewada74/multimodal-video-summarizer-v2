"""Creates notifications and delivers them to the user's chosen channels.

In-app notifications are stored in the database. Email and web push are sent
in the background so the request that triggered them is never slowed down or
failed by a slow mail or push service.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, Optional

from ...core.db import connection
from . import email as email_channel
from . import push as push_channel
from . import repository as repo

logger = logging.getLogger("summarizer.notifications")

# At most a few external deliveries run at once.
_executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="notify")


def _submit(func, *args) -> None:
    """Run a delivery in the background. (Tests replace this to run inline.)"""
    _executor.submit(_safe, func, *args)


def _safe(func, *args) -> None:
    try:
        func(*args)
    except Exception:
        logger.exception("Notification delivery failed")


def notify(user_id: str, kind: str, title: str, body: Optional[str] = None, link: Optional[str] = None,
           dedupe_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Create a notification and send it through the channels the user enabled.

    With a `dedupe_key`, the same notification is created at most once per user
    (so a goal reached twice in a day, or a repeated reminder, sends only once).
    Returns the created row, or None when it was a duplicate.
    """
    with connection() as conn:
        prefs = repo.effective_prefs(conn, user_id)[kind]
        row = repo.create_notification(conn, user_id, kind, title, body, link, dedupe_key, in_app=prefs["in_app"])
        if row is None:
            return None  # duplicate: already created (and sent) earlier

        wants_email, wants_push = prefs["email"], prefs["push"]
        if not (wants_email or wants_push):
            return row
        settings = repo.profile_settings(conn, user_id)
        quiet = repo.in_quiet_hours(settings["local_hour"], settings["quiet_start"], settings["quiet_end"])
        if quiet:
            return row  # email and push stay silent during quiet hours; the in-app copy remains
        address = repo.user_email(conn, user_id) if wants_email else None
        subscriptions = repo.list_push_subscriptions(conn, user_id) if wants_push else []

    if address:
        _submit(email_channel.send_notification_email, address, title, body, link)
    for subscription in subscriptions:
        _submit(push_channel.send_to_subscription, subscription, title, body, link)
    return row
