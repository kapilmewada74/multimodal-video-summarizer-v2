-- Phase 4c: flashcards, quiz, mind map and slides made from the user's OWN documents.
-- Unlike video_outputs (shared by everyone with the video), these hold text taken from one
-- user's private files, so they belong to that user only.

create table public.user_outputs (
    user_id    uuid not null references auth.users (id) on delete cascade,
    video_id   uuid not null references public.videos (id) on delete cascade,
    kind       text not null check (kind in ('flashcards', 'quiz', 'mindmap', 'slides')),
    variant    text not null default '',
    content    jsonb not null,
    created_at timestamptz not null default now(),
    primary key (user_id, video_id, kind, variant)
);

alter table public.user_outputs enable row level security;
revoke all on public.user_outputs from anon, authenticated;
create policy user_outputs_select_own on public.user_outputs
    for select to authenticated using (user_id = auth.uid());
grant select on public.user_outputs to authenticated;
grant all on public.user_outputs to service_role;
