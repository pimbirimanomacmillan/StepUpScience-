-- StepUp Science minimal backend schema
-- Run in Supabase SQL editor, then create a private storage bucket named: protected-content

create extension if not exists pgcrypto;

create or replace function public.tier_rank(t text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(t, 'free'))
    when 'tier 2' then 2
    when 'tier 1' then 1
    else 0
  end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  phone text,
  role text not null default 'student' check (role in ('student', 'admin')),
  access_tier text not null default 'Free' check (access_tier in ('Free', 'Tier 1', 'Tier 2')),
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.modules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  subject text not null check (subject in ('Physics', 'Chemistry')),
  description text default '',
  required_tier text not null default 'Free' check (required_tier in ('Free', 'Tier 1', 'Tier 2')),
  kind text not null default 'pdf' check (kind in ('pdf', 'video', 'image')),
  file_path text,
  public_url text,
  is_published boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.bookings (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  student_name text not null,
  subject_focus text not null,
  requested_date date not null,
  requested_time text not null,
  notes text default '',
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  created_at timestamptz not null default now()
);

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.profiles(id) on delete set null,
  student_name text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'reviewed', 'implemented')),
  created_at timestamptz not null default now()
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  student_name text,
  student_email text,
  phone text,
  plan_code text not null,
  tier text not null check (tier in ('Tier 1', 'Tier 2')),
  amount numeric(10,2) not null,
  status text not null default 'pending',
  paynow_ref text unique not null,
  poll_url text,
  activated_at timestamptz,
  raw_callback jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.quiz_results (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  subject text,
  topic text,
  score numeric(10,2) not null,
  total numeric(10,2) not null,
  taken_at timestamptz not null default now()
);

create or replace function public.current_user_is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

create or replace function public.current_user_has_tier(required_tier text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and coalesce(p.access_expires_at, now() + interval '100 years') > now()
      and public.tier_rank(p.access_tier) >= public.tier_rank(required_tier)
  );
$$;

alter table public.profiles enable row level security;
alter table public.modules enable row level security;
alter table public.bookings enable row level security;
alter table public.suggestions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.quiz_results enable row level security;

-- profiles
create policy "users read own profile" on public.profiles
for select using (auth.uid() = id or public.current_user_is_admin());

create policy "users update own profile" on public.profiles
for update using (auth.uid() = id or public.current_user_is_admin())
with check (auth.uid() = id or public.current_user_is_admin());

create policy "users insert own profile" on public.profiles
for insert with check (auth.uid() = id or public.current_user_is_admin());

-- modules: free modules visible to anyone; paid modules only to eligible signed-in users; admins full access
create policy "read published free modules" on public.modules
for select using (is_published = true and required_tier = 'Free');

create policy "read paid modules if tier matches" on public.modules
for select using (is_published = true and public.current_user_has_tier(required_tier));

create policy "admin manage modules" on public.modules
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- bookings
create policy "students create bookings" on public.bookings
for insert with check (auth.uid() = student_id or student_id is null);

create policy "students read own bookings" on public.bookings
for select using (public.current_user_is_admin() or auth.uid() = student_id);

create policy "admin manage bookings" on public.bookings
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- suggestions
create policy "students create suggestions" on public.suggestions
for insert with check (auth.uid() = student_id or student_id is null);

create policy "students read own suggestions" on public.suggestions
for select using (public.current_user_is_admin() or auth.uid() = student_id);

create policy "admin manage suggestions" on public.suggestions
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- subscriptions
create policy "students read own subscriptions" on public.subscriptions
for select using (public.current_user_is_admin() or auth.uid() = student_id);

create policy "admin manage subscriptions" on public.subscriptions
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- quiz results
create policy "students read own quiz results" on public.quiz_results
for select using (public.current_user_is_admin() or auth.uid() = student_id);

create policy "students insert own quiz results" on public.quiz_results
for insert with check (auth.uid() = student_id or public.current_user_is_admin());

create policy "admin manage quiz results" on public.quiz_results
for all using (public.current_user_is_admin()) with check (public.current_user_is_admin());

-- IMPORTANT STORAGE NOTE:
-- Put paid PDFs/videos in the private bucket `protected-content`.
-- Client-side no-download prevention is never perfect.
-- Use signed URLs + private bucket + RLS to enforce entitlement; do not hardcode file URLs in HTML.
