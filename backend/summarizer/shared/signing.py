"""Short-lived signed links for files.

A browser cannot attach a login header to a <video> tag or a download link, so the
API hands out an address that carries a signed, expiring token instead. The token
names exactly one file and one purpose, and cannot be reused for anything else.
"""
import hashlib
import hmac
import os
import secrets
import time
from typing import Optional

from ..core.config import get_settings

_process_key = secrets.token_bytes(32)  # used only when no shared key is configured (single process)


def _key() -> bytes:
    settings = get_settings()
    configured = settings.stream_signing_key or settings.supabase_jwt_secret or settings.supabase_service_role_key
    return configured.encode() if configured else _process_key


def _mac(purpose: str, item_id: str, expires: int) -> str:
    message = f"{purpose}:{item_id}:{expires}".encode()
    return hmac.new(_key(), message, hashlib.sha256).hexdigest()


def sign(purpose: str, item_id: str, ttl_seconds: int = 600, now: Optional[float] = None) -> str:
    expires = int((now if now is not None else time.time()) + ttl_seconds)
    return f"{expires}.{_mac(purpose, item_id, expires)}"


def verify(purpose: str, item_id: str, token: str, now: Optional[float] = None) -> bool:
    try:
        expires_text, mac = token.split(".", 1)
        expires = int(expires_text)
    except (ValueError, AttributeError):
        return False
    if expires < (now if now is not None else time.time()):
        return False
    return hmac.compare_digest(mac, _mac(purpose, item_id, expires))


def random_name() -> str:
    return os.urandom(8).hex()
