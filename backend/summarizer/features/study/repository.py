from datetime import date
from typing import Any, Dict, List, Optional

from . import streaks

Row = Dict[str, Any]

GOAL_TYPES = ("minutes", "videos", "quizzes")


def start_session(conn, user_id: str, video_id: Optional[str]) -> str:
    return str(conn.execute("insert into study_sessions (user_id, video_id) values (%s, %s) returning id",
                            (user_id, video_id)).fetchone()["id"])


def heartbeat(conn, user_id: str, session_id: str, active: bool, max_gap: int) -> Row:
    return conn.execute("select * from record_heartbeat(%s, %s, %s, %s)",
                        (user_id, session_id, active, max_gap)).fetchone()


def end_session(conn, user_id: str, session_id: str) -> bool:
    return conn.execute("update study_sessions set ended_at = now() where id = %s and user_id = %s and ended_at is null",
                        (session_id, user_id)).rowcount > 0


def local_today(conn, user_id: str) -> date:
    return conn.execute("select (now() at time zone timezone)::date d from profiles where user_id = %s",
                        (user_id,)).fetchone()["d"]


def today_stats(conn, user_id: str) -> Row:
    row = conn.execute(
        """select coalesce(d.seconds, 0) seconds, coalesce(d.videos_done, 0) videos_done,
                  coalesce(d.quizzes_taken, 0) quizzes_taken, coalesce(d.pomodoros, 0) pomodoros
             from profiles p
             left join daily_stats d on d.user_id = p.user_id and d.day = (now() at time zone p.timezone)::date
            where p.user_id = %s""", (user_id,)).fetchone()
    return row or {"seconds": 0, "videos_done": 0, "quizzes_taken": 0, "pomodoros": 0}


def recent_days(conn, user_id: str, days: int) -> List[Row]:
    """The last `days` local days (oldest first), including days without study."""
    return conn.execute(
        """with p as (select (now() at time zone timezone)::date as today from profiles where user_id = %s)
           select p.today - n as day, coalesce(d.seconds, 0) seconds, coalesce(d.videos_done, 0) videos_done,
                  coalesce(d.quizzes_taken, 0) quizzes_taken, coalesce(d.pomodoros, 0) pomodoros
             from p
             cross join generate_series(%s - 1, 0, -1) as n
             left join daily_stats d on d.user_id = %s and d.day = p.today - n
            order by day""", (user_id, days, user_id)).fetchall()


def daily_seconds(conn, user_id: str, days: int = 800) -> Dict[date, int]:
    """Seconds studied per local day, for the last `days` days (days without study are left out)."""
    rows = conn.execute(
        """select d.day, d.seconds from daily_stats d join profiles p on p.user_id = d.user_id
            where d.user_id = %s and d.seconds > 0 and d.day >= (now() at time zone p.timezone)::date - %s""",
        (user_id, days)).fetchall()
    return {r["day"]: r["seconds"] for r in rows}


def streak(conn, user_id: str, min_seconds: int) -> Row:
    """Current and longest streak (with one forgiven day a week), and the details the study page shows."""
    seconds = daily_seconds(conn, user_id)
    info = streaks.compute_streak(seconds, local_today(conn, user_id), min_seconds)
    return {"current_streak": info["current"], "longest_streak": info["longest"], "today_done": info["today_done"],
            "frozen_days": info["frozen_days"], "freeze_available": info["freeze_available"], "at_risk": info["at_risk"],
            "seconds_by_day": seconds}


def add_pomodoro(conn, user_id: str, session_id: str, min_gap_seconds: int, daily_cap: int) -> Optional[int]:
    """Count one finished focus block. Returns today's total, or None if it should not count
    (unknown session, too soon after the last one, or the daily cap is reached)."""
    session = conn.execute(
        """update study_sessions set pomodoros = pomodoros + 1, last_pomodoro_at = now()
            where id = %s and user_id = %s and ended_at is null
              and (last_pomodoro_at is null or now() - last_pomodoro_at >= make_interval(secs => %s))
        returning id""", (session_id, user_id, min_gap_seconds)).fetchone()
    if not session:
        return None
    row = conn.execute(
        """insert into daily_stats (user_id, day, pomodoros)
           select %s, (now() at time zone p.timezone)::date, 1 from profiles p where p.user_id = %s
           on conflict (user_id, day) do update set pomodoros = daily_stats.pomodoros + 1
              where daily_stats.pomodoros < %s
           returning pomodoros""", (user_id, user_id, daily_cap)).fetchone()
    if not row:  # over the cap: undo the session count too
        conn.execute("update study_sessions set pomodoros = pomodoros - 1 where id = %s", (session_id,))
        return None
    return row["pomodoros"]


def recent_sessions(conn, user_id: str, limit: int) -> List[Row]:
    return conn.execute(
        """select s.id, s.video_id, v.title, s.started_at, s.last_heartbeat_at, s.active_seconds, s.pomodoros
             from study_sessions s left join videos v on v.id = s.video_id
            where s.user_id = %s and s.active_seconds > 0
            order by s.started_at desc limit %s""", (user_id, limit)).fetchall()


def time_by_video(conn, user_id: str, days: int, limit: int) -> List[Row]:
    """Where the study time went: seconds per video over the last `days` days (most first)."""
    return conn.execute(
        """select s.video_id, v.title, sum(s.active_seconds)::int as seconds, count(*)::int as sessions
             from study_sessions s join videos v on v.id = s.video_id
            where s.user_id = %s and s.active_seconds > 0 and s.started_at >= now() - make_interval(days => %s)
            group by s.video_id, v.title order by seconds desc limit %s""", (user_id, days, limit)).fetchall()


def list_goals(conn, user_id: str) -> List[Row]:
    return conn.execute("select type, target, active from goals where user_id = %s order by type", (user_id,)).fetchall()


def save_goal(conn, user_id: str, kind: str, target: int, active: bool) -> None:
    conn.execute(
        """insert into goals (user_id, type, target, active) values (%s, %s, %s, %s)
           on conflict (user_id, type) do update set target = excluded.target, active = excluded.active""",
        (user_id, kind, target, active))


def update_progress(conn, user_id: str, video_id: str, position: int) -> bool:
    return conn.execute(
        "update user_videos set progress_seconds = %s, last_watched_at = now() where user_id = %s and video_id = %s",
        (position, user_id, video_id)).rowcount > 0


def mark_completed(conn, user_id: str, video_id: str) -> bool:
    return conn.execute("select mark_video_completed(%s, %s) r", (user_id, video_id)).fetchone()["r"]


def record_quiz_attempt(conn, user_id: str, video_id: str, score: int, total: int, difficulty: str) -> None:
    conn.execute("select record_quiz_attempt(%s, %s, %s, %s, %s)", (user_id, video_id, score, total, difficulty))
