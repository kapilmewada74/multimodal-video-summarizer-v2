"""Shared test setup.

Tests never call real AI providers or the network: API keys are removed from
the environment before every test, and provider calls are replaced by fakes.
"""
import os
import sys
import time
import uuid

import jwt
import pytest

pytest_plugins = ["pgserver"]  # database fixtures: pg_server, db_url

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

JWT_SECRET = "test-secret-test-secret-test-secret-123"


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch, tmp_path):
    for name in ("GEMINI_API_KEY", "XAI_API_KEY", "GROK_API_KEY", "GROQ_API_KEY", "DATABASE_URL",
                 "SUPABASE_URL", "SUPABASE_JWT_SECRET", "SUPABASE_SERVICE_ROLE_KEY", "TURNSTILE_SECRET",
                 "FILE_STORE", "IP_DAILY_LIMIT", "GENERATION_DAILY_LIMIT", "STREAK_MIN_SECONDS", "MAX_DOCUMENT_MB", "USER_STORAGE_QUOTA_MB", "MAX_DOCUMENTS_PER_USER", "STREAM_SIGNING_KEY", "APP_URL", "VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "RESEND_API_KEY", "EMAIL_FROM", "MAX_UPLOAD_MB", "MAX_VIDEO_SECONDS", "ENVIRONMENT",
                 "RUN_EMBEDDED_WORKER", "CORS_ORIGINS", "TRUST_PROXY"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    from summarizer.core import auth, config, db
    config.get_settings.cache_clear()
    auth.reset_auth_cache()
    db.close_pool()
    yield
    db.close_pool()
    config.get_settings.cache_clear()
    auth.reset_auth_cache()


@pytest.fixture(autouse=True)
def clear_generation_caches():
    from summarizer.features.flashcards import service as flashcards
    from summarizer.features.quizzes import service as quizzes
    from summarizer.features.slides import service as slides
    for service in (flashcards, quizzes, slides):
        service.clear_cache()
    yield


def set_env(monkeypatch, **values):
    from summarizer.core import config
    for key, value in values.items():
        monkeypatch.setenv(key, str(value))
    config.get_settings.cache_clear()


def make_token(user_id=None, *, secret=JWT_SECRET, role="authenticated", anonymous=False,
               expires_in=3600, audience="authenticated", algorithm="HS256", extra=None):
    claims = {
        "sub": str(user_id or uuid.uuid4()),
        "aud": audience,
        "role": role,
        "exp": int(time.time()) + expires_in,
        "is_anonymous": anonymous,
    }
    claims.update(extra or {})
    return jwt.encode(claims, secret, algorithm=algorithm)


@pytest.fixture()
def api(db_url, monkeypatch):
    """The real API app on a fresh, migrated database."""
    from fastapi.testclient import TestClient

    from apiutil import Api
    from summarizer.main import create_app

    set_env(monkeypatch, DATABASE_URL=db_url, SUPABASE_JWT_SECRET=JWT_SECRET, RUN_EMBEDDED_WORKER="false")
    with TestClient(create_app()) as client:
        yield Api(client, db_url)
