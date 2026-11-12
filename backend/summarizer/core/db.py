"""PostgreSQL connection pool (Supabase Postgres or any Postgres)."""
import threading
from contextlib import contextmanager
from typing import Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from .config import get_settings
from .errors import AppError

import os


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


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
                max_size=_int_env("DB_POOL_MAX", 10),
                # Several workers/API instances share the database: wait a bounded time, then fail fast.
                timeout=_int_env("DB_POOL_TIMEOUT", 30),
                max_idle=300,
                max_lifetime=1800,
                # prepare_threshold=None also works behind Supabase's transaction-mode pooler (port 6543).
                kwargs={"row_factory": dict_row, "autocommit": True, "prepare_threshold": None,
                        "options": f"-c statement_timeout={_int_env('DB_STATEMENT_TIMEOUT_MS', 30000)}"},
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
