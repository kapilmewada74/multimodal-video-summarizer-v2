"""The streak rules: one forgiven day a week, never two in a row. Pure functions, no database."""
from datetime import date, timedelta

from summarizer.features.study.streaks import compute_streak, week_start, week_view

MIN = 600
WED = date(2026, 11, 11)          # a Wednesday; its week runs Mon 9th to Sun 15th


def days(*offsets_and_seconds, today=WED):
    """{date: seconds} from (days_ago, seconds) pairs."""
    return {today - timedelta(days=ago): secs for ago, secs in offsets_and_seconds}


def study(*ago, today=WED):
    return days(*[(a, MIN) for a in ago], today=today)


def test_no_study_means_no_streak():
    r = compute_streak({}, WED, MIN)
    assert (r["current"], r["longest"], r["today_done"], r["at_risk"], r["freeze_available"]) == (0, 0, False, False, True)


def test_plain_consecutive_days_count():
    r = compute_streak(study(0, 1, 2, 3), WED, MIN)
    assert (r["current"], r["longest"], r["today_done"]) == (4, 4, True)


def test_a_day_needs_the_minimum_to_count():
    r = compute_streak(days((0, MIN - 1), (1, MIN), (2, MIN)), WED, MIN)
    assert r["current"] == 2 and r["today_done"] is False


def test_today_is_not_a_miss_yet():
    r = compute_streak(study(1, 2, 3), WED, MIN)            # nothing yet today
    assert r["current"] == 3 and r["frozen_days"] == []


def test_studying_today_extends_the_streak():
    assert compute_streak(study(0, 1, 2), WED, MIN)["current"] == 3


def test_one_missed_day_in_a_week_is_forgiven():
    # studied Mon, (Tue missed), Wed today
    r = compute_streak(study(0, 2), WED, MIN)
    assert r["current"] == 2                                  # Tue does not add, but it does not break either
    assert r["frozen_days"] == [WED - timedelta(days=1)]
    assert r["freeze_available"] is False                     # this week's freeze is used


def test_a_second_miss_in_the_same_week_breaks_it():
    # Mon studied, Tue missed (frozen), Wed missed (broken), Thu studied
    thu = date(2026, 11, 12)
    r = compute_streak(study(3, 0, today=thu), thu, MIN)      # Mon and Thu
    assert r["current"] == 1
    assert r["frozen_days"] == []                             # the freeze did not save anything


def test_two_misses_in_a_row_break_it_even_across_a_week_boundary():
    mon = date(2026, 11, 9)
    seconds = {date(2026, 11, 7): MIN, mon: MIN}              # Sat studied, Sun missed (frozen), Mon studied: fine
    assert compute_streak(seconds, mon, MIN)["current"] == 2
    seconds = {date(2026, 11, 7): MIN, date(2026, 11, 10): MIN}   # Sat, then Sun and Mon missed, Tue studied
    r = compute_streak(seconds, date(2026, 11, 10), MIN)
    assert r["current"] == 1


def test_each_week_gets_its_own_freeze():
    # Studied Mon 2nd, Wed 4th (Tue 3rd frozen), Fri 6th (Thu 5th would be a second miss that week -> break)
    seconds = {date(2026, 11, 2): MIN, date(2026, 11, 4): MIN, date(2026, 11, 6): MIN}
    assert compute_streak(seconds, date(2026, 11, 6), MIN)["current"] == 1
    # one miss per week: Tue 3rd missed, then Tue 10th missed, studied every other day
    seconds = {date(2026, 11, d): MIN for d in (2, 4, 5, 6, 7, 8, 9, 11)}
    r = compute_streak(seconds, date(2026, 11, 11), MIN)
    assert r["current"] == 8                                  # 8 studied days; Tue 3rd and Tue 10th both forgiven
    assert len(r["frozen_days"]) == 2


def test_the_longest_streak_remembers_forgiven_days_too():
    seconds = {date(2026, 10, d): MIN for d in (1, 2, 4, 5, 6)}   # Wed 3rd forgiven
    r = compute_streak(seconds, date(2026, 11, 11), MIN)
    assert r["longest"] == 5
    assert r["current"] == 0                                   # long ago


def test_a_streak_that_ended_long_ago_does_not_linger():
    r = compute_streak(study(30, 31, 32), WED, MIN)
    assert r["current"] == 0 and r["longest"] == 3


def test_at_risk_when_yesterday_was_missed_and_today_is_not_done():
    r = compute_streak(study(2, 3), WED, MIN)                  # studied Sun, Mon; Tue missed (frozen); today nothing yet
    assert r["current"] == 2 and r["at_risk"] is True
    assert compute_streak(study(0, 2, 3), WED, MIN)["at_risk"] is False   # studying today saves it
    assert compute_streak(study(1, 2), WED, MIN)["at_risk"] is False      # yesterday counted


def test_a_frozen_day_alone_never_creates_a_streak():
    # Only one old study day, then nothing: the following days are misses, not a growing streak
    r = compute_streak(study(20), WED, MIN)
    assert r["current"] == 0 and r["longest"] == 1


def test_freeze_is_available_again_in_a_new_week():
    r = compute_streak(study(0, 2), WED, MIN)                  # freeze used this week
    assert r["freeze_available"] is False
    next_mon = date(2026, 11, 16)
    r2 = compute_streak({**study(0, 2), next_mon: MIN}, next_mon, MIN)
    assert r2["freeze_available"] is True


def test_week_starts_on_monday():
    assert week_start(date(2026, 11, 15)) == date(2026, 11, 9)     # Sunday
    assert week_start(date(2026, 11, 9)) == date(2026, 11, 9)      # Monday
    assert week_start(WED) == date(2026, 11, 9)


def test_week_view_marks_counted_frozen_today_and_future_days():
    seconds = study(0, 2)                                          # Mon and Wed
    info = compute_streak(seconds, WED, MIN)
    view = week_view(seconds, WED, MIN, info["frozen_days"])
    assert [d["day"] for d in view] == [f"2026-11-{n}" for n in ("09", 10, 11, 12, 13, 14, 15)]
    assert [d["counted"] for d in view] == [True, False, True, False, False, False, False]
    assert [d["frozen"] for d in view] == [False, True, False, False, False, False, False]
    assert [d["is_today"] for d in view] == [False, False, True, False, False, False, False]
    assert [d["future"] for d in view] == [False, False, False, True, True, True, True]
