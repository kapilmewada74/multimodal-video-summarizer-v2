-- Phase 3: study sessions and stats, streaks, goals, video progress, quiz
-- attempts, notes, playlists, notifications.

------------------------------------------------------------------------
-- Per-user video progress (on the library row)
------------------------------------------------------------------------
alter table public.user_videos
    add column progress_seconds integer not null default 0 check (progress_seconds >= 0),
    add column completed_at     timestamptz,
    add column last_watched_at  timestamptz;

alter table public.profiles
    add column study_credited_until timestamptz,   -- study time is credited only once, even across tabs
    add column reminder_hour smallint not null default 20 check (reminder_hour between 0 and 23),
    add column quiet_start   smallint check (quiet_start between 0 and 23),
    add column quiet_end     smallint check (quiet_end between 0 and 23);

------------------------------------------------------------------------
-- Study sessions and daily totals
------------------------------------------------------------------------
create table public.study_sessions (
    id                uuid primary key default gen_random_uuid(),
    user_id           uuid not null references auth.users (id) on delete cascade,
    video_id          uuid references public.videos (id) on delete set null,
    started_at        timestamptz not null default now(),
    last_heartbeat_at timestamptz not null default now(),
    ended_at          timestamptz,
    active_seconds    integer not null default 0 check (active_seconds >= 0)
);
create index study_sessions_user_idx on public.study_sessions (user_id, started_at desc);

-- One row per user and local day. `day` is the day in the user's own time zone.
create table public.daily_stats (
    user_id       uuid not null references auth.users (id) on delete cascade,
    day           date not null,
    seconds       integer not null default 0 check (seconds >= 0),
    videos_done   integer not null default 0 check (videos_done >= 0),
    quizzes_taken integer not null default 0 check (quizzes_taken >= 0),
    primary key (user_id, day)
);

create table public.goals (
    id      uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    type    text not null check (type in ('minutes', 'videos', 'quizzes')),
    target  integer not null check (target between 1 and 1440),
    active  boolean not null default true,
    unique (user_id, type)
);

create table public.quiz_attempts (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    video_id   uuid not null references public.videos (id) on delete cascade,
    score      integer not null check (score >= 0),
    total      integer not null check (total > 0),
    difficulty text not null default 'medium',
    created_at timestamptz not null default now(),
    check (score <= total)
);
create index quiz_attempts_user_idx on public.quiz_attempts (user_id, created_at desc);

------------------------------------------------------------------------
-- Notes (typed notes, one document per user and video)
------------------------------------------------------------------------
create table public.notes (
    user_id    uuid not null references auth.users (id) on delete cascade,
    video_id   uuid not null references public.videos (id) on delete cascade,
    content    text not null default '' check (length(content) <= 200000),
    updated_at timestamptz not null default now(),
    primary key (user_id, video_id)
);

------------------------------------------------------------------------
-- Playlists. Items are YouTube videos (by id, even if not summarized yet)
-- or uploaded videos (by video id). `position` is a fractional index: moving
-- an item changes only that one row.
------------------------------------------------------------------------
create table public.playlists (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    title      text not null check (length(title) between 1 and 120),
    source     text not null default 'custom' check (source in ('custom', 'youtube')),
    source_id  text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index playlists_user_idx on public.playlists (user_id, created_at desc);

create table public.playlist_items (
    id               uuid primary key default gen_random_uuid(),
    playlist_id      uuid not null references public.playlists (id) on delete cascade,
    youtube_id       text,
    video_id         uuid references public.videos (id) on delete cascade,
    title            text,
    duration_seconds integer,
    position         text collate "C" not null,
    added_at         timestamptz not null default now(),
    check ((youtube_id is null) <> (video_id is null))
);
create unique index playlist_items_youtube_key on public.playlist_items (playlist_id, youtube_id) where youtube_id is not null;
create unique index playlist_items_video_key on public.playlist_items (playlist_id, video_id) where video_id is not null;
create index playlist_items_order_idx on public.playlist_items (playlist_id, position);

------------------------------------------------------------------------
-- Notifications
------------------------------------------------------------------------
create table public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    type       text not null check (type in ('goal_reached', 'streak_at_risk', 'streak_milestone', 'summary_ready')),
    title      text not null,
    body       text,
    link       text,
    dedupe_key text,
    in_app     boolean not null default true,   -- false: recorded only for de-duplication (email/push only)
    created_at timestamptz not null default now(),
    read_at    timestamptz
);
create unique index notifications_dedupe_key on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
create index notifications_user_idx on public.notifications (user_id, created_at desc);

