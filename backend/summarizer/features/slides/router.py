import json
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from ...core.auth import AuthUser, current_actor
from ...core.errors import AppError
from ...shared import throttle
from ...shared.http import safe_download_header
from ...shared.net import client_ip
from . import service
from .pptx import build_pptx_file

router = APIRouter(prefix="/api", tags=["slides"])

MAX_SLIDES_JSON_CHARS = 250_000
MAX_SLIDE_TEXT = 5_000


class PptxRequest(BaseModel):
    title: str = Field(max_length=500)
    slides: List[Dict[str, Any]] = Field(max_length=40)
    template: Optional[str] = Field(default="warm_hexagons", max_length=50)

    @field_validator("slides")
    @classmethod
    def slides_must_be_reasonable(cls, slides):
        """The slides come from the browser, so bound them: total size, text length and nesting."""
        if len(json.dumps(slides, default=str)) > MAX_SLIDES_JSON_CHARS:
            raise ValueError("The slides are too large.")

        def check(value, depth=0):
            if depth > 5:
                raise ValueError("The slides are nested too deeply.")
            if isinstance(value, str) and len(value) > MAX_SLIDE_TEXT:
                raise ValueError("A piece of slide text is too long.")
            if isinstance(value, dict):
                if len(value) > 30:
                    raise ValueError("A slide has too many fields.")
                for item in value.values():
                    check(item, depth + 1)
            elif isinstance(value, list):
                if len(value) > 60:
                    raise ValueError("A slide has too many items.")
                for item in value:
                    check(item, depth + 1)

        check(slides)
        return slides


@router.post("/download/pptx")
def api_download_pptx(payload: PptxRequest, request: Request, user: AuthUser = Depends(current_actor)):
    """Build the .pptx file from slide data. No AI is used here, but it is CPU work, so it is rate limited."""
    throttle.check(f"pptx:{user.id}", 12, 300, what="slide downloads")
    throttle.check(f"pptx-ip:{client_ip(request)}", 40, 300, what="slide downloads")
    try:
        data = build_pptx_file(payload.model_dump())
    except Exception:
        service.logger.exception("PPTX build failed")
        raise AppError(500, "export_failed", "Failed to compile the PowerPoint file.")
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        headers={"Content-Disposition": safe_download_header(payload.title or "Presentation", "pptx")},
    )
