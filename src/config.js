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

export const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

export const DATA_DIR = path.isAbsolute(process.env.DATA_DIR || '')
  ? process.env.DATA_DIR
  : path.join(ROOT, process.env.DATA_DIR || 'data');

export const APPS_FILE = path.join(DATA_DIR, 'apps.json');
export const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');

export const VIEWS_DIR = path.join(ROOT, 'src', 'views');
export const PUBLIC_DIR = path.join(ROOT, 'public');
export const ADMIN_DIST_DIR = path.join(ROOT, 'admin-dist');

/**
 * Absolute public base URL. Always https — Universal Links and App Links both
 * refuse to verify over http, so there is no scheme to configure.
 */
export const publicBaseUrl = () => `https://${LINK_HOST}`;
