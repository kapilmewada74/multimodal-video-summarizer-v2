from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field

from ...core.auth import AuthUser, current_user
from ...core.db import connection
from ...core.errors import AppError
from ..jobs.repository import parse_uuid
from ..videos import repository as videos_repo
from . import repository as repo
from . import service

router = APIRouter(prefix="/api", tags=["study"])


class SessionStart(BaseModel):
    video_id: Optional[str] = None


@router.post("/study/sessions")
def start_session(payload: Optional[SessionStart] = None, user: AuthUser = Depends(current_user)):
    video_id = None
    with connection() as conn:
        if payload and payload.video_id:
            video = videos_repo.user_video(conn, user.id, payload.video_id)
            if not video:
                raise AppError(404, "video_not_found", "Video not found.")
            video_id = str(video["id"])
        repo_id = repo.start_session(conn, user.id, video_id)
    return {"id": repo_id}


class Heartbeat(BaseModel):
    active: bool = True


def _session_id(value: str) -> str:
    parsed = parse_uuid(value)
    if not parsed:
        raise AppError(404, "session_not_found", "Study session not found.")
    return parsed


@router.post("/study/sessions/{session_id}/heartbeat")
def heartbeat(session_id: str, payload: Heartbeat, user: AuthUser = Depends(current_user)):
    """Sent every ~20 seconds while studying. The server measures the time itself."""
    sid = _session_id(session_id)
    try:
        return service.process_heartbeat(user.id, sid, payload.active)
    except Exception as exc:
        if "session_not_found" in str(exc):
            raise AppError(404, "session_not_found", "Study session not found or already ended.")
        raise


@router.post("/study/sessions/{session_id}/end", status_code=204)
def end_session(session_id: str, user: AuthUser = Depends(current_user)):
    sid = _session_id(session_id)
    with connection() as conn:
        repo.end_session(conn, user.id, sid)


@router.post("/study/sessions/{session_id}/pomodoro")
def pomodoro_done(session_id: str, user: AuthUser = Depends(current_user)):
    """A focus block finished. Counted once per block (blocks must be a few minutes apart) and capped per day."""
    return service.record_pomodoro(user.id, _session_id(session_id))


@router.get("/study/sessions")
def recent_sessions(limit: int = Query(15, ge=1, le=50), user: AuthUser = Depends(current_user)):
    return {"items": service.sessions(user.id, limit)}


@router.get("/study/videos")
def study_time_by_video(days: int = Query(30, ge=1, le=365), limit: int = Query(8, ge=1, le=30), user: AuthUser = Depends(current_user)):
    """Where the study time went."""
    return {"items": service.time_by_video(user.id, days, limit)}


@router.get("/study/overview")
def overview(days: int = Query(14, ge=1, le=90), user: AuthUser = Depends(current_user)):
    return service.overview(user.id, days)


class GoalIn(BaseModel):
    type: Literal["minutes", "videos", "quizzes"]
    target: int = Field(ge=1, le=1440)
    active: bool = True


class GoalsIn(BaseModel):
    goals: List[GoalIn] = Field(max_length=3)


@router.put("/study/goals")
def save_goals(payload: GoalsIn, user: AuthUser = Depends(current_user)):
    seen = set()
    for goal in payload.goals:
        if goal.type in seen:
            raise AppError(400, "duplicate_goal", "Each goal type can only be set once.")
        seen.add(goal.type)
    with connection() as conn:
        for goal in payload.goals:
            repo.save_goal(conn, user.id, goal.type, goal.target, goal.active)
    return service.today_summary(user.id)


class ProgressIn(BaseModel):
    position_seconds: int = Field(ge=0, le=60 * 60 * 24)
    duration_seconds: Optional[int] = Field(default=None, ge=0, le=60 * 60 * 24)


@router.put("/videos/{video_id}/progress")
def save_progress(video_id: str, payload: ProgressIn, user: AuthUser = Depends(current_user)):
    vid = parse_uuid(video_id)
    result = service.record_progress(user.id, vid, payload.position_seconds, payload.duration_seconds) if vid else None
    if not result or not result["saved"]:
        raise AppError(404, "video_not_found", "Video not found.")
    return result


class QuizAttemptIn(BaseModel):
    score: int = Field(ge=0, le=100)
    total: int = Field(ge=1, le=100)
    difficulty: Literal["easy", "medium", "hard"] = "medium"


@router.post("/videos/{video_id}/quiz-attempts", status_code=204)
def save_quiz_attempt(video_id: str, payload: QuizAttemptIn, user: AuthUser = Depends(current_user)):
    if payload.score > payload.total:
        raise AppError(400, "invalid_score", "The score cannot be higher than the number of questions.")
    with connection() as conn:
        video = videos_repo.user_video(conn, user.id, video_id)
    if not video:
        raise AppError(404, "video_not_found", "Video not found.")
    service.record_quiz(user.id, str(video["id"]), payload.score, payload.total, payload.difficulty)
