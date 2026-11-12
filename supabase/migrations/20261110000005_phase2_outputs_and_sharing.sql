-- Phase 2: per-video generated outputs, share links, generation cap.

------------------------------------------------------------------------
-- video_outputs: flashcards, quiz, mind map and slides are generated once
-- per video (and variant) and shared by everyone who has the video.
-- `variant` distinguishes options such as quiz difficulty and length.
------------------------------------------------------------------------
create table public.video_outputs (
    video_id   uuid not null references public.videos (id) on delete cascade,
    kind       text not null check (kind in ('flashcards', 'quiz', 'mindmap', 'slides')),
    variant    text not null default '',
    content    jsonb not null,
    created_at timestamptz not null default now(),
    primary key (video_id, kind, variant)
);

------------------------------------------------------------------------
-- share_links: a random, unguessable token that lets anyone read a video's
-- summary. One active link per owner and video; it can be revoked.
------------------------------------------------------------------------
create table public.share_links (
    id         uuid primary key default gen_random_uuid(),
    token      text not null unique check (length(token) >= 32),
    video_id   uuid not null references public.videos (id) on delete cascade,
    owner_id   uuid not null references auth.users (id) on delete cascade,
    created_at timestamptz not null default now(),
    expires_at timestamptz,
    revoked_at timestamptz
);
create unique index share_links_one_active_idx
    on public.share_links (video_id, owner_id) where revoked_at is null;
create index share_links_owner_idx on public.share_links (owner_id);

------------------------------------------------------------------------
-- generation_usage: how many AI generations a user triggered today (UTC).
-- Opening an output that already exists costs nothing and is not counted.
------------------------------------------------------------------------
create table public.generation_usage (
    user_id uuid not null references auth.users (id) on delete cascade,
    day     date not null,
    count   integer not null default 0,
    primary key (user_id, day)
);

-- Atomically use one generation. Returns the new count, or -1 when the
-- daily limit has been reached (the counter is then left unchanged).
create function public.bump_generation_usage(p_user uuid, p_limit integer) returns integer
language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
begin
    insert into public.generation_usage (user_id, day, count)
    values (p_user, (now() at time zone 'UTC')::date, 1)
    on conflict (user_id, day) do update
        set count = public.generation_usage.count + 1
        where public.generation_usage.count < p_limit
    returning count into v_count;

    if v_count is null then
        return -1;
    end if;
    return v_count;
end;
$$;

------------------------------------------------------------------------
-- Security: same model as before. Users read what belongs to them and write
-- nothing directly; the backend (service role) does all writes.
------------------------------------------------------------------------
alter table public.video_outputs    enable row level security;
alter table public.share_links      enable row level security;
alter table public.generation_usage enable row level security;

revoke all on public.video_outputs, public.share_links, public.generation_usage from anon, authenticated;
revoke all on function public.bump_generation_usage(uuid, integer) from public, anon, authenticated;

create policy video_outputs_select_added on public.video_outputs
    for select to authenticated
    using (exists (select 1 from public.user_videos uv
                    where uv.video_id = video_outputs.video_id and uv.user_id = auth.uid()));
grant select on public.video_outputs to authenticated;

create policy share_links_select_own on public.share_links
    for select to authenticated using (owner_id = auth.uid());
grant select on public.share_links to authenticated;

-- generation_usage: RLS on, no policy: only the service role can touch it.

grant all on public.video_outputs, public.share_links, public.generation_usage to service_role;
grant execute on function public.bump_generation_usage(uuid, integer) to service_role;
