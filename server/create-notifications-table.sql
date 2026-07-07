create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  title text not null,
  message text not null,
  type text default 'info',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_id_created_at_idx
  on public.notifications (user_id, created_at desc);

create index if not exists notifications_email_created_at_idx
  on public.notifications (email, created_at desc);

create index if not exists notifications_is_read_idx
  on public.notifications (is_read);

alter table public.notifications enable row level security;

drop policy if exists "Users can read own notifications" on public.notifications;
create policy "Users can read own notifications"
on public.notifications
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "Users can update own notifications" on public.notifications;
create policy "Users can update own notifications"
on public.notifications
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);