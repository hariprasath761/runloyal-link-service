create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  portal_url text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.apps (
  slug text primary key,
  display_name text not null,
  tagline text not null default 'Scan to download the app',
  enabled boolean not null default true,
  icon_path text,
  ios jsonb not null default '{}'::jsonb,
  android jsonb not null default '{}'::jsonb,
  behavior jsonb not null default '{"ios":"interstitial","android":"interstitial","desktop":"interstitial"}'::jsonb,
  open_app_if_installed boolean not null default false,
  portal_url_override text,
  updated_at timestamptz not null default now()
);

create table if not exists public.legacy_codes (
  code text primary key,
  slug text not null references public.apps(slug) on update cascade on delete cascade,
  path text not null default '',
  note text
);

create index if not exists apps_enabled_idx on public.apps (enabled);