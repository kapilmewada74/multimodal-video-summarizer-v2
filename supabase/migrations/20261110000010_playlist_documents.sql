-- Phase 4e: documents live next to the videos they belong to.
--  * a document can be attached to a playlist item ("lesson"), even before that video is summarized;
--  * a document can be an item of its own in a playlist, ordered and dragged like videos.

alter table public.documents
    add column playlist_item_id uuid references public.playlist_items (id) on delete set null;
create index documents_item_idx on public.documents (user_id, playlist_item_id) where playlist_item_id is not null;

-- The same file may not be added twice to the same video or the same lesson. Loose files
-- (rows of their own in a playlist) are checked per playlist by the API instead.
drop index public.documents_dedupe_idx;
create unique index documents_dedupe_idx on public.documents
    (user_id, sha256, coalesce(video_id, playlist_item_id))
    where video_id is not null or playlist_item_id is not null;

alter table public.playlist_items
    add column document_id uuid references public.documents (id) on delete cascade;
alter table public.playlist_items drop constraint playlist_items_one_source;
alter table public.playlist_items add constraint playlist_items_one_source check (
    (youtube_id is not null)::int + (video_id is not null)::int + (upload_id is not null)::int + (document_id is not null)::int = 1);
create unique index playlist_items_document_key on public.playlist_items (playlist_id, document_id) where document_id is not null;

grant select (playlist_item_id) on public.documents to authenticated;
