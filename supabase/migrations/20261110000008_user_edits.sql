-- Phase 4b: a user's own edited copy of a video's summary or slides, with history.
-- The AI output stays untouched and shared; edits belong to one user, so
-- nobody can change what another user sees. Deleting the edit restores the AI version.

create table public.user_edits (
    user_id    uuid not null references auth.users (id) on delete cascade,
    video_id   uuid not null references public.videos (id) on delete cascade,
    kind       text not null check (kind in ('summary', 'slides')),
    content    jsonb not null,
    updated_at timestamptz not null default now(),
    primary key (user_id, video_id, kind)
);

-- Earlier states, newest kept up to a cap by the API.
create table public.user_edit_versions (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    video_id   uuid not null references public.videos (id) on delete cascade,
    kind       text not null check (kind in ('summary', 'slides')),
    content    jsonb not null,
    created_at timestamptz not null default now()
);
create index user_edit_versions_lookup_idx on public.user_edit_versions (user_id, video_id, kind, created_at desc);

alter table public.user_edits         enable row level security;
alter table public.user_edit_versions enable row level security;
revoke all on public.user_edits, public.user_edit_versions from anon, authenticated;

create policy user_edits_select_own on public.user_edits
    for select to authenticated using (user_id = auth.uid());
create policy user_edit_versions_select_own on public.user_edit_versions
    for select to authenticated using (user_id = auth.uid());
grant select on public.user_edits, public.user_edit_versions to authenticated;

grant all on public.user_edits, public.user_edit_versions to service_role;
