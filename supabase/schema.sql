create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_type text not null check (event_type in ('gesture', 'object', 'movement')),
  description text not null check (char_length(description) between 1 and 200),
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);

alter table public.activity_events enable row level security;

revoke all on public.activity_events from anon;
grant select, insert on public.activity_events to authenticated;

drop policy if exists "Users can read their own activity" on public.activity_events;
create policy "Users can read their own activity"
  on public.activity_events for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can add their own activity" on public.activity_events;
create policy "Users can add their own activity"
  on public.activity_events for insert to authenticated
  with check ((select auth.uid()) = user_id);
