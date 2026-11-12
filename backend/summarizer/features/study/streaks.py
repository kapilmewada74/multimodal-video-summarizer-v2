"""Streaks, with one forgiven day per week.

A day counts when at least `min_seconds` were studied. To keep one bad day from wiping out weeks of effort,
a single missed day in a calendar week (Monday to Sunday) is "frozen": it does not add to the streak, but it
does not break it either. Two missed days in a row always break it, and so does a second miss in the same week.
Today is never counted as missed, because it is not over yet.

This is a pure function of the daily totals, so the number cannot drift.
"""
from datetime import date, timedelta
from typing import Any, Dict, List


def week_start(day: date) -> date:
    return day - timedelta(days=day.weekday())


def compute_streak(seconds_by_day: Dict[date, int], today: date, min_seconds: int) -> Dict[str, Any]:
    """`seconds_by_day` maps local dates to seconds studied. Returns the streak numbers and which days were frozen."""
    good_days = [d for d, s in seconds_by_day.items() if s >= min_seconds and d <= today]
    today_done = seconds_by_day.get(today, 0) >= min_seconds
    result: Dict[str, Any] = {
        "current": 0, "longest": 0, "today_done": today_done, "frozen_days": [],
        "freeze_available": True, "at_risk": False,
    }
    if not good_days:
        return result

    run = longest = 0
    used_weeks: set = set()
    frozen: List[date] = []
    day = min(good_days)
    while day <= today:
        if seconds_by_day.get(day, 0) >= min_seconds:
            run += 1
            longest = max(longest, run)
        elif day != today:                                      # a missed day in the past
            consecutive = bool(frozen) and frozen[-1] == day - timedelta(days=1)
            if run > 0 and week_start(day) not in used_weeks and not consecutive:
                used_weeks.add(week_start(day))
                frozen.append(day)
            else:
                # The streak broke: a freeze used on the way did not save it, so it is not reported as used.
                run = 0
                frozen = []
                used_weeks = set()
        day += timedelta(days=1)

    yesterday = today - timedelta(days=1)
    result.update(
        current=run,
        longest=longest,
        frozen_days=[d for d in frozen if d >= today - timedelta(days=60)],
        freeze_available=week_start(today) not in used_weeks,
        # The streak is alive but today has not counted yet and yesterday did not either: studying today keeps it.
        at_risk=run > 0 and not today_done and seconds_by_day.get(yesterday, 0) < min_seconds,
    )
    return result


def week_view(seconds_by_day: Dict[date, int], today: date, min_seconds: int, frozen_days: List[date]) -> List[Dict[str, Any]]:
    """The seven days of the current week (Monday first) for the week strip."""
    start = week_start(today)
    frozen = set(frozen_days)
    out = []
    for offset in range(7):
        day = start + timedelta(days=offset)
        seconds = seconds_by_day.get(day, 0)
        out.append({
            "day": day.isoformat(), "seconds": seconds, "counted": seconds >= min_seconds,
            "frozen": day in frozen, "is_today": day == today, "future": day > today,
        })
    return out
