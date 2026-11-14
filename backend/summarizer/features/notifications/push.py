"""Browser push notifications (Web Push with VAPID). Off unless VAPID keys are set."""
import json
import logging
from typing import Any, Dict, Optional
from urllib.parse import urlparse

from ...core.config import get_settings
from ...core.db import connection
from . import repository as repo

logger = logging.getLogger("summarizer.push")

# Subscriptions come from the browser, and the server later connects to the
# address in them. To stop anyone from pointing the server at an internal
# address, only the real push services of the major browsers are accepted.
# Exact services only: a wildcard such as ".googleapis.com" would also allow storage.googleapis.com, where anyone can
# host a page of their own for the server to call.
ALLOWED_HOST_SUFFIXES = (
    ".push.services.mozilla.com",   # Firefox (updates.push.services.mozilla.com)
    ".push.apple.com",              # Safari (web.push.apple.com)
    ".notify.windows.com",          # Edge on Windows (WNS)
)
ALLOWED_HOSTS = (
    "fcm.googleapis.com",           # Chrome, Edge, Opera, Brave (Firebase Cloud Messaging)
    "android.googleapis.com",       # older Chrome subscriptions (GCM)
)
MAX_ENDPOINT_LENGTH = 1000


def push_available() -> bool:
    s = get_settings()
    return bool(s.vapid_public_key and s.vapid_private_key)


def is_allowed_endpoint(endpoint: str) -> bool:
    if not isinstance(endpoint, str) or len(endpoint) > MAX_ENDPOINT_LENGTH:
        return False
    try:
        parsed = urlparse(endpoint)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password or parsed.port not in (None, 443):
        return False
    return host in ALLOWED_HOSTS or any(host.endswith(suffix) or host == suffix.lstrip(".") for suffix in ALLOWED_HOST_SUFFIXES)


def build_payload(title: str, body: Optional[str], link: Optional[str]) -> str:
    return json.dumps({"title": title, "body": body or "", "url": link or "/"})


def send_to_subscription(subscription: Dict[str, Any], title: str, body: Optional[str], link: Optional[str],
                         sender=None) -> bool:
    """Send one push. A subscription the push service says is gone is deleted."""
    settings = get_settings()
    if not push_available() or not is_allowed_endpoint(subscription["endpoint"]):
        return False
    if sender is None:
        from pywebpush import WebPushException, webpush

        def sender(info, data):
            try:
                webpush(info, data, vapid_private_key=settings.vapid_private_key,
                        vapid_claims={"sub": settings.vapid_subject}, timeout=10)
                return 201
            except WebPushException as exc:
                return getattr(exc.response, "status_code", 500)

    info = {"endpoint": subscription["endpoint"],
            "keys": {"p256dh": subscription["p256dh"], "auth": subscription["auth"]}}
    status = sender(info, build_payload(title, body, link))
    if status in (404, 410):
        with connection() as conn:
            repo.delete_push_subscription_by_endpoint(conn, subscription["endpoint"])
        return False
    if status >= 300:
        logger.warning("Push service answered HTTP %s", status)
        return False
    with connection() as conn:
        repo.touch_push_subscription(conn, subscription["endpoint"])
    return True
