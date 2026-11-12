import hashlib
import threading
from collections import OrderedDict
from typing import Any, Optional


class BoundedCache:
    """Small thread-safe in-memory cache that drops the oldest entries."""

    def __init__(self, max_entries: int = 500):
        self.max_entries = max_entries
        self._data: "OrderedDict[str, Any]" = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            return self._data.get(key)

    def put(self, key: str, value: Any) -> None:
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.max_entries:
                self._data.popitem(last=False)

    def pop(self, key: str) -> None:
        with self._lock:
            self._data.pop(key, None)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()

    def __len__(self) -> int:
        return len(self._data)

    def keys(self):
        with self._lock:
            return list(self._data.keys())


def make_cache_key(prefix: str, *parts: str) -> str:
    """Stable key from the full content (not just its start)."""
    digest = hashlib.sha256("\x1f".join(parts).encode("utf-8")).hexdigest()
    return f"{prefix}:{digest}"
