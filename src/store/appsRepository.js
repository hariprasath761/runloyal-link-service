import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { APPS_FILE, DATA_DIR, UPLOADS_DIR } from '../config.js';
import { databaseEnabled, query } from '../lib/database.js';
import { validateApp } from './schema.js';

let cache = null;
const emptyState = () => ({ portalUrl: '', apps: [], legacyCodes: {} });

function normalizeState(raw) {
    const apps = [];
    for (const entry of raw.apps || []) {
        const result = validateApp(entry);
        if (!result.ok) {
            console.error(`[appsRepository] skipping invalid app "${entry?.slug ?? '(no slug)'}": ${result.errors.join('; ')}`);
            continue;
        }
        apps.push(result.value);
    }
    return { portalUrl: raw.portalUrl || '', apps, legacyCodes: raw.legacyCodes || {} };
}

function rowToApp(row) {
    return normalizeState({
        apps: [{
            slug: row.slug,
            displayName: row.display_name,
            tagline: row.tagline,
            enabled: row.enabled,
            iconPath: row.icon_path,
            ios: row.ios,
            android: row.android,
            behavior: row.behavior,
            openAppIfInstalled: row.open_app_if_installed,
            portalUrlOverride: row.portal_url_override,
        }],
    }).apps[0];
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
        app.openAppIfInstalled,
        app.portalUrlOverride,
    ];
}

function readRaw() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    if (!fs.existsSync(APPS_FILE)) return emptyState();
    try {
        const parsed = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
        return {
            portalUrl: parsed.portalUrl || '',
            apps: Array.isArray(parsed.apps) ? parsed.apps : [],
            legacyCodes: parsed.legacyCodes || {},
        };
    } catch (err) {
        console.error(`[appsRepository] ${APPS_FILE} is not valid JSON`, err);
        return emptyState();
    }
}

async function readDatabase() {
    const [settings, apps, codes] = await Promise.all([
        query('select portal_url from app_settings where id = true'),
        query('select * from apps order by slug'),
        query('select code, slug, path, note from legacy_codes order by code'),
    ]);
    return {
        portalUrl: settings.rows[0]?.portal_url || '',
        apps: apps.rows.map(rowToApp).filter(Boolean),
        legacyCodes: Object.fromEntries(
            codes.rows.map((row) => [row.code, { slug: row.slug, path: row.path, note: row.note }]),
        ),
    };
}

export async function getState() {
    if (databaseEnabled) return readDatabase();
    if (cache) return cache;
    cache = normalizeState(readRaw());
    return cache;
}

export const getApps = async () => (await getState()).apps;
export const getApp = async (slug) =>
    (await getApps()).find((app) => app.slug === String(slug || '').toLowerCase()) || null;
export const getEnabledApps = async () => (await getApps()).filter((app) => app.enabled);
export const getLegacyCode = async (code) =>
    (await getState()).legacyCodes[String(code || '')] || null;
export const portalUrlFor = async (app) =>
    app?.portalUrlOverride || (await getState()).portalUrl || null;

async function writeState(next) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = path.join(DATA_DIR, `.apps.json.${process.pid}.tmp`);
    await fsp.writeFile(tmp, JSON.stringify(next, null, 2) + '\n', 'utf8');
    await fsp.rename(tmp, APPS_FILE);
    cache = null;
}

export async function updateSettings({ portalUrl }) {
    if (databaseEnabled) {
        await query(
            'update app_settings set portal_url = $1, updated_at = now() where id = true',
            [String(portalUrl || '').trim()],
        );
        return getState();
    }
    const state = readRaw();
    if (portalUrl !== undefined) state.portalUrl = String(portalUrl || '').trim();
    await writeState(state);
    return getState();
}

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

    if (databaseEnabled) {
        await query(
            `insert into apps
        (slug, display_name, tagline, enabled, icon_path, ios, android, behavior,
         open_app_if_installed, portal_url_override, updated_at)
       values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,now())
       on conflict (slug) do update set
         display_name=excluded.display_name, tagline=excluded.tagline,
         enabled=excluded.enabled, icon_path=excluded.icon_path, ios=excluded.ios,
         android=excluded.android, behavior=excluded.behavior,
         open_app_if_installed=excluded.open_app_if_installed,
         portal_url_override=excluded.portal_url_override, updated_at=now()`,
            appToRow(result.value),
        );
    } else {
        const raw = readRaw();
        const index = raw.apps.findIndex(
            (app) => String(app.slug || '').toLowerCase() === result.value.slug,
        );
        if (index >= 0) raw.apps[index] = result.value;
        else raw.apps.push(result.value);
        await writeState(raw);
    }
    return { ok: true, value: result.value };
}

export async function deleteApp(slug) {
    const target = String(slug || '').toLowerCase();
    if (databaseEnabled) {
        const result = await query('delete from apps where slug = $1', [target]);
        return result.rowCount > 0;
    }
    const state = readRaw();
    const before = state.apps.length;
    state.apps = state.apps.filter(
        (app) => String(app.slug || '').toLowerCase() !== target,
    );
    if (state.apps.length === before) return false;
    await writeState(state);
    return true;
}

export async function setAppIcon(slug, iconPath) {
    const target = String(slug || '').toLowerCase();
    if (databaseEnabled) {
        const result = await query(
            'update apps set icon_path = $1, updated_at = now() where slug = $2',
            [iconPath, target],
        );
        return result.rowCount > 0;
    }
    const state = readRaw();
    const app = state.apps.find((entry) => String(entry.slug).toLowerCase() === target);
    if (!app) return false;
    app.iconPath = iconPath;
    await writeState(state);
    return true;
}

export async function setLegacyCode(code, mapping) {
    const key = String(code || '').trim();
    if (databaseEnabled) {
        await query(
            `insert into legacy_codes (code, slug, path, note) values ($1,$2,$3,$4)
       on conflict (code) do update set slug=excluded.slug, path=excluded.path, note=excluded.note`,
            [key, mapping.slug, mapping.path || '', mapping.note || null],
        );
        return true;
    }
    const state = readRaw();
    state.legacyCodes[key] = mapping;
    await writeState(state);
    return true;
}

export async function deleteLegacyCode(code) {
    const key = String(code || '').trim();
    if (databaseEnabled) {
        const result = await query('delete from legacy_codes where code = $1', [key]);
        return result.rowCount > 0;
    }
    const state = readRaw();
    if (!(key in state.legacyCodes)) return false;
    delete state.legacyCodes[key];
    await writeState(state);
    return true;
}

export const invalidate = () => {
    cache = null;
};