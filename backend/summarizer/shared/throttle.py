"""A small in-memory rate limit for cheap-to-call but expensive-to-answer endpoints (building a file, for example).

It counts per process, which is enough to stop a script hammering one server; the per-address daily limits in the
database are the shared, durable ones.
"""
import threading
import time
from collections import defaultdict, deque
from typing import Deque, Dict, Optional

from ..core.errors import AppError

_lock = threading.Lock()
_hits: Dict[str, Deque[float]] = defaultdict(deque)
_MAX_KEYS = 20000


def check(key: str, limit: int, window_seconds: float, now: Optional[float] = None, what: str = "requests") -> None:
    """Allow `limit` calls per `window_seconds` for `key`; otherwise raise 429."""
    moment = time.monotonic() if now is None else now
    with _lock:
        if len(_hits) > _MAX_KEYS:                       # never grow without bound
            for stale in [k for k, q in _hits.items() if not q or moment - q[-1] > window_seconds][:_MAX_KEYS // 2]:
                _hits.pop(stale, None)
        queue = _hits[key]
        while queue and moment - queue[0] > window_seconds:
            queue.popleft()
        if len(queue) >= limit:
            retry = max(1, int(window_seconds - (moment - queue[0])))
            raise AppError(429, "slow_down", f"Too many {what}. Please wait {retry} seconds and try again.",
                           extra={"retry_after": retry})
        queue.append(moment)


def reset() -> None:
    with _lock:
        _hits.clear()
