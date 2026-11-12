"""FastAPI application entry point: `uvicorn summarizer.main:app`."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .core.config import get_settings
from .core.db import close_pool
from .core.errors import install_error_handlers
from .features.documents.router import router as documents_router
from .features.exports.router import router as exports_router
from .features.limits.router import router as limits_router
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
# httpx logs full request URLs; keep it quiet so nothing sensitive reaches logs.
for _noisy in ("httpx", "httpcore"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

logger = logging.getLogger("summarizer")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
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


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Multimodal Video Summarizer",
        description="AI video summarizer: transcript, summary, flashcards, slides and quiz.",
        version="1.1.0",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Content-Type", "Authorization"],
    )
    install_error_handlers(app)

    for router in (videos_router, library_router, outputs_router, sharing_router, exports_router,
                   public_router, limits_router, slides_router, study_router, notes_router, edits_router,
                   playlists_router, notifications_router, documents_router, uploads_router):
        app.include_router(router)

    @app.get("/")
    def index():
        return {"message": "Multimodal Video Summarizer API is running. Open the web app on http://localhost:3000."}

    @app.get("/api/health")
    def health():
        device = "cpu"
        try:
            import ctranslate2
            if ctranslate2.get_cuda_device_count() > 0:
                device = "cuda"
        except Exception:
            pass
        database = "not_configured"
        if settings.database_url:
            try:
                from .core.db import connection
                with connection() as conn:
                    conn.execute("select 1")
                database = "ok"
            except Exception:
                database = "unreachable"
        return {"status": "healthy" if database in ("ok", "not_configured") else "degraded",
                "device": device, "database": database}

    return app


app = create_app()
