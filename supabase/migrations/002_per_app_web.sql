alter table public.apps
  add column if not exists web_url text,
  add column if not exists web_show_link boolean not null default false,
  add column if not exists web_redirect_desktop boolean not null default false;

-- The former global portal and per-app override columns are intentionally left
-- in place for rollback, but are not copied. Every app opts into its own web
-- experience explicitly after this migration.

-- Old portal choices cannot be honoured without copying the retired common
-- URL, so safely return them to the landing page.
update public.apps
set behavior = jsonb_set(coalesce(behavior, '{}'::jsonb), '{ios}', '"interstitial"'::jsonb),
    updated_at = now()
where web_url is null and behavior->>'ios' = 'portal';

update public.apps
set behavior = jsonb_set(coalesce(behavior, '{}'::jsonb), '{android}', '"interstitial"'::jsonb),
    updated_at = now()
where web_url is null and behavior->>'android' = 'portal';

-- Desktop is no longer part of the mobile behavior matrix.
update public.apps
set behavior = coalesce(behavior, '{}'::jsonb) - 'desktop',
    updated_at = now();
