-- Имей Склад: таблица для синхронизации. Выполните один раз в Supabase: SQL Editor -> New query -> Run.

create sequence if not exists records_seq;

create table if not exists public.records (
  shop        text   not null,
  id          text   not null,
  data        jsonb  not null default '{}'::jsonb,
  updated_at  bigint not null default 0,
  deleted     boolean not null default false,
  seq         bigint not null default nextval('records_seq'),
  primary key (shop, id)
);
create index if not exists records_shop_seq on public.records (shop, seq);

-- Серверный номер изменения; более старая правка не затирает более новую.
create or replace function public.records_touch() returns trigger as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return old;
  end if;
  new.seq := nextval('records_seq');
  return new;
end;
$$ language plpgsql;

drop trigger if exists records_touch on public.records;
create trigger records_touch before insert or update on public.records
for each row execute function public.records_touch();

alter table public.records enable row level security;
drop policy if exists records_all on public.records;
create policy records_all on public.records for all to anon using (true) with check (true);
grant usage, select on sequence records_seq to anon;
grant select, insert, update on public.records to anon;
