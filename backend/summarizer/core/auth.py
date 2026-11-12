"""Verifies Supabase access tokens (JWTs) and identifies the caller.

Supabase signs tokens either with a shared secret (HS256, older projects) or
with an asymmetric key published at a JWKS URL (RS256/ES256, newer projects).
Both are supported. The token algorithm is never taken on trust: HS256 is only
accepted when a shared secret is configured, and asymmetric algorithms only
when SUPABASE_URL is configured, so the "alg: none" and key-confusion tricks
do not work.
"""
import threading
from dataclasses import dataclass
from typing import Optional
from uuid import UUID

import jwt
from fastapi import Header
from jwt import PyJWKClient

from .config import get_settings
from .errors import AppError

ASYMMETRIC_ALGORITHMS = {"RS256", "ES256"}

_jwks_client: Optional[PyJWKClient] = None
_jwks_lock = threading.Lock()


@dataclass(frozen=True)
class AuthUser:
    id: str
    email: Optional[str]


def _jwks() -> PyJWKClient:
    global _jwks_client
    with _jwks_lock:
        if _jwks_client is None:
            url = get_settings().supabase_url
            _jwks_client = PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True)
        return _jwks_client


def reset_auth_cache() -> None:
    global _jwks_client
    with _jwks_lock:
        _jwks_client = None


def decode_token(token: str) -> dict:
    settings = get_settings()
    try:
        algorithm = jwt.get_unverified_header(token).get("alg")
    except jwt.PyJWTError:
        raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")

    options = {"require": ["exp", "sub"]}
    issuer = f"{settings.supabase_url}/auth/v1" if settings.supabase_url else None
    try:
        if algorithm == "HS256" and settings.supabase_jwt_secret:
            key, algorithms = settings.supabase_jwt_secret, ["HS256"]
        elif algorithm in ASYMMETRIC_ALGORITHMS and settings.supabase_url:
            key = _jwks().get_signing_key_from_jwt(token).key
            algorithms = [algorithm]
        else:
            raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")
        return jwt.decode(
            token,
            key,
            algorithms=algorithms,
            audience=settings.jwt_audience,
            issuer=issuer,
            options=options,
            leeway=10,
        )
    except AppError:
        raise
    except jwt.PyJWTError:
        raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")


def current_user(authorization: Optional[str] = Header(default=None)) -> AuthUser:
    """FastAPI dependency: the signed-in user. Only real accounts (Google or email) are accepted."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise AppError(401, "not_authenticated", "Please sign in to continue.")
    claims = decode_token(authorization[7:].strip())
    if claims.get("role") != "authenticated":
        raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")
    if claims.get("is_anonymous"):
        # Anonymous ("guest") sessions are not part of the product. Refuse them even if the project still allows them.
        raise AppError(403, "account_required", "Please sign in with Google or your email to use the app.")
    try:
        user_id = str(UUID(str(claims["sub"])))
    except ValueError:
        raise AppError(401, "invalid_token", "Invalid or expired session. Please reload the page.")
    return AuthUser(id=user_id, email=claims.get("email"))