-- A missing row means "default": in-app on, email and push off.
create table public.notification_prefs (
    user_id uuid not null references auth.users (id) on delete cascade,
    channel text not null check (channel in ('in_app', 'email', 'push')),
    type    text not null check (type in ('goal_reached', 'streak_at_risk', 'streak_milestone', 'summary_ready')),
    enabled boolean not null,
    primary key (user_id, channel, type)
);

create table public.push_subscriptions (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null references auth.users (id) on delete cascade,
    endpoint        text not null unique,
    p256dh          text not null,
    auth            text not null,
    created_at      timestamptz not null default now(),
    last_success_at timestamptz
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

------------------------------------------------------------------------
-- Functions (backend only)
------------------------------------------------------------------------

-- Credit study time. The SERVER measures the time since the last heartbeat
-- (capped), so a client cannot claim more than really passed, and a second tab
-- cannot count the same minutes twice. Returns what was credited and today's total.
create function public.record_heartbeat(p_user uuid, p_session uuid, p_active boolean, p_max_gap integer)
returns table (credited integer, today_seconds integer)
language plpgsql security definer set search_path = public as $$
declare
    v_session public.study_sessions;
    v_profile public.profiles;
    v_start   timestamptz;
    v_gap     integer := 0;
    v_day     date;
    v_today   integer;
begin
    select * into v_session from public.study_sessions
     where id = p_session and user_id = p_user and ended_at is null for update;
    if not found then
        raise exception 'session_not_found';
    end if;

    -- Locking the profile makes the user's sessions take turns when crediting.
    select * into v_profile from public.profiles where user_id = p_user for update;
    if not found then
        raise exception 'profile_not_found';
    end if;

    if p_active then
        v_start := greatest(v_session.last_heartbeat_at,
                            coalesce(v_profile.study_credited_until, v_session.last_heartbeat_at));
        v_gap := greatest(0, least(extract(epoch from (now() - v_start))::integer, p_max_gap));
    end if;

    update public.study_sessions
       set last_heartbeat_at = now(), active_seconds = active_seconds + v_gap
     where id = p_session;

    v_day := (now() at time zone v_profile.timezone)::date;
    if v_gap > 0 then
        update public.profiles set study_credited_until = now() where user_id = p_user;
        insert into public.daily_stats (user_id, day, seconds) values (p_user, v_day, v_gap)
        on conflict (user_id, day) do update set seconds = public.daily_stats.seconds + excluded.seconds;
    end if;

    select coalesce(d.seconds, 0) into v_today from public.daily_stats d where d.user_id = p_user and d.day = v_day;
    return query select v_gap, coalesce(v_today, 0);
end;
$$;

-- Mark a video finished, once. Returns true only the first time.
create function public.mark_video_completed(p_user uuid, p_video uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
    v_tz    text;
begin
    update public.user_videos set completed_at = now()
     where user_id = p_user and video_id = p_video and completed_at is null;
    get diagnostics v_count = row_count;
    if v_count = 0 then
        return false;
    end if;
    select timezone into v_tz from public.profiles where user_id = p_user;
    insert into public.daily_stats (user_id, day, videos_done)
    values (p_user, (now() at time zone coalesce(v_tz, 'UTC'))::date, 1)
    on conflict (user_id, day) do update set videos_done = public.daily_stats.videos_done + 1;
    return true;
end;
$$;

create function public.record_quiz_attempt(p_user uuid, p_video uuid, p_score integer, p_total integer, p_difficulty text)
returns void
language plpgsql security definer set search_path = public as $$
declare
    v_tz text;
begin
    insert into public.quiz_attempts (user_id, video_id, score, total, difficulty)
    values (p_user, p_video, p_score, p_total, p_difficulty);
    select timezone into v_tz from public.profiles where user_id = p_user;
    insert into public.daily_stats (user_id, day, quizzes_taken)
    values (p_user, (now() at time zone coalesce(v_tz, 'UTC'))::date, 1)
    on conflict (user_id, day) do update set quizzes_taken = public.daily_stats.quizzes_taken + 1;
end;
$$;

-- Streak: consecutive local days with at least p_min_seconds of study. A streak
-- stays alive through today if yesterday was completed (today is still open).
create function public.streak_info(p_user uuid, p_min_seconds integer)
returns table (current_streak integer, longest_streak integer, today_seconds integer, today_done boolean)
language plpgsql stable security definer set search_path = public as $$
declare
    v_tz      text;
    v_today   date;
    v_current integer := 0;
    v_longest integer := 0;
    v_secs    integer := 0;
begin
    select timezone into v_tz from public.profiles where user_id = p_user;
    if v_tz is null then
        raise exception 'profile_not_found';
    end if;
    v_today := (now() at time zone v_tz)::date;

    with good as (
        select day from public.daily_stats where user_id = p_user and seconds >= p_min_seconds
    ), grouped as (
        select day, day - (row_number() over (order by day))::integer as grp from good
    ), islands as (
        select max(day) as last_day, count(*)::integer as len from grouped group by grp
    )
    select coalesce(max(len) filter (where last_day >= v_today - 1), 0),
           coalesce(max(len), 0)
      into v_current, v_longest
      from islands;

    select coalesce(seconds, 0) into v_secs from public.daily_stats where user_id = p_user and day = v_today;
    return query select v_current, v_longest, coalesce(v_secs, 0), coalesce(v_secs, 0) >= p_min_seconds;
end;
$$;

-- Users who have a streak going, have not studied enough today, and whose local
-- reminder hour has passed. One reminder per user and day is enforced by the
-- notification's dedupe key.
create function public.streak_reminder_candidates(p_min_seconds integer)
returns table (user_id uuid, email text, local_day date, current_streak integer)
language sql stable security definer set search_path = public as $$
    select p.user_id, u.email, (now() at time zone p.timezone)::date, s.current_streak
      from public.profiles p
      join auth.users u on u.id = p.user_id
      cross join lateral public.streak_info(p.user_id, p_min_seconds) s
     where extract(hour from (now() at time zone p.timezone)) >= p.reminder_hour
       and s.current_streak >= 1
       and not s.today_done
       and exists (select 1 from public.daily_stats d
                    where d.user_id = p.user_id
                      and d.day = (now() at time zone p.timezone)::date - 1
                      and d.seconds >= p_min_seconds);
$$;

------------------------------------------------------------------------
-- Security: browser roles read their own data and write nothing; the backend
-- (service role) does all writes. push_subscriptions and the functions are
-- not reachable from the browser at all.
------------------------------------------------------------------------
alter table public.study_sessions     enable row level security;
alter table public.daily_stats        enable row level security;
alter table public.goals              enable row level security;
alter table public.quiz_attempts      enable row level security;
alter table public.notes              enable row level security;
alter table public.playlists          enable row level security;
alter table public.playlist_items     enable row level security;
alter table public.notifications      enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on public.study_sessions, public.daily_stats, public.goals, public.quiz_attempts, public.notes,
             public.playlists, public.playlist_items, public.notifications, public.notification_prefs,
             public.push_subscriptions from anon, authenticated;
revoke all on function public.record_heartbeat(uuid, uuid, boolean, integer),
                       public.mark_video_completed(uuid, uuid),
                       public.record_quiz_attempt(uuid, uuid, integer, integer, text),
                       public.streak_info(uuid, integer),
                       public.streak_reminder_candidates(integer)
      from public, anon, authenticated;

create policy daily_stats_select_own on public.daily_stats for select to authenticated using (user_id = auth.uid());
create policy goals_select_own       on public.goals       for select to authenticated using (user_id = auth.uid());
create policy sessions_select_own    on public.study_sessions for select to authenticated using (user_id = auth.uid());
create policy quiz_attempts_select_own on public.quiz_attempts for select to authenticated using (user_id = auth.uid());
create policy notes_select_own       on public.notes       for select to authenticated using (user_id = auth.uid());
create policy playlists_select_own   on public.playlists   for select to authenticated using (user_id = auth.uid());
create policy playlist_items_select_own on public.playlist_items for select to authenticated
    using (exists (select 1 from public.playlists p where p.id = playlist_items.playlist_id and p.user_id = auth.uid()));
create policy notifications_select_own on public.notifications for select to authenticated
    using (user_id = auth.uid() and in_app);
create policy notification_prefs_select_own on public.notification_prefs for select to authenticated using (user_id = auth.uid());

grant select on public.daily_stats, public.goals, public.study_sessions, public.quiz_attempts, public.notes,
                public.playlists, public.playlist_items, public.notifications, public.notification_prefs
    to authenticated;
-- push_subscriptions: RLS on, no policy, no grant.

grant all on public.study_sessions, public.daily_stats, public.goals, public.quiz_attempts, public.notes,
             public.playlists, public.playlist_items, public.notifications, public.notification_prefs,
             public.push_subscriptions to service_role;
grant execute on function public.record_heartbeat(uuid, uuid, boolean, integer),
                          public.mark_video_completed(uuid, uuid),
                          public.record_quiz_attempt(uuid, uuid, integer, integer, text),
                          public.streak_info(uuid, integer),
                          public.streak_reminder_candidates(integer)
      to service_role;

-- Live notifications in the browser (Supabase Realtime respects the RLS above).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.notifications;
    end if;
end;
$$;
