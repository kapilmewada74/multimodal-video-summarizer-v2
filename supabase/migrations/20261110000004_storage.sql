-- Private bucket for uploaded media. Only the backend (service role) writes
-- and reads it; the browser never gets direct access.
do $$
begin
    if to_regclass('storage.buckets') is not null then
        insert into storage.buckets (id, name, public)
        values ('uploads', 'uploads', false)
        on conflict (id) do nothing;
    end if;
end;
$$;
