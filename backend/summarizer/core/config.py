"""Application settings, read from environment variables."""
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

# backend/summarizer/core/config.py -> repository root is three levels up from backend/
REPO_ROOT = Path(__file__).resolve().parents[3]

load_dotenv(REPO_ROOT / ".env")


def _bool(name: str, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    environment: str
    database_url: Optional[str]
    supabase_url: Optional[str]
    supabase_jwt_secret: Optional[str]
    supabase_service_role_key: Optional[str]
    jwt_audience: str
    cors_origins: List[str]
    max_upload_bytes: int
    max_video_seconds: int
    ip_daily_limit: int
    generation_daily_limit: int
    streak_min_seconds: int
    max_document_bytes: int
    user_storage_quota_bytes: int
    max_documents_per_user: int
    stream_signing_key: Optional[str]
    app_url: str
    vapid_public_key: Optional[str]
    vapid_private_key: Optional[str]
    vapid_subject: str
    resend_api_key: Optional[str]
    email_from: str
    file_store: str
    storage_bucket: str
    data_dir: Path
    assets_dir: Path
    run_embedded_worker: bool
    worker_poll_seconds: float
    stale_job_seconds: int

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    environment = os.getenv("ENVIRONMENT", "development").strip().lower()
    origins = os.getenv("CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000")
    supabase_url = (os.getenv("SUPABASE_URL") or "").strip().rstrip("/") or None
    return Settings(
        environment=environment,
        database_url=os.getenv("DATABASE_URL") or None,
        supabase_url=supabase_url,
        supabase_jwt_secret=os.getenv("SUPABASE_JWT_SECRET") or None,
        supabase_service_role_key=os.getenv("SUPABASE_SERVICE_ROLE_KEY") or None,
        jwt_audience=os.getenv("JWT_AUDIENCE", "authenticated"),
        cors_origins=[o.strip() for o in origins.split(",") if o.strip()],
        max_upload_bytes=_int("MAX_UPLOAD_MB", 500) * 1024 * 1024,
        max_video_seconds=_int("MAX_VIDEO_SECONDS", 3 * 60 * 60),
        ip_daily_limit=_int("IP_DAILY_LIMIT", 30),
        generation_daily_limit=_int("GENERATION_DAILY_LIMIT", 60),
        # Study time that makes a day count toward the streak (default 10 minutes).
        streak_min_seconds=_int("STREAK_MIN_SECONDS", 600),
        max_document_bytes=_int("MAX_DOCUMENT_MB", 25) * 1024 * 1024,
        # All of one user's documents and uploaded videos together.
        user_storage_quota_bytes=_int("USER_STORAGE_QUOTA_MB", 2048) * 1024 * 1024,
        max_documents_per_user=_int("MAX_DOCUMENTS_PER_USER", 500),
        stream_signing_key=os.getenv("STREAM_SIGNING_KEY") or None,
        # Used to build links inside emails.
        app_url=(os.getenv("APP_URL") or "http://localhost:3000").rstrip("/"),
        vapid_public_key=os.getenv("VAPID_PUBLIC_KEY") or None,
        vapid_private_key=os.getenv("VAPID_PRIVATE_KEY") or None,
        vapid_subject=os.getenv("VAPID_SUBJECT") or "mailto:admin@example.com",
        resend_api_key=os.getenv("RESEND_API_KEY") or None,
        email_from=os.getenv("EMAIL_FROM") or "Summarize <onboarding@resend.dev>",
        file_store=os.getenv("FILE_STORE", "local").strip().lower(),
        storage_bucket=os.getenv("SUPABASE_STORAGE_BUCKET", "uploads"),
        data_dir=Path(os.getenv("DATA_DIR", REPO_ROOT / "data")),
        assets_dir=Path(os.getenv("ASSETS_DIR", REPO_ROOT / "assets")),
        # In development one process serves the API and runs jobs. In
        # production run the worker as its own process (or several).
        run_embedded_worker=_bool("RUN_EMBEDDED_WORKER", environment != "production"),
        worker_poll_seconds=float(os.getenv("WORKER_POLL_SECONDS", "1.5")),
        stale_job_seconds=_int("STALE_JOB_SECONDS", 20 * 60),
    )
