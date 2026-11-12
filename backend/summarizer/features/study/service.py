"""Study time, goals and streaks, and the notifications they trigger."""
import logging
from typing import Any, Dict, List

from ...core.config import get_settings
from ...core.db import connection
from ..notifications.delivery import notify
from . import repository as repo
from . import streaks

logger = logging.getLogger("summarizer.study")

MAX_HEARTBEAT_GAP = 45          # seconds credited per heartbeat at most
STREAK_MILESTONES = (3, 7, 14, 30, 50, 100, 365)


def goal_progress(goal: Dict[str, Any], stats: Dict[str, Any]) -> Dict[str, Any]:
    """Progress toward one goal. Minutes count completed whole seconds, and the
    goal is reached exactly when the target minutes have been studied."""
    kind, target = goal["type"], goal["target"]
    if kind == "minutes":
        done, value, unit = stats["seconds"] >= target * 60, stats["seconds"] // 60, "min"
    elif kind == "videos":
        done, value, unit = stats["videos_done"] >= target, stats["videos_done"], "videos"
    else:
        done, value, unit = stats["quizzes_taken"] >= target, stats["quizzes_taken"], "quizzes"
    return {"type": kind, "target": target, "progress": value, "unit": unit, "done": done, "active": goal["active"]}


def _goal_reached_message(goal: Dict[str, Any]) -> str:
    target = goal["target"]
    if goal["type"] == "minutes":
        return f"You studied {target} minutes today."
    if goal["type"] == "videos":
        return f"You finished {target} video{'s' if target != 1 else ''} today."
    return f"You took {target} quiz{'zes' if target != 1 else ''} today."


def check_goal_notifications(user_id: str, before: Dict[str, Any], after: Dict[str, Any]) -> List[str]:
    """Send a notification for each active goal that was crossed by this change."""
    sent = []
    with connection() as conn:
        goals = [g for g in repo.list_goals(conn, user_id) if g["active"]]
        day = repo.local_today(conn, user_id)
    for goal in goals:
        was, now = goal_progress(goal, before)["done"], goal_progress(goal, after)["done"]
        if now and not was:
            notify(user_id, "goal_reached", "Daily goal reached", _goal_reached_message(goal), "/study",
                   dedupe_key=f"goal:{goal['type']}:{day}")
            sent.append(goal["type"])
    return sent


def check_streak_notification(user_id: str, before_seconds: int, after_seconds: int) -> None:
    """When today first counts toward the streak, celebrate round-number streaks."""
    minimum = get_settings().streak_min_seconds
    if not (before_seconds < minimum <= after_seconds):
        return
    with connection() as conn:
        info = repo.streak(conn, user_id, minimum)
        day = repo.local_today(conn, user_id)
    if info["current_streak"] in STREAK_MILESTONES:
        n = info["current_streak"]
        notify(user_id, "streak_milestone", f"{n}-day streak!", f"You have studied {n} days in a row. Keep it going.",
               "/study", dedupe_key=f"streak:{n}:{day}")


def process_heartbeat(user_id: str, session_id: str, active: bool) -> Dict[str, Any]:
    with connection() as conn:
        before = repo.today_stats(conn, user_id)
        result = repo.heartbeat(conn, user_id, session_id, active, MAX_HEARTBEAT_GAP)
        after = repo.today_stats(conn, user_id)
    if result["credited"] > 0:
        check_goal_notifications(user_id, before, after)
        check_streak_notification(user_id, before["seconds"], after["seconds"])
    return today_summary(user_id, credited=result["credited"])


def today_summary(user_id: str, credited: int = 0) -> Dict[str, Any]:
    minimum = get_settings().streak_min_seconds
    with connection() as conn:
        stats = repo.today_stats(conn, user_id)
        goals = [goal_progress(g, stats) for g in repo.list_goals(conn, user_id)]
        info = repo.streak(conn, user_id, minimum)
    with connection() as conn:
        today = repo.local_today(conn, user_id)
    return {
        "credited": credited,
        "today": {"seconds": stats["seconds"], "videos_done": stats["videos_done"], "quizzes_taken": stats["quizzes_taken"],
                  "pomodoros": stats["pomodoros"]},
        "goals": goals,
        "streak": {"current": info["current_streak"], "longest": info["longest_streak"],
                   "today_done": info["today_done"], "min_seconds": minimum,
                   "freeze_available": info["freeze_available"], "at_risk": info["at_risk"],
                   "frozen_days": [d.isoformat() for d in info["frozen_days"]]},
        "week": streaks.week_view(info["seconds_by_day"], today, minimum, info["frozen_days"]),
    }


def overview(user_id: str, days: int = 14) -> Dict[str, Any]:
    data = today_summary(user_id)
    with connection() as conn:
        history = repo.recent_days(conn, user_id, days)
    data["days"] = [{"day": r["day"].isoformat() if hasattr(r["day"], "isoformat") else str(r["day"])[:10],
                     "seconds": r["seconds"], "videos_done": r["videos_done"],
                     "quizzes_taken": r["quizzes_taken"], "pomodoros": r["pomodoros"]} for r in history]
    return data


POMODORO_MIN_GAP = 4 * 60     # a focus block is at least 5 minutes in the app; allow a little slack
POMODORO_DAILY_CAP = 48


def record_pomodoro(user_id: str, session_id: str) -> Dict[str, Any]:
    """Count a finished focus block for today (guarded against repeats and runaway counts)."""
    with connection() as conn:
        total = repo.add_pomodoro(conn, user_id, session_id, POMODORO_MIN_GAP, POMODORO_DAILY_CAP)
    return {"counted": total is not None, "today": total}


def sessions(user_id: str, limit: int = 20) -> List[Dict[str, Any]]:
    with connection() as conn:
        rows = repo.recent_sessions(conn, user_id, limit)
    return [{"id": str(r["id"]), "video_id": str(r["video_id"]) if r["video_id"] else None, "title": r["title"],
             "started_at": r["started_at"].isoformat(), "seconds": r["active_seconds"], "pomodoros": r["pomodoros"]} for r in rows]


def time_by_video(user_id: str, days: int = 30, limit: int = 8) -> List[Dict[str, Any]]:
    with connection() as conn:
        rows = repo.time_by_video(conn, user_id, days, limit)
    return [{"video_id": str(r["video_id"]), "title": r["title"], "seconds": r["seconds"], "sessions": r["sessions"]} for r in rows]


def record_progress(user_id: str, video_id: str, position: int, duration: int | None) -> Dict[str, Any]:
    """Save where the user is in a video. Reaching 90% of it marks it finished (once)."""
    completed_now = False
    with connection() as conn:
        if not repo.update_progress(conn, user_id, video_id, position):
            return {"saved": False, "completed": False}
        total = duration or conn.execute("select duration_seconds d from videos where id = %s", (video_id,)).fetchone()["d"] or 0
        if total > 0 and position >= total * 0.9:
            before = repo.today_stats(conn, user_id)
            completed_now = repo.mark_completed(conn, user_id, video_id)
            after = repo.today_stats(conn, user_id)
    if completed_now:
        check_goal_notifications(user_id, before, after)
    return {"saved": True, "completed": completed_now}


def record_quiz(user_id: str, video_id: str, score: int, total: int, difficulty: str) -> None:
    with connection() as conn:
        before = repo.today_stats(conn, user_id)
        repo.record_quiz_attempt(conn, user_id, video_id, score, total, difficulty)
        after = repo.today_stats(conn, user_id)
    check_goal_notifications(user_id, before, after)
