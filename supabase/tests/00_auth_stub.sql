-- TEST ONLY. Recreates the small part of Supabase that the migrations rely
-- on, so the schema can be tested on a plain PostgreSQL server.
-- Never run this against a real Supabase project.
do $$
begin
    if not exists (select 1 from pg_roles where rolname = 'anon') then
        create role anon nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'authenticated') then
        create role authenticated nologin;
    end if;
    if not exists (select 1 from pg_roles where rolname = 'service_role') then
        create role service_role nologin bypassrls;
    end if;
end;
$$;

create schema if not exists auth;
create table auth.users (
    id           uuid primary key,
    email        text,
    is_anonymous boolean not null default false
);

-- Same behaviour as Supabase: reads the user id from the request JWT claims.
create function auth.uid() returns uuid
language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;
