import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { APPS_FILE, DATA_DIR, UPLOADS_DIR } from '../config.js';
import { validateApp } from './schema.js';

/**
 * The single source of truth for tenant config, backed by `data/apps.json`.
 *
 * Reads are served from an in-process cache because the `.well-known` routes
 * hit this on every request and Apple's CDN can be bursty. The cache is
 * invalidated on write, and writes are atomic (write to a temp file in the same
 * directory, then rename) so a crash mid-write cannot leave a truncated
 * apps.json — which would take deep linking down for every app at once.
 */

let cache = null;

const emptyState = () => ({ portalUrl: '', apps: [], legacyCodes: {} });

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function readRaw() {
  ensureDirs();
  if (!fs.existsSync(APPS_FILE)) return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(APPS_FILE, 'utf8'));
    return {
      portalUrl: parsed.portalUrl || '',
      apps: Array.isArray(parsed.apps) ? parsed.apps : [],
      legacyCodes:
        parsed.legacyCodes && typeof parsed.legacyCodes === 'object' ? parsed.legacyCodes : {},
    };
  } catch (err) {
    // Refusing to start on a corrupt file is worse than serving the last good
    // shape: a parse error here would otherwise 500 the well-known routes and
    // un-verify every installed app. Log loudly and serve empty.
    console.error(`[appsRepository] ${APPS_FILE} is not valid JSON — serving empty config`, err);
    return emptyState();
  }
}

/** Full config object, normalised through the schema. */
export function getState() {
  if (cache) return cache;

  const raw = readRaw();
  const apps = [];
  for (const entry of raw.apps) {
    const result = validateApp(entry);
    if (!result.ok) {
      console.error(
        `[appsRepository] skipping invalid app "${entry?.slug ?? '(no slug)'}": ${result.errors.join('; ')}`,
      );
      continue;
    }
    apps.push(result.value);
  }

  cache = { portalUrl: raw.portalUrl, apps, legacyCodes: raw.legacyCodes };
  return cache;
}

export const getApps = () => getState().apps;

export const getApp = (slug) =>
  getApps().find((a) => a.slug === String(slug || '').toLowerCase()) || null;

/** Enabled apps only — what the `.well-known` generators iterate. */
export const getEnabledApps = () => getApps().filter((a) => a.enabled);

export const getLegacyCode = (code) => getState().legacyCodes[String(code || '')] || null;

/** Portal URL for an app, falling back to the global default. */
export const portalUrlFor = (app) => app?.portalUrlOverride || getState().portalUrl || null;

async function writeState(next) {
  ensureDirs();
  const tmp = path.join(DATA_DIR, `.apps.json.${process.pid}.tmp`);
  const payload = JSON.stringify(next, null, 2) + '\n';
  await fsp.writeFile(tmp, payload, 'utf8');
  await fsp.rename(tmp, APPS_FILE);
  cache = null;
}

/** Replaces global settings (portal URL). */
export async function updateSettings({ portalUrl }) {
  const state = readRaw();
  if (portalUrl !== undefined) state.portalUrl = String(portalUrl || '').trim();
  await writeState(state);
  return getState();
}

/**
 * Creates or replaces an app by slug.
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export async function upsertApp(input, { isNew = false } = {}) {
  const state = readRaw();
  const existingSlugs = state.apps.map((a) => String(a.slug || '').toLowerCase());
  const result = validateApp(input, { existingSlugs, isNew });
  if (!result.ok) return result;

  const index = existingSlugs.indexOf(result.value.slug);
  if (index >= 0) {
    // Preserve an already-uploaded icon when the caller did not send one —
    // the admin form posts identity fields without re-uploading the image.
    if (!result.value.iconPath && state.apps[index].iconPath) {
      result.value.iconPath = state.apps[index].iconPath;
    }
    state.apps[index] = result.value;
  } else {
    state.apps.push(result.value);
  }

  await writeState(state);
  return { ok: true, value: result.value };
}

export async function deleteApp(slug) {
  const state = readRaw();
  const target = String(slug || '').toLowerCase();
  const before = state.apps.length;
  state.apps = state.apps.filter((a) => String(a.slug || '').toLowerCase() !== target);
  if (state.apps.length === before) return false;
  await writeState(state);
  return true;
}

/** Points an app at a newly uploaded icon. */
export async function setAppIcon(slug, iconPath) {
  const state = readRaw();
  const target = String(slug || '').toLowerCase();
  const entry = state.apps.find((a) => String(a.slug || '').toLowerCase() === target);
  if (!entry) return false;
  entry.iconPath = iconPath;
  await writeState(state);
  return true;
}

export async function setLegacyCode(code, mapping) {
  const state = readRaw();
  const key = String(code || '').trim();
  if (!key) return false;
  state.legacyCodes[key] = mapping;
  await writeState(state);
  return true;
}

export async function deleteLegacyCode(code) {
  const state = readRaw();
  const key = String(code || '').trim();
  if (!(key in state.legacyCodes)) return false;
  delete state.legacyCodes[key];
  await writeState(state);
  return true;
}

/** Test/dev hook — drops the cache so the next read re-parses from disk. */
export const invalidate = () => {
  cache = null;
};
