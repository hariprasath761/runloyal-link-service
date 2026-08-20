#!/usr/bin/env node

import fs from 'node:fs/promises';
import path from 'node:path';

import { query } from '../src/lib/database.js';
import { validateApp } from '../src/store/schema.js';

const state = JSON.parse(await fs.readFile(new URL('../data/apps.json', import.meta.url), 'utf8'));

const migration = await fs.readFile(
    new URL('../supabase/migrations/001_initial.sql', import.meta.url),
    'utf8',
);
await query(migration);

const mimeByExtension = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
};

async function databaseIcon(iconPath) {
    if (!iconPath || iconPath.startsWith('data:')) return iconPath || null;
    const filename = path.basename(iconPath);
    const file = new URL(`../data/uploads/${filename}`, import.meta.url);
    const mime = mimeByExtension[path.extname(filename).toLowerCase()];
    if (!mime) throw new Error(`Unsupported icon extension for ${filename}`);
    const bytes = await fs.readFile(file);
    return `data:${mime};base64,${bytes.toString('base64')}`;
}

await query(
    `insert into app_settings (id, portal_url, updated_at) values (true, $1, now())
   on conflict (id) do update set portal_url = excluded.portal_url, updated_at = now()`,
    [state.portalUrl || ''],
);

for (const input of state.apps || []) {
    const result = validateApp(input);
    if (!result.ok) throw new Error(`${input.slug || '(unknown app)'}: ${result.errors.join('; ')}`);
    const app = result.value;
    app.iconPath = await databaseIcon(app.iconPath);
    await query(
        `insert into apps
      (slug, display_name, tagline, enabled, icon_path, ios, android, behavior,
       open_app_if_installed, portal_url_override, updated_at)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,now())
     on conflict (slug) do update set display_name=excluded.display_name,
       tagline=excluded.tagline, enabled=excluded.enabled, icon_path=excluded.icon_path,
       ios=excluded.ios, android=excluded.android, behavior=excluded.behavior,
       open_app_if_installed=excluded.open_app_if_installed,
       portal_url_override=excluded.portal_url_override, updated_at=now()`,
        [
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
        ],
    );
}

for (const [code, mapping] of Object.entries(state.legacyCodes || {})) {
    await query(
        `insert into legacy_codes (code, slug, path, note) values ($1,$2,$3,$4)
     on conflict (code) do update set slug=excluded.slug, path=excluded.path, note=excluded.note`,
        [code, mapping.slug, mapping.path || '', mapping.note || null],
    );
}

console.log(`Imported ${state.apps?.length || 0} apps and ${Object.keys(state.legacyCodes || {}).length} legacy codes.`);