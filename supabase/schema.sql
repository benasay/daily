-- Tally cloud sync: run once in the Supabase SQL Editor.
-- One row per saved item: each day ("day:2026-11-11") and each month's goal list ("month:2026-11").
create table public.tally_items (
  user_id    uuid        not null default auth.uid() references auth.users on delete cascade,
  key        text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- Each signed-in person can only see and change their own rows.
alter table public.tally_items enable row level security;

create policy "read own"   on public.tally_items for select using (auth.uid() = user_id);
create policy "insert own" on public.tally_items for insert with check (auth.uid() = user_id);
create policy "update own" on public.tally_items for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "delete own" on public.tally_items for delete using (auth.uid() = user_id);
