"""One error type for expected failures, rendered as {code, message} JSON."""
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(self, status_code: int, code: str, message: str, extra: dict | None = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.extra = extra or {}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(_: Request, exc: AppError):
        body = {"code": exc.code, "message": exc.message, "detail": exc.message, **exc.extra}
        return JSONResponse(status_code=exc.status_code, content=body)
