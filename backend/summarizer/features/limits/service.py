"""Per-IP daily cap, in addition to the per-user daily limit in the database."""
from fastapi import Request

from ...core.config import get_settings
from ...core.errors import AppError
from ...shared.net import client_ip, hash_ip


def enforce_ip_limit(conn, request: Request) -> str:
    """Count this request against the caller's IP. Returns the IP."""
    ip = client_ip(request)
    count = conn.execute("select bump_ip_usage(%s) n", (hash_ip(ip),)).fetchone()["n"]
    if count > get_settings().ip_daily_limit:
        raise AppError(429, "ip_limit_reached",
                       "Too many videos were submitted from your network today. Please try again tomorrow.")
    return ip
