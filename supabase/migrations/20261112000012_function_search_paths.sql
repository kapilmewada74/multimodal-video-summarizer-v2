-- Security hardening found by the Supabase advisor: two trigger functions did not pin their search_path.
-- Pinning it means a role cannot change what `now()` or `pg_timezone_names` resolve to.
alter function public.touch_updated_at() set search_path = pg_catalog, public;
alter function public.validate_timezone() set search_path = pg_catalog, public;
