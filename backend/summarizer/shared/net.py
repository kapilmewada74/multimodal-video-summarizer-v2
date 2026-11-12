import hashlib
import hmac
import os
from fastapi import Request


def client_ip(request: Request) -> str:
    """Caller IP. Behind a trusted proxy the first X-Forwarded-For entry is used
    only when TRUST_PROXY=1, so a client cannot fake its address otherwise."""
    if os.getenv("TRUST_PROXY") == "1":
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded:
            return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def hash_ip(ip: str) -> str:
    """Store only a salted hash of the address, never the address itself."""
    salt = os.getenv("IP_HASH_SALT", "summarizer-default-salt").encode()
    return hmac.new(salt, ip.encode(), hashlib.sha256).hexdigest()
