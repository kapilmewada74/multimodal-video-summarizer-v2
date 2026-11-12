"""Refuse to start in production with an unsafe or incomplete configuration.

A wrong setting found at deploy time is cheap. The same wrong setting found
after launch (a guessable hash salt, a CORS list that still allows localhost,
signed links that break on the second server) is not.
"""
from dataclasses import dataclass
from typing import List
import os

from .config import Settings


@dataclass(frozen=True)
class Finding:
    level: str  # "error" stops a production start, "warning" is only logged
    message: str


def check_settings(settings: Settings) -> List[Finding]:
    findings: List[Finding] = []

    def error(message: str) -> None:
        findings.append(Finding("error", message))

    def warn(message: str) -> None:
        findings.append(Finding("warning", message))

    if not settings.database_url:
        error("DATABASE_URL is not set.")
    if not settings.supabase_url:
        error("SUPABASE_URL is not set: sign-in tokens cannot be verified.")
    elif not settings.supabase_url.startswith("https://"):
        error("SUPABASE_URL must be an https:// address in production.")

    if not settings.app_url.startswith("https://"):
        error("APP_URL must be the public https:// address of the site (it is used in emails and share links).")
    if not settings.cors_origins:
        error("CORS_ORIGINS is empty.")
    for origin in settings.cors_origins:
        if origin == "*":
            error("CORS_ORIGINS must not be '*'.")
        elif "localhost" in origin or "127.0.0.1" in origin:
            error(f"CORS_ORIGINS still allows a local address ({origin}).")
        elif not origin.startswith("https://"):
            error(f"CORS_ORIGINS entry {origin} is not https.")

    # Signed file links must verify on every API instance, so the key has to be shared.
    if not (settings.stream_signing_key or settings.supabase_jwt_secret or settings.supabase_service_role_key):
        error("STREAM_SIGNING_KEY is not set: signed file links would break as soon as a second API instance runs.")
    elif settings.stream_signing_key and len(settings.stream_signing_key) < 32:
        error("STREAM_SIGNING_KEY is too short (use at least 32 random characters).")

    salt = os.getenv("IP_HASH_SALT", "")
    if not salt or salt == "summarizer-default-salt":
        error("IP_HASH_SALT is not set (the built-in default is public).")
    elif len(salt) < 16:
        warn("IP_HASH_SALT is short; use at least 16 random characters.")

    if os.getenv("TRUST_PROXY") != "1":
        warn("TRUST_PROXY is not 1: behind a reverse proxy every visitor will look like the proxy's address "
             "and the per-address daily limit will be shared by everyone.")

    if settings.file_store == "local":
        warn("FILE_STORE=local: uploads live on one machine's disk, so only one API/worker host can be used. "
             "Use FILE_STORE=supabase to scale out.")
    elif settings.file_store == "supabase" and not settings.supabase_service_role_key:
        error("FILE_STORE=supabase needs SUPABASE_SERVICE_ROLE_KEY.")

    if settings.run_embedded_worker:
        warn("RUN_EMBEDDED_WORKER is on: jobs run inside the API process. Run workers as separate processes in production.")

    if not (os.getenv("GROQ_API_KEY") or os.getenv("GEMINI_API_KEY")):
        error("No AI provider key is set (GROQ_API_KEY or GEMINI_API_KEY).")
    if not settings.resend_api_key:
        warn("RESEND_API_KEY is not set: email notifications are off.")
    if not os.getenv("SENTRY_DSN"):
        warn("SENTRY_DSN is not set: errors will only be in the logs.")
    return findings


class UnsafeConfiguration(RuntimeError):
    pass


def enforce(settings: Settings, logger) -> None:
    """Log every finding; in production, stop the start-up if any is an error.
    Set SKIP_STARTUP_CHECKS=1 only for a deliberate one-off (it is logged loudly)."""
    if not settings.is_production:
        return
    findings = check_settings(settings)
    for finding in findings:
        (logger.error if finding.level == "error" else logger.warning)("config: %s", finding.message)
    errors = [f.message for f in findings if f.level == "error"]
    if errors and os.getenv("SKIP_STARTUP_CHECKS") == "1":
        logger.error("SKIP_STARTUP_CHECKS=1: starting despite %d configuration error(s).", len(errors))
        return
    if errors:
        raise UnsafeConfiguration(
            f"{len(errors)} configuration problem(s) block a production start:\n- " + "\n- ".join(errors))
