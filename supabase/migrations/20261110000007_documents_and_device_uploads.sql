-- Documents (any study file, with or without a video) and videos uploaded from the
-- user's own device into a playlist.

------------------------------------------------------------------------
-- documents: PDF, Word, PowerPoint, ... A document may belong to a video or stand alone.
------------------------------------------------------------------------
create table public.documents (
    id             uuid primary key default gen_random_uuid(),
    user_id        uuid not null references auth.users (id) on delete cascade,
    video_id       uuid references public.videos (id) on delete set null,   -- null: not tied to a video
    filename       text not null check (length(filename) between 1 and 200),
    extension      text not null check (length(extension) between 1 and 10),
    mime           text not null,
    size_bytes     bigint not null check (size_bytes > 0),
    sha256         text not null check (length(sha256) = 64),
    storage_key    text not null,
    -- 'none': a format we do not read (images, spreadsheets); 'extracted'; 'failed'
    text_status    text not null default 'none' check (text_status in ('none', 'extracted', 'failed')),
    extracted_text text,
    created_at     timestamptz not null default now()
);
create index documents_user_idx  on public.documents (user_id, created_at desc);
create index documents_video_idx on public.documents (user_id, video_id);
-- The same file cannot be added twice to the same video (or twice as a standalone file).
create unique index documents_dedupe_idx on public.documents
    (user_id, sha256, coalesce(video_id, '00000000-0000-0000-0000-000000000000'::uuid));

------------------------------------------------------------------------
-- video_uploads: a video or audio file from the user's device. Kept so it can be
-- played; `video_id` is set once the user asks for it to be summarized.
------------------------------------------------------------------------
create table public.video_uploads (
    id               uuid primary key default gen_random_uuid(),
    user_id          uuid not null references auth.users (id) on delete cascade,
    video_id         uuid references public.videos (id) on delete set null,
    filename         text not null check (length(filename) between 1 and 200),
    mime             text not null,
    size_bytes       bigint not null check (size_bytes > 0),
    sha256           text not null check (length(sha256) = 64),
    storage_key      text not null,
    created_at       timestamptz not null default now()
);
create index video_uploads_user_idx on public.video_uploads (user_id, created_at desc);

-- Playlist items can now also be device uploads (exactly one source per item).
alter table public.playlist_items
    add column upload_id uuid references public.video_uploads (id) on delete cascade;
alter table public.playlist_items drop constraint playlist_items_check;
alter table public.playlist_items add constraint playlist_items_one_source check (
    (youtube_id is not null)::int + (video_id is not null)::int + (upload_id is not null)::int = 1);
create unique index playlist_items_upload_key on public.playlist_items (playlist_id, upload_id) where upload_id is not null;

-- How much storage a user has used (documents + uploaded videos).
create function public.storage_used(p_user uuid) returns bigint
language sql stable security definer set search_path = public as $$
    select coalesce((select sum(size_bytes) from public.documents where user_id = p_user), 0)
         + coalesce((select sum(size_bytes) from public.video_uploads where user_id = p_user), 0);
$$;

------------------------------------------------------------------------
-- Security: browser roles read their own rows and write nothing.
------------------------------------------------------------------------
alter table public.documents     enable row level security;
alter table public.video_uploads enable row level security;
revoke all on public.documents, public.video_uploads from anon, authenticated;
revoke all on function public.storage_used(uuid) from public, anon, authenticated;

create policy documents_select_own on public.documents for select to authenticated using (user_id = auth.uid());
create policy video_uploads_select_own on public.video_uploads for select to authenticated using (user_id = auth.uid());
-- The extracted text and storage key are not for the browser: grant only safe columns.
grant select (id, user_id, video_id, filename, extension, mime, size_bytes, text_status, created_at) on public.documents to authenticated;
grant select (id, user_id, video_id, filename, mime, size_bytes, created_at) on public.video_uploads to authenticated;

grant all on public.documents, public.video_uploads to service_role;
grant execute on function public.storage_used(uuid) to service_role;
