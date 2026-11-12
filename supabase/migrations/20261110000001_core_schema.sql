-- Phase 1 core schema: profiles, shared video cache, jobs queue, IP usage.
-- Runs on Supabase (auth.users exists) or any Postgres with an auth.users table.

------------------------------------------------------------------------
-- profiles: one row per user (guests are anonymous Supabase users)
------------------------------------------------------------------------
create table public.profiles (
    user_id            uuid primary key references auth.users (id) on delete cascade,
    display_name       text,
    timezone           text not null default 'UTC',
    daily_video_limit  integer not null default 10 check (daily_video_limit >= 0),
    is_anonymous       boolean not null default false,
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

------------------------------------------------------------------------
-- videos: shared cache, keyed by YouTube id or by file hash
------------------------------------------------------------------------
create table public.videos (
    id               uuid primary key default gen_random_uuid(),
    source           text not null check (source in ('youtube', 'upload')),
    youtube_id       text,
    file_hash        text,
    title            text,
    duration_seconds integer,
    language         text,
    status           text not null default 'pending'
                     check (status in ('pending', 'processing', 'ready', 'failed')),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now(),
    constraint videos_identity_check check (
        (source = 'youtube' and youtube_id is not null)
        or (source = 'upload' and file_hash is not null)
    )
);
create unique index videos_youtube_id_key on public.videos (youtube_id) where youtube_id is not null;
create unique index videos_file_hash_key on public.videos (file_hash) where file_hash is not null;

-- Which videos a user has added (their library / history).
create table public.user_videos (
    user_id   uuid not null references auth.users (id) on delete cascade,
    video_id  uuid not null references public.videos (id) on delete cascade,
    added_at  timestamptz not null default now(),
    primary key (user_id, video_id)
);
create index user_videos_video_idx on public.user_videos (video_id);

create table public.transcripts (
    video_id   uuid primary key references public.videos (id) on delete cascade,
    language   text,
    provider   text,
    text       text not null,
    created_at timestamptz not null default now()
);

create table public.summaries (
    video_id   uuid primary key references public.videos (id) on delete cascade,
    content_md text not null,
    engine     text,
    created_at timestamptz not null default now()
);

------------------------------------------------------------------------
-- jobs: the work queue and the record used for the daily limit
------------------------------------------------------------------------
create table public.jobs (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references auth.users (id) on delete cascade,
    video_id    uuid references public.videos (id) on delete set null,
    kind        text not null default 'ingest',
    source      text not null check (source in ('youtube', 'upload')),
    source_ref  text not null,                 -- YouTube URL or file-store key
    mode        text not null default 'educational',
    status      text not null default 'queued'
                check (status in ('queued', 'processing', 'completed', 'failed')),
    step        integer not null default 0,
    step_name   text not null default 'Queued',
    progress    integer not null default 0 check (progress between 0 and 100),
    message     text,
    error       text,
    error_kind  text check (error_kind in ('user', 'system')),
    attempts    integer not null default 0,
    max_attempts integer not null default 2,
    locked_by   text,
    locked_at   timestamptz,
    run_after   timestamptz not null default now(),
    created_at  timestamptz not null default now(),
    started_at  timestamptz,
    finished_at timestamptz,
    updated_at  timestamptz not null default now()
);
create index jobs_queue_idx on public.jobs (run_after, created_at) where status = 'queued';
create index jobs_user_created_idx on public.jobs (user_id, created_at desc);
create index jobs_video_idx on public.jobs (video_id);

-- Per-IP daily counter (abuse protection; the IP is stored hashed).
create table public.ip_usage (
    ip_hash text not null,
    day     date not null,
    count   integer not null default 0,
    primary key (ip_hash, day)
);

-- Keep updated_at fresh.
create function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

create trigger profiles_touch before update on public.profiles
    for each row execute function public.touch_updated_at();
create trigger videos_touch before update on public.videos
    for each row execute function public.touch_updated_at();
create trigger jobs_touch before update on public.jobs
    for each row execute function public.touch_updated_at();
