"""PostgreSQL connection pool (Supabase Postgres or any Postgres)."""
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings
from .errors import AppError

_pool: Optional[ConnectionPool] = None
_lock = threading.Lock()


def get_pool() -> ConnectionPool:
    global _pool
    with _lock:
        if _pool is None:
            url = get_settings().database_url
            if not url:
                raise AppError(503, "database_not_configured",
                               "The server database is not configured.")
            _pool = ConnectionPool(
                url,
                min_size=1,
                max_size=10,
                kwargs={"row_factory": dict_row, "autocommit": True},
                open=True,
            )
        return _pool


def close_pool() -> None:
    global _pool
    with _lock:
        if _pool is not None:
            _pool.close()
            _pool = None


@contextmanager
def connection() -> Iterator[psycopg.Connection]:
    """Borrow a connection (autocommit; use conn.transaction() for groups)."""
    with get_pool().connection() as conn:
        yield conn
