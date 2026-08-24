import { query } from '../lib/database.js';
import { validateApp } from './schema.js';

function normalizeApps(entries) {
    const apps = [];
    for (const entry of entries) {
        const result = validateApp({
            ...entry,
            enabled: entry.enabled === undefined ? true : entry.enabled,
        });
        if (!result.ok) {
            console.error(
                `[appsRepository] skipping invalid app "${entry?.slug ?? '(no slug)'}": ` +
                result.errors.join('; '),
            );
            continue;
        }
        apps.push(result.value);
    }
    return apps;
}

function rowToApp(row) {
    return normalizeApps([{
        slug: row.slug,
        displayName: row.display_name,
        tagline: row.tagline,
        enabled: row.enabled,
        iconPath: row.icon_path,
        ios: row.ios,
        android: row.android,
        behavior: row.behavior,
        nativeDeepLinkEnabled: row.native_deep_link_enabled,
        web: {
            url: row.web_url,
            showLink: row.web_show_link,
            redirectDesktop: row.web_redirect_desktop,
        },
    }])[0];
}

function appToRow(app) {
    return [
        app.slug,
        app.displayName,
        app.tagline,
        app.enabled,
        app.iconPath,
        JSON.stringify(app.ios),
        JSON.stringify(app.android),
        JSON.stringify(app.behavior),
        app.nativeDeepLinkEnabled,
        app.web.url,
        app.web.showLink,
        app.web.redirectDesktop,
    ];
}

async function readDatabase() {
    const [apps, codes] = await Promise.all([
        query('select * from apps order by slug'),
        query('select code, slug, path, note from legacy_codes order by code'),
    ]);
    return {
        apps: apps.rows.map(rowToApp).filter(Boolean),
        legacyCodes: Object.fromEntries(
            codes.rows.map((row) => [row.code, { slug: row.slug, path: row.path, note: row.note }]),
        ),
    };
}

// Supabase is the only runtime source of truth. A missing database configuration
// is an operational error instead of silently switching to a local JSON copy.
export const getState = () => readDatabase();

export const getApps = async () => (await getState()).apps;
export const getApp = async (slug) =>
    (await getApps()).find((app) => app.slug === String(slug || '').toLowerCase()) || null;
export const getEnabledApps = async () => (await getApps()).filter((app) => app.enabled);
export const getLegacyCode = async (code) =>
    (await getState()).legacyCodes[String(code || '')] || null;

export async function upsertApp(input, { isNew = false } = {}) {
    const state = await getState();
    const result = validateApp(input, {
        existingSlugs: state.apps.map((app) => app.slug),
        isNew,
    });
    if (!result.ok) return result;

    const existing = state.apps.find((app) => app.slug === result.value.slug);
    if (!result.value.iconPath && existing?.iconPath) {
        result.value.iconPath = existing.iconPath;
    }

    await query(
        `insert into apps
      (slug, display_name, tagline, enabled, icon_path, ios, android, behavior,
       native_deep_link_enabled, web_url, web_show_link, web_redirect_desktop, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,$11,$12,now())
     on conflict (slug) do update set
       display_name=excluded.display_name, tagline=excluded.tagline,
       enabled=excluded.enabled, icon_path=excluded.icon_path, ios=excluded.ios,
       android=excluded.android, behavior=excluded.behavior,
       native_deep_link_enabled=excluded.native_deep_link_enabled,
       web_url=excluded.web_url, web_show_link=excluded.web_show_link,
       web_redirect_desktop=excluded.web_redirect_desktop, updated_at=now()`,
        appToRow(result.value),
    );
    return { ok: true, value: result.value };
}

export async function deleteApp(slug) {
    const result = await query('delete from apps where slug = $1', [String(slug || '').toLowerCase()]);
    return result.rowCount > 0;
}

export async function setAppIcon(slug, iconPath) {
    const result = await query(
        'update apps set icon_path = $1, updated_at = now() where slug = $2',
        [iconPath, String(slug || '').toLowerCase()],
    );
    return result.rowCount > 0;
}

export async function setLegacyCode(code, mapping) {
    await query(
        `insert into legacy_codes (code, slug, path, note) values ($1,$2,$3,$4)
     on conflict (code) do update set slug=excluded.slug, path=excluded.path, note=excluded.note`,
        [String(code || '').trim(), mapping.slug, mapping.path || '', mapping.note || null],
    );
    return true;
}

export async function deleteLegacyCode(code) {
    const result = await query('delete from legacy_codes where code = $1', [String(code || '').trim()]);
    return result.rowCount > 0;
}

// Kept as a harmless compatibility export for callers that previously cleared
// the JSON cache. Supabase reads are intentionally fresh on every request.
export const invalidate = () => {};
