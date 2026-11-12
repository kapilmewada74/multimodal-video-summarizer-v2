-- Business logic that must be atomic lives in the database.

------------------------------------------------------------------------
-- Profile creation / sync from auth.users
------------------------------------------------------------------------
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    insert into public.profiles (user_id, is_anonymous)
    values (new.id, coalesce(new.is_anonymous, false))
    on conflict (user_id) do nothing;
    return new;
end;
$$;

create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- When a guest links Google, Supabase flips is_anonymous to false.
create function public.sync_user_flags() returns trigger
language plpgsql security definer set search_path = public as $$
begin
    update public.profiles
       set is_anonymous = coalesce(new.is_anonymous, false)
     where user_id = new.id;
    return new;
end;
$$;

create trigger on_auth_user_updated
    after update of is_anonymous on auth.users
    for each row execute function public.sync_user_flags();

-- Reject unknown time zones so day boundaries are always computable.
create function public.validate_timezone() returns trigger
language plpgsql as $$
begin
    if not exists (select 1 from pg_timezone_names where name = new.timezone) then
        raise exception 'invalid_timezone';
    end if;
    return new;
end;
$$;

create trigger profiles_validate_timezone before insert or update of timezone on public.profiles
    for each row execute function public.validate_timezone();

------------------------------------------------------------------------
-- Daily usage: videos added "today" in the user's own time zone.
-- A job that failed because of OUR error does not use up a slot.
------------------------------------------------------------------------
create function public.usage_today(p_user uuid)
returns table (used integer, daily_limit integer, resets_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare
    v_tz        text;
    v_limit     integer;
    v_day_start timestamptz;
begin
    select timezone, daily_video_limit into v_tz, v_limit
      from public.profiles where user_id = p_user;
    if not found then
        raise exception 'profile_not_found';
    end if;

    v_day_start := date_trunc('day', now() at time zone v_tz) at time zone v_tz;

    return query
    select (select count(*)::integer
              from public.jobs j
             where j.user_id = p_user
               and j.kind = 'ingest'
               and j.created_at >= v_day_start
               and not (j.status = 'failed' and j.error_kind = 'system')),
           v_limit,
           ((date_trunc('day', now() at time zone v_tz) + interval '1 day') at time zone v_tz);
end;
$$;

------------------------------------------------------------------------
-- enqueue_ingest: check the limit and create the job in one transaction.
-- The profile row is locked, so two parallel requests cannot both slip
-- past the limit.
------------------------------------------------------------------------
create function public.enqueue_ingest(
    p_user       uuid,
    p_source     text,
    p_source_ref text,
    p_youtube_id text,
    p_file_hash  text,
    p_mode       text
) returns public.jobs
language plpgsql security definer set search_path = public as $$
declare
    v_used  integer;
    v_limit integer;
    v_video public.videos;
    v_job   public.jobs;
begin
    perform 1 from public.profiles where user_id = p_user for update;
    if not found then
        raise exception 'profile_not_found';
    end if;

    select u.used, u.daily_limit into v_used, v_limit from public.usage_today(p_user) u;
    if v_used >= v_limit then
        raise exception 'daily_limit_reached';
    end if;

    -- Find or create the shared video row.
    if p_source = 'youtube' then
        select * into v_video from public.videos where youtube_id = p_youtube_id;
    else
        select * into v_video from public.videos where file_hash = p_file_hash;
    end if;

    if not found then
        insert into public.videos (source, youtube_id, file_hash)
        values (p_source,
                case when p_source = 'youtube' then p_youtube_id end,
                case when p_source = 'upload' then p_file_hash end)
        returning * into v_video;
    elsif v_video.status = 'failed' then
        update public.videos set status = 'pending' where id = v_video.id
        returning * into v_video;
    end if;

    insert into public.user_videos (user_id, video_id)
    values (p_user, v_video.id)
    on conflict do nothing;

    if v_video.status = 'ready' then
        -- Cache hit: nothing to process. It still counts toward the limit.
        insert into public.jobs (user_id, video_id, source, source_ref, mode, status,
                                 step, step_name, progress, message, started_at, finished_at)
        values (p_user, v_video.id, p_source, p_source_ref, p_mode, 'completed',
                3, 'Complete', 100, 'Loaded from the shared cache.', now(), now())
        returning * into v_job;
    else
        insert into public.jobs (user_id, video_id, source, source_ref, mode, message)
        values (p_user, v_video.id, p_source, p_source_ref, p_mode,
                'Waiting for a free worker...')
        returning * into v_job;
    end if;

    return v_job;
end;
$$;

------------------------------------------------------------------------
-- Worker queue helpers
------------------------------------------------------------------------
-- Take the oldest runnable job. SKIP LOCKED lets many workers run safely.
create function public.claim_next_job(p_worker text) returns public.jobs
language plpgsql security definer set search_path = public as $$
declare
    v_job public.jobs;
begin
    update public.jobs j
       set status     = 'processing',
           locked_by  = p_worker,
           locked_at  = now(),
           attempts   = j.attempts + 1,
           started_at = coalesce(j.started_at, now()),
           message    = 'Starting...'
     where j.id = (select q.id
                     from public.jobs q
                    where q.status = 'queued' and q.run_after <= now()
                    order by q.created_at
                    for update skip locked
                    limit 1)
    returning j.* into v_job;
    return v_job;   -- null row when the queue is empty
end;
$$;

-- Jobs whose worker died: retry them, or fail them after max_attempts.
create function public.requeue_stale_jobs(p_timeout interval) returns integer
language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
begin
    with stale as (
        update public.jobs
           set status      = case when attempts < max_attempts then 'queued' else 'failed' end,
               error       = case when attempts < max_attempts then error
                                  else 'The worker stopped before the job finished.' end,
               error_kind  = case when attempts < max_attempts then error_kind else 'system' end,
               finished_at = case when attempts < max_attempts then null else now() end,
               locked_by   = null,
               locked_at   = null,
               message     = case when attempts < max_attempts then 'Retrying...' else message end
         where status = 'processing' and locked_at < now() - p_timeout
        returning 1)
    select count(*)::integer into v_count from stale;
    return v_count;
end;
$$;

-- Per-IP daily counter. Returns the new count for today.
create function public.bump_ip_usage(p_ip_hash text) returns integer
language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
begin
    insert into public.ip_usage (ip_hash, day, count)
    values (p_ip_hash, (now() at time zone 'UTC')::date, 1)
    on conflict (ip_hash, day) do update set count = public.ip_usage.count + 1
    returning count into v_count;
    return v_count;
end;
$$;

-- Housekeeping: old IP counters are not needed.
create function public.purge_old_ip_usage() returns integer
language plpgsql security definer set search_path = public as $$
declare
    v_count integer;
begin
    delete from public.ip_usage where day < (now() at time zone 'UTC')::date - 2;
    get diagnostics v_count = row_count;
    return v_count;
end;
$$;
