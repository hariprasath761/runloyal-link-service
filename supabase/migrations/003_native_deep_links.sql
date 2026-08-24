alter table public.apps
  add column if not exists native_deep_link_enabled boolean not null default false;

-- open_app_if_installed is the rollback record for the former experimental
-- browser probe. It is intentionally retained and intentionally not copied:
-- every app must explicitly opt into the production OS association flow.
