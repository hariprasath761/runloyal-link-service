import express from 'express';
import multer from 'multer';

import { LINK_HOST } from '../config.js';
import { AuthError, loginAdmin, refreshAdmin, verifyAdmin } from '../lib/adminAuth.js';
import { buildAasa, buildAssetlinks } from './wellKnown.js';
import {
  deleteApp,
  deleteLegacyCode,
  getEnabledApps,
  getApp,
  getState,
  setAppIcon,
  setLegacyCode,
  upsertApp,
} from '../store/appsRepository.js';
import {
  isAasaReady,
  isAssetlinksReady,
  nativeDeepLinkReadiness,
  publishReadiness,
} from '../store/schema.js';

/**
 * Admin API — authenticated app configuration and icon upload.
 */

const router = express.Router();

/* ── Auth ─────────────────────────────────────────────────────────────────── */

async function requireAdmin(req, res, next) {
  const header = String(req.get('authorization') || '');
  const accessToken = header.startsWith('Bearer ') ? header.slice(7) : '';
  try {
    req.admin = await verifyAdmin(accessToken);
    return next();
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
}

router.post('/api/admin/auth/login', express.json(), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await loginAdmin(req.body?.email, req.body?.password));
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

router.post('/api/admin/auth/refresh', express.json(), async (req, res, next) => {
  try {
    res.set('Cache-Control', 'no-store');
    res.json(await refreshAdmin(req.body?.refreshToken));
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    return next(error);
  }
});

/* ── Icon upload ──────────────────────────────────────────────────────────── */

const ALLOWED_MIME = new Map([
  ['image/png', '.png'],
  ['image/jpeg', '.jpg'],
  ['image/webp', '.webp'],
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new Error(`unsupported type ${file.mimetype} — use PNG, JPEG or WebP`));
    }
    return cb(null, true);
  },
});

/* ── Reads ────────────────────────────────────────────────────────────────── */

router.get('/api/admin/config', requireAdmin, async (req, res, next) => {
  try {
    const state = await getState();
    res.json({
      linkHost: LINK_HOST,
      admin: req.admin,
      apps: state.apps.map((app) => ({
        ...app,
        // Surfaced so the admin can see at a glance why an app is missing from a
        // well-known file, instead of discovering it via a device that will not
        // verify.
        readiness: {
          aasa: isAasaReady(app),
          assetlinks: isAssetlinksReady(app),
          publish: publishReadiness(app),
          native: nativeDeepLinkReadiness(app),
        },
        linkUrl: `https://${LINK_HOST}/app/${app.slug}`,
      })),
      legacyCodes: state.legacyCodes,
    });
  } catch (err) { next(err); }
});

/**
 * Live view of exactly what the two well-known files currently contain, plus
 * the AASA size against Apple's 128 KB hard limit.
 */
router.get('/api/admin/wellknown', requireAdmin, async (req, res, next) => {
  try {
    const apps = await getEnabledApps();
    const aasa = buildAasa(apps);
    const assetlinks = buildAssetlinks(apps);
    const aasaBytes = Buffer.byteLength(JSON.stringify(aasa), 'utf8');

    res.json({
      aasa,
      assetlinks,
      aasaBytes,
      aasaLimitBytes: 128 * 1024,
      aasaWarnBytes: 100 * 1024,
      // Apple's limit is on the served file. At ~170 bytes per minified entry
      // this is nowhere near a problem at 2 apps, but the number is surfaced now
      // so the 300-tenant migration inherits the check rather than discovering it.
      aasaOverWarn: aasaBytes > 100 * 1024,
    });
  } catch (err) { next(err); }
});

/* ── Writes ───────────────────────────────────────────────────────────────── */

router.post('/api/admin/apps', requireAdmin, express.json(), async (req, res) => {
  const result = await upsertApp(req.body, { isNew: true });
  if (!result.ok) return res.status(400).json({ errors: result.errors });
  res.status(201).json(result.value);
});

router.put('/api/admin/apps/:slug', requireAdmin, express.json(), async (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!(await getApp(slug))) return res.status(404).json({ error: 'unknown app' });

  // The slug is the path prefix baked into shipped binaries. Changing it would
  // silently break every installed copy of the app, so it is taken from the URL
  // and any slug in the body is ignored.
  const result = await upsertApp({ ...req.body, slug }, { isNew: false });
  if (!result.ok) return res.status(400).json({ errors: result.errors });
  res.json(result.value);
});

router.delete('/api/admin/apps/:slug', requireAdmin, async (req, res) => {
  const removed = await deleteApp(req.params.slug);
  if (!removed) return res.status(404).json({ error: 'unknown app' });
  res.status(204).end();
});

router.post(
  '/api/admin/apps/:slug/icon',
  requireAdmin,
  upload.single('icon'),
  async (req, res) => {
    const slug = String(req.params.slug || '').toLowerCase();
    const app = await getApp(slug);
    if (!app) return res.status(404).json({ error: 'unknown app' });
    if (!req.file) return res.status(400).json({ error: 'no file uploaded (field name: icon)' });

    // Store the image in Supabase as a self-contained data URI. No local path
    // or filesystem write is used, so this works across Vercel instances.
    const iconPath = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
    await setAppIcon(slug, iconPath);

    res.json({ slug, iconPath });
  },
);

router.put('/api/admin/legacy/:code', requireAdmin, express.json(), async (req, res) => {
  const slug = String(req.body?.slug || '').toLowerCase();
  if (!(await getApp(slug))) return res.status(400).json({ error: 'slug must reference a known app' });

  await setLegacyCode(req.params.code, {
    slug,
    path: String(req.body?.path || '').replace(/^\/+/, ''),
    note: req.body?.note ? String(req.body.note) : undefined,
  });
  res.json({ code: req.params.code, slug });
});

router.delete('/api/admin/legacy/:code', requireAdmin, async (req, res) => {
  const removed = await deleteLegacyCode(req.params.code);
  if (!removed) return res.status(404).json({ error: 'unknown code' });
  res.status(204).end();
});

/* ── Multer error shaping ─────────────────────────────────────────────────── */

router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'icon must be 512 KB or smaller' : err.message;
    return res.status(400).json({ error: message });
  }
  if (err && /unsupported type/.test(err.message || '')) {
    return res.status(400).json({ error: err.message });
  }
  return next(err);
});

export default router;
