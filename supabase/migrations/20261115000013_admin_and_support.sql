-- Phase 6: staff roles (admin, sub-admin), account suspension, the contact form's tickets, and an audit log.
-- Everything here is reachable only through the backend (service role). The browser roles get no access.

------------------------------------------------------------------------
-- staff_roles: who may use the admin panel, and at which level.
--   admin      a few main leads: everything, including who else is staff
--   sub_admin  support people: tickets, read-only look at users and videos, resetting a bad shared output
-- Roles are rows, not settings, so they can be granted and taken away without a deploy, and every change is audited.
------------------------------------------------------------------------
create table public.staff_roles (
    user_id    uuid primary key references auth.users (id) on delete cascade,
    role       text not null check (role in ('admin', 'sub_admin')),
    granted_by uuid references auth.users (id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create trigger staff_roles_touch before update on public.staff_roles
    for each row execute function public.touch_updated_at();

------------------------------------------------------------------------
-- Suspension: a suspended account is refused by the API (the sign-in itself still works, so the person sees why).
------------------------------------------------------------------------
alter table public.profiles
    add column suspended_at     timestamptz,
    add column suspended_reason text check (suspended_reason is null or length(suspended_reason) <= 500),
    add column suspended_by     uuid references auth.users (id) on delete set null;

create index profiles_suspended_idx on public.profiles (suspended_at) where suspended_at is not null;

------------------------------------------------------------------------
-- support_tickets: messages from the "Contact us" form. Visitors do not need an account, so the address is stored
-- on the ticket. Deleting an account deletes its tickets (right to erasure).
------------------------------------------------------------------------
create table public.support_tickets (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid references auth.users (id) on delete cascade,
    email       text not null check (length(email) between 3 and 254),
    name        text check (name is null or length(name) <= 100),
    category    text not null default 'general'
                check (category in ('general', 'bug', 'account', 'content', 'feature', 'other')),
    subject     text not null check (length(subject) between 1 and 150),
    message     text not null check (length(message) between 10 and 4000),
    status      text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'spam')),
    assigned_to uuid references auth.users (id) on delete set null,
    ip_hash     text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now(),
    resolved_at timestamptz
);
create index support_tickets_status_idx on public.support_tickets (status, created_at desc);
create index support_tickets_user_idx on public.support_tickets (user_id) where user_id is not null;
create index support_tickets_ip_idx on public.support_tickets (ip_hash, created_at desc) where ip_hash is not null;

create trigger support_tickets_touch before update on public.support_tickets
    for each row execute function public.touch_updated_at();

-- What happened on a ticket: internal notes, replies that were emailed, status and owner changes.
create table public.support_ticket_events (
    id         bigint generated always as identity primary key,
    ticket_id  uuid not null references public.support_tickets (id) on delete cascade,
    actor_id   uuid references auth.users (id) on delete set null,
    kind       text not null check (kind in ('note', 'reply', 'status', 'assign')),
    body       text check (body is null or length(body) <= 4000),
    created_at timestamptz not null default now()
);
create index support_ticket_events_ticket_idx on public.support_ticket_events (ticket_id, created_at);

------------------------------------------------------------------------
-- admin_audit_log: every change a staff member makes, and every look at one person's details.
-- Append-only: a trigger refuses UPDATE, DELETE and TRUNCATE, so even a compromised staff account cannot erase its tracks
-- through the API. There is no foreign key to auth.users on purpose (deleting an account must not touch the log), so
-- the email and role at that moment are stored with each row.
------------------------------------------------------------------------
create table public.admin_audit_log (
    id          bigint generated always as identity primary key,
    actor_id    uuid,
    actor_email text,
    actor_role  text,
    action      text not null,
    target_type text,
    target_id   text,
    detail      jsonb not null default '{}'::jsonb,
    ip_hash     text,
    created_at  timestamptz not null default now()
);
create index admin_audit_created_idx on public.admin_audit_log (created_at desc);
create index admin_audit_actor_idx on public.admin_audit_log (actor_id, created_at desc);
create index admin_audit_target_idx on public.admin_audit_log (target_type, target_id, created_at desc);

create function public.admin_audit_log_append_only() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
    raise exception 'admin_audit_log is append-only';
end;
$$;

create trigger admin_audit_log_no_change before update or delete on public.admin_audit_log
    for each row execute function public.admin_audit_log_append_only();
create trigger admin_audit_log_no_truncate before truncate on public.admin_audit_log
    for each statement execute function public.admin_audit_log_append_only();

------------------------------------------------------------------------
-- Security: RLS on, no policy, no browser grants. Only the backend (service role) reads or writes these.
------------------------------------------------------------------------
alter table public.staff_roles           enable row level security;
alter table public.support_tickets       enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.admin_audit_log       enable row level security;

revoke all on public.staff_roles, public.support_tickets, public.support_ticket_events, public.admin_audit_log
    from anon, authenticated;
revoke all on function public.admin_audit_log_append_only() from public, anon, authenticated;

grant all on public.staff_roles, public.support_tickets, public.support_ticket_events, public.admin_audit_log
    to service_role;
grant usage, select on all sequences in schema public to service_role;
