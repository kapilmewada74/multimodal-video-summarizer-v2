"""FastAPI application entry point: `uvicorn summarizer.main:app`."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.db import close_pool
from .core.bodylimit import install_body_limit
from .core.errors import install_error_handlers
from .core.observability import configure_logging, init_error_reporting, install_request_middleware
from .core.startup_checks import enforce
from .features.admin.router import router as admin_router
from .features.documents.router import router as documents_router
from .features.support.router import router as support_router
from .features.exports.router import router as exports_router
from .features.limits.router import router as limits_router
from .features.ops.router import router as ops_router
from .features.account.router import router as account_router
from .features.notes.router import router as notes_router
from .features.edits.router import router as edits_router
from .features.notifications.router import router as notifications_router
from .features.outputs.router import router as outputs_router
from .features.sharing.router import public_router as public_router
from .features.sharing.router import router as sharing_router
from .features.playlists.router import router as playlists_router
from .features.slides.router import router as slides_router
from .features.study.router import router as study_router
from .features.uploads.router import router as uploads_router
from .features.videos.library import router as library_router
from .features.videos.router import router as videos_router

configure_logging()
init_error_reporting()

logger = logging.getLogger("summarizer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    enforce(settings, logger)  # production only: refuses to start on an unsafe configuration
    worker = None
    if settings.run_embedded_worker and settings.database_url:
        from .features.jobs.worker import start_background_worker
        worker = start_background_worker()
        logger.info("Embedded worker started (set RUN_EMBEDDED_WORKER=false to run it separately).")
    elif not settings.database_url:
        logger.warning("DATABASE_URL is not set: the API will answer 503 for anything that needs the database.")
    yield
    if worker:
        worker[1].set()
    close_pool()


def _database_status(settings) -> str:
    if not settings.database_url:
        return "not_configured"
    try:
        from .core.db import connection
        with connection() as conn:
            conn.execute("select 1")
        return "ok"
    except Exception:
        return "unreachable"


def create_app() -> FastAPI:
    settings = get_settings()
    # The interactive API documentation lists every route and field: handy while developing, a free map for an attacker
    # in production. Off there unless ENABLE_API_DOCS=1.
    docs_on = (not settings.is_production) or os.getenv("ENABLE_API_DOCS") == "1"
    app = FastAPI(
        title="Multimodal Video Summarizer",
        description="AI video summarizer: transcript, summary, flashcards, slides and quiz.",
        version="1.1.0",
        lifespan=lifespan,
        docs_url="/docs" if docs_on else None,
        redoc_url="/redoc" if docs_on else None,
        openapi_url="/openapi.json" if docs_on else None,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )
    install_error_handlers(app)
    install_body_limit(app)
    install_request_middleware(app, settings.is_production)

    for router in (videos_router, library_router, outputs_router, sharing_router, exports_router,
                   public_router, limits_router, slides_router, study_router, notes_router, edits_router,
                   playlists_router, notifications_router, documents_router, uploads_router,
                   ops_router, account_router, support_router, admin_router):
        app.include_router(router)

    @app.get("/")
    def index():
        return {"message": "Multimodal Video Summarizer API is running. Open the web app on http://localhost:3000."}

    @app.get("/api/health/live")
    def live():
        """Is the process up? Never touches the database, so a database outage does not restart the API."""
        return {"status": "alive"}

    @app.get("/api/health/ready")
    def ready():
        """Can this instance serve traffic? 503 when the database is unreachable (a load balancer stops sending it requests)."""
        from fastapi.responses import JSONResponse
        status = _database_status(settings)
        body = {"status": "ready" if status == "ok" else "not_ready", "database": status}
        return JSONResponse(body, status_code=200 if status == "ok" else 503)

    @app.get("/api/health")
    def health():
        device = "cpu"
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            pass
        database = _database_status(settings)
        return {"status": "healthy" if database in ("ok", "not_configured") else "degraded",
                "device": device, "database": database, "version": os.getenv("RELEASE", "dev")}

    return app


app = create_app()
