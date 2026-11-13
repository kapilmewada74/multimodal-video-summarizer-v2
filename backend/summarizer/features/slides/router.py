from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_actor
from ...core.errors import AppError
from ...shared.http import safe_download_header
from . import service
from .pptx import build_pptx_file

router = APIRouter(prefix="/api", tags=["slides"])


class PptxRequest(BaseModel):
    title: str = Field(max_length=500)
    slides: List[Dict[str, Any]] = Field(max_length=40)
    template: Optional[str] = Field(default="warm_hexagons", max_length=50)


@router.post("/download/pptx")
def api_download_pptx(payload: PptxRequest, user: AuthUser = Depends(current_actor)):
    """Build the .pptx file from slide data. No AI is used here."""
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
