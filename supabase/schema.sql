-- JMOBETS free-play accounts, token balances, picks and owner moderation.
-- Apply to a dedicated Supabase project. Never expose any service-role/secret key.
create schema if not exists private;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  role text not null default 'user' check (role in ('user','admin')),
  account_status text not null default 'active' check (account_status in ('active','suspended','banned')),
  balance integer not null default 1000 check (balance >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.demo_markets (
  id text primary key,
  sport text not null check (sport in ('NFL','NBA','EPL')),
  away text not null,
  home text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array'),
  is_open boolean not null default true
);

create table if not exists public.demo_picks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  market_id text not null references public.demo_markets(id),
  selection text not null,
  decimal_odds numeric(8,3) not null check (decimal_odds > 1),
  stake integer not null check (stake between 1 and 1000),
  status text not null default 'pending' check (status in ('pending','won','lost','void')),
  created_at timestamptz not null default now()
);
create index if not exists demo_picks_user_date_idx on public.demo_picks(user_id, created_at desc);

create table if not exists public.signup_attempts (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  created_at timestamptz not null default now()
);
create index if not exists signup_attempts_fingerprint_date_idx on public.signup_attempts(fingerprint,created_at desc);
alter table public.signup_attempts enable row level security;
revoke all on public.signup_attempts from public, anon, authenticated;

create table if not exists private.moderation_audit (
  id bigint generated always as identity primary key,
  admin_id uuid not null references auth.users(id),
  target_id uuid not null references auth.users(id),
  action text not null,
  created_at timestamptz not null default now()
);

create or replace function private.new_account_profile()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare handle text;
begin
  handle := lower(new.raw_user_meta_data->>'username');
  if handle is null or handle !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Valid username required';
  end if;
  insert into public.profiles(id, username) values (new.id, handle);
  return new;
end;
$$;
drop trigger if exists jmo_on_auth_user_created on auth.users;
create trigger jmo_on_auth_user_created
  after insert on auth.users for each row execute function private.new_account_profile();

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and account_status = 'active'
  );
$$;

alter table public.profiles enable row level security;
alter table public.demo_markets enable row level security;
alter table public.demo_picks enable row level security;
alter table private.moderation_audit enable row level security;

drop policy if exists "profiles_self_or_admin" on public.profiles;
create policy "profiles_self_or_admin" on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));

drop policy if exists "markets_public_read" on public.demo_markets;
create policy "markets_public_read" on public.demo_markets for select to anon, authenticated using (true);

drop policy if exists "picks_owner_or_admin" on public.demo_picks;
create policy "picks_owner_or_admin" on public.demo_picks for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

-- Clients cannot insert or update profiles or picks directly. The following RPC handles
-- balance deductions atomically and always uses server-owned market prices.
create or replace function public.place_demo_pick(
  p_market_id text, p_selection text, p_stake integer
) returns uuid language plpgsql security definer set search_path = ''
as $$
declare price numeric(8,3);
declare created_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_stake is null or p_stake < 1 or p_stake > 1000 then
    raise exception 'Stake must be between 1 and 1000';
  end if;
  select (option ->> 'odds')::numeric into price
  from public.demo_markets m, jsonb_array_elements(m.options) as option
  where m.id = p_market_id and m.is_open and option ->> 'label' = p_selection
  limit 1;
  if price is null or price <= 1 then raise exception 'Invalid or closed demo market'; end if;
  update public.profiles set balance = balance - p_stake
  where id = auth.uid() and account_status = 'active' and balance >= p_stake;
  if not found then raise exception 'Account inactive or insufficient JMOT'; end if;
  insert into public.demo_picks(user_id, market_id, selection, decimal_odds, stake)
  values(auth.uid(), p_market_id, p_selection, price, p_stake)
  returning id into created_id;
  return created_id;
end;
$$;

-- Admin-only action. All changes are logged. Admins cannot disable or modify other admins.
create or replace function public.admin_set_account_status(
  p_user_id uuid, p_status text
) returns void language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admin privileges required'; end if;
  if p_user_id is null or p_user_id = auth.uid() then
    raise exception 'Cannot moderate this account';
  end if;
  if p_status not in ('active','suspended','banned') then
    raise exception 'Invalid account status';
  end if;
  update public.profiles set account_status = p_status
    where id = p_user_id and role = 'user';
  if not found then raise exception 'Account not found or protected'; end if;
  insert into private.moderation_audit(admin_id, target_id, action)
  values(auth.uid(), p_user_id, p_status);
end;
$$;

revoke all on function private.is_admin() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_admin() to authenticated;
revoke all on function public.place_demo_pick(text,text,integer) from public, anon;
revoke all on function public.admin_set_account_status(uuid,text) from public, anon;
grant execute on function public.place_demo_pick(text,text,integer) to authenticated;
grant execute on function public.admin_set_account_status(uuid,text) to authenticated;

revoke all on public.profiles, public.demo_picks, public.demo_markets from anon, authenticated;
grant select on public.demo_markets to anon, authenticated;
grant select on public.profiles, public.demo_picks to authenticated;

-- Fixed illustrative markets. These are NOT live events or actual bookmaker lines.
insert into public.demo_markets(id,sport,away,home,options) values
('n1','NFL','Buffalo Bills','Kansas City Chiefs','[{"label":"Bills","odds":1.94},{"label":"Chiefs","odds":1.89}]'),
('n2','NFL','Baltimore Ravens','Cincinnati Bengals','[{"label":"Ravens","odds":1.76},{"label":"Bengals","odds":2.15}]'),
('b1','NBA','New York Knicks','Boston Celtics','[{"label":"Knicks","odds":2.25},{"label":"Celtics","odds":1.70}]'),
('b2','NBA','Los Angeles Lakers','Golden State Warriors','[{"label":"Lakers","odds":1.92},{"label":"Warriors","odds":1.93}]'),
('e1','EPL','Arsenal','Chelsea','[{"label":"Arsenal","odds":2.05},{"label":"Draw","odds":3.40},{"label":"Chelsea","odds":3.65}]'),
('e2','EPL','Liverpool','Manchester City','[{"label":"Liverpool","odds":2.65},{"label":"Draw","odds":3.50},{"label":"Man City","odds":2.48}]')
on conflict (id) do update set options=excluded.options, away=excluded.away, home=excluded.home;
