"""Refuses requests from suspended accounts.

Checking the database on every request would double the number of queries, so the answer is remembered for a short
time per process. Suspending someone therefore takes effect immediately on the server that handled the admin's click
and within `TTL_SECONDS` on the others. If the database cannot be reached the person is let through (and the problem
is logged): a database outage must not look like a ban.
"""
import logging
import threading
import time
from typing import Dict, Tuple

from .config import get_settings
from .errors import AppError

logger = logging.getLogger("summarizer.suspension")

TTL_SECONDS = 30
_MAX_ENTRIES = 50_000

_lock = threading.Lock()
_cache: Dict[str, Tuple[float, bool]] = {}


def _lookup(user_id: str) -> bool:
    from .db import connection
    with connection() as conn:
        row = conn.execute("select suspended_at is not null as suspended from public.profiles where user_id = %s",
                           (user_id,)).fetchone()
    return bool(row and row["suspended"])


def is_suspended(user_id: str) -> bool:
    if not get_settings().database_url:
        return False
    now = time.monotonic()
    with _lock:
        hit = _cache.get(user_id)
        if hit and hit[0] > now:
            return hit[1]
    try:
        suspended = _lookup(user_id)
    except Exception:
        logger.warning("Could not check whether an account is suspended; letting the request through.", exc_info=True)
        return False
    with _lock:
        if len(_cache) >= _MAX_ENTRIES:
            _cache.clear()
        _cache[user_id] = (now + TTL_SECONDS, suspended)
    return suspended


def enforce(user_id: str) -> None:
    if is_suspended(user_id):
        raise AppError(403, "account_suspended",
                       "This account has been suspended. If you think this is a mistake, please contact us.")


def forget(user_id: str) -> None:
    """Called right after a suspension changes, so this process answers correctly at once."""
    with _lock:
        _cache.pop(user_id, None)


def reset() -> None:
    with _lock:
        _cache.clear()
