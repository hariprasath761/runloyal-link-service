import path from 'node:path';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

dotenv.config();

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root — one level above src/. */
export const ROOT = path.resolve(here, '..');

export const PORT = Number(process.env.PORT || 3000);

/**
 * The public hostname. Used for three separate things that must all agree:
 *   1. the `host` in each Android intent-filter,
 *   2. the `applinks:` entitlement on iOS,
 *   3. the absolute URL the interstitial's QR code encodes.
 *
 * A mismatch in any one of them fails silently, so it is read from a single
 * place and echoed at boot.
 */
export const LINK_HOST = process.env.LINK_HOST || 'link-poc.example.com';

export const SUPABASE_DB_HOST = process.env.SUPABASE_DB_HOST || '';
export const SUPABASE_DB_PORT = Number(process.env.SUPABASE_DB_PORT || 5432);
export const SUPABASE_DB_NAME = process.env.SUPABASE_DB_NAME || 'postgres';
export const SUPABASE_DB_USER = process.env.SUPABASE_DB_USER || 'postgres';
export const SUPABASE_DB_PASSWORD = process.env.SUPABASE_DB_PASSWORD || '';

export const SUPABASE_URL = process.env.SUPABASE_URL || '';
export const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
export const ADMIN_EMAILS = process.env.ADMIN_EMAILS || '';

export const VIEWS_DIR = path.join(ROOT, 'src', 'views');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const ADMIN_DIST_DIR = path.join(ROOT, 'admin-dist');

/**
 * Public base URL for a request. Vercel and other proxies provide the original
 * host through X-Forwarded-Host; LINK_HOST remains the build-time fallback for
 * static pages and scripts that have no request context.
 */
export const publicBaseUrl = (req) => {
    const forwardedHost = String(req?.get?.('x-forwarded-host') || '').split(',')[0].trim();
    const requestHost = forwardedHost || String(req?.get?.('host') || '').trim();
    const host = requestHost || LINK_HOST;
    return `https://${host}`;
};
