-- Phase 4f: pomodoros in the study stats.
alter table public.daily_stats
    add column pomodoros integer not null default 0 check (pomodoros between 0 and 100);
alter table public.study_sessions
    add column pomodoros integer not null default 0 check (pomodoros >= 0),
    add column last_pomodoro_at timestamptz;
