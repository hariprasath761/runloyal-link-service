-- Mobile web requests are deterministic: if the OS did not open an installed
-- app, the service sends the visitor to that platform's store. Keep the JSON
-- column for rollback compatibility while retiring its old choices.
update public.apps
set behavior = jsonb_build_object('ios', 'storeDirect', 'android', 'storeDirect'),
    updated_at = now()
where behavior is distinct from jsonb_build_object('ios', 'storeDirect', 'android', 'storeDirect');
