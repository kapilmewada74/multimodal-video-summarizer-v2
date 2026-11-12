-- Row Level Security. Users only ever see their own rows. All writes that
-- cost money or change shared data go through the backend (service role).

alter table public.profiles    enable row level security;
alter table public.videos      enable row level security;
alter table public.user_videos enable row level security;
alter table public.transcripts enable row level security;
alter table public.summaries   enable row level security;
alter table public.jobs        enable row level security;
alter table public.ip_usage    enable row level security;

-- Start from zero access for the browser-facing roles.
revoke all on all tables    in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;

-- ---- profiles ---------------------------------------------------------
create policy profiles_select_own on public.profiles
    for select to authenticated using (user_id = auth.uid());
create policy profiles_update_own on public.profiles
    for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
grant select on public.profiles to authenticated;
-- Only these columns can be changed by the user. daily_video_limit cannot.
grant update (display_name, timezone) on public.profiles to authenticated;

-- ---- user_videos ------------------------------------------------------
create policy user_videos_select_own on public.user_videos
    for select to authenticated using (user_id = auth.uid());
create policy user_videos_delete_own on public.user_videos
    for delete to authenticated using (user_id = auth.uid());
grant select, delete on public.user_videos to authenticated;

-- ---- shared video data: visible if the user added the video ------------
create policy videos_select_added on public.videos
    for select to authenticated
    using (exists (select 1 from public.user_videos uv
                    where uv.video_id = videos.id and uv.user_id = auth.uid()));
create policy transcripts_select_added on public.transcripts
    for select to authenticated
    using (exists (select 1 from public.user_videos uv
                    where uv.video_id = transcripts.video_id and uv.user_id = auth.uid()));
create policy summaries_select_added on public.summaries
    for select to authenticated
    using (exists (select 1 from public.user_videos uv
                    where uv.video_id = summaries.video_id and uv.user_id = auth.uid()));
grant select on public.videos, public.transcripts, public.summaries to authenticated;

-- ---- jobs: read own (needed for Realtime progress) ----------------------
create policy jobs_select_own on public.jobs
    for select to authenticated using (user_id = auth.uid());
grant select on public.jobs to authenticated;

-- ip_usage has RLS on and no policy: nobody but the service role can touch it.

-- Functions are for the backend only.
grant execute on all functions in schema public to service_role;
grant all on all tables in schema public to service_role;

-- Live job progress in the browser (Supabase Realtime respects the RLS above).
do $$
begin
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
        alter publication supabase_realtime add table public.jobs;
    end if;
end;
$$;
