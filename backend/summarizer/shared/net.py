import hashlib
import hmac
import os
from fastapi import Request


def client_ip(request: Request) -> str:
    """Caller IP. Behind a trusted proxy the address comes from X-Forwarded-For, and only when TRUST_PROXY=1.

    A client can send its own X-Forwarded-For, and many proxies ADD the real address to the END of the list instead of
    replacing it. So the address is read from the end (the entry the trusted proxy added), never from the start, which
    the client controls. With more than one trusted proxy in front, set TRUST_PROXY_HOPS to how many there are."""
    if os.getenv("TRUST_PROXY") == "1":
        parts = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        if parts:
            try:
                hops = max(1, int(os.getenv("TRUST_PROXY_HOPS", "1")))
            except ValueError:
                hops = 1
            return parts[-hops] if len(parts) >= hops else parts[0]
    return request.client.host if request.client else "unknown"


def hash_ip(ip: str) -> str:
    """Store only a salted hash of the address, never the address itself."""
    salt = os.getenv("IP_HASH_SALT", "summarizer-default-salt").encode()
    return hmac.new(salt, ip.encode(), hashlib.sha256).hexdigest()
