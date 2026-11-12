"""Logging, request tracing and error reporting for production.

* JSON logs (LOG_FORMAT=json) so a log service can search by field.
* Every request gets an id (X-Request-ID, taken from the proxy when present) that
  appears in the log line and in the response, so one user report can be traced.
* Security headers on every API response.
* Optional Sentry error reporting (SENTRY_DSN). Off, and the package not even
  imported, when no DSN is set.
"""
import contextvars
import json
import logging
import os
import re
import time
import uuid

from fastapi import FastAPI, Request

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_SAFE_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}

access_logger = logging.getLogger("summarizer.access")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        data = {
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S") + f".{int(record.msecs):03d}Z",
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        for key, value in record.__dict__.items():
            if key not in _RESERVED and not key.startswith("_"):
                data[key] = value
        if record.exc_info:
            data["exception"] = self.formatException(record.exc_info)
        return json.dumps(data, default=str, ensure_ascii=False)


class _UtcJson(JsonFormatter):
    converter = time.gmtime


def configure_logging() -> None:
    """Set up the root logger. Safe to call more than once."""
    handler = logging.StreamHandler()
    if os.getenv("LOG_FORMAT", "text").strip().lower() == "json":
        handler.setFormatter(_UtcJson())
    else:
        handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s"))
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    # httpx logs full request URLs; keep it quiet so nothing sensitive reaches logs.
    for noisy in ("httpx", "httpcore"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
    # uvicorn's own access log would print query strings (signed file links); ours does not.
    logging.getLogger("uvicorn.access").disabled = True


def init_error_reporting() -> bool:
    """Start Sentry when SENTRY_DSN is set. Returns True when it is active."""
    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return False
    try:
        import sentry_sdk
    except ImportError:
        logging.getLogger("summarizer").warning("SENTRY_DSN is set but sentry-sdk is not installed.")
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=os.getenv("ENVIRONMENT", "development"),
        release=os.getenv("RELEASE") or None,
        traces_sample_rate=float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0")),
        send_default_pii=False,  # never send emails, IPs or request bodies
    )
    return True


SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cross-Origin-Resource-Policy": "same-site",
}


def _path_group(path: str) -> str:
    """Log a route without ids/tokens in it (keeps logs low-cardinality and free of share tokens)."""
    parts = []
    for segment in path.split("/"):
        looks_like_id = len(segment) >= 16 or (segment.isdigit() and len(segment) > 3)
        parts.append(":id" if looks_like_id else segment)
    return "/".join(parts)


def install_request_middleware(app: FastAPI, is_production: bool) -> None:
    @app.middleware("http")
    async def tracing(request: Request, call_next):
        incoming = request.headers.get("x-request-id", "")
        rid = incoming if _SAFE_ID.match(incoming) else uuid.uuid4().hex[:16]
        token = request_id_var.set(rid)
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            response.headers["X-Request-ID"] = rid
            for name, value in SECURITY_HEADERS.items():
                response.headers.setdefault(name, value)
            if is_production:
                response.headers.setdefault("Strict-Transport-Security", "max-age=63072000; includeSubDomains")
            return response
        finally:
            elapsed_ms = round((time.perf_counter() - started) * 1000)
            path = request.url.path
            # Health probes run every few seconds; logging them only adds noise.
            if not path.startswith("/api/health"):
                access_logger.info(
                    "%s %s -> %s in %sms", request.method, _path_group(path), status, elapsed_ms,
                    extra={"method": request.method, "route": _path_group(path), "status": status,
                           "duration_ms": elapsed_ms},
                )
            request_id_var.reset(token)
