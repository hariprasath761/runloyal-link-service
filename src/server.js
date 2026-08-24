import fs from 'node:fs';

import express from 'express';

import {
  ADMIN_DIST_DIR,
  ADMIN_EMAILS,
  APPS_FILE,
  LINK_HOST,
  PORT,
  PUBLIC_DIR,
  UPLOADS_DIR,
  VIEWS_DIR,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
} from './config.js';
import adminApi from './routes/adminApi.js';
import deepLink from './routes/deepLink.js';
import deeplinkApi from './routes/deeplinkApi.js';
import legacy from './routes/legacy.js';
import wellKnown from './routes/wellKnown.js';
import { buildAasa, buildAssetlinks } from './routes/wellKnown.js';
import { getEnabledApps } from './store/appsRepository.js';

const app = express();

app.set('view engine', 'ejs');
app.set('views', VIEWS_DIR);

// Behind a tunnel or load balancer, so the original protocol/host arrive in
// X-Forwarded-*. Without this, req.protocol reads "http" and any absolute URL
// built from the request would be wrong.
app.set('trust proxy', true);

app.disable('x-powered-by');

// Express's default 301-appends-a-slash behaviour is exactly the kind of
// redirect that silently kills association-file fetches. Off, everywhere.
app.set('strict routing', false);
app.enable('case sensitive routing');

/*
 * ─── ORDER IS LOAD-BEARING ────────────────────────────────────────────────
 *
 * 1. The two well-known files mount FIRST — before any static handler, auth,
 *    logger-with-redirect, or catch-all. Apple and Android both treat ANY
 *    redirect on those paths as a hard failure, and neither reports an error:
 *    the only symptom is that links quietly open the browser instead of the
 *    app, which looks identical to "the app is not installed".
 *
 * 2. The bare `/:code` legacy router mounts LAST, because that pattern would
 *    otherwise swallow /admin, /api and the well-known paths above it.
 */
app.use(wellKnown);

// Static assets. `redirect: false` stops express.static from issuing the
// directory trailing-slash 301.
app.use(express.static(PUBLIC_DIR, { redirect: false, fallthrough: true }));
app.use('/uploads', express.static(UPLOADS_DIR, { redirect: false, fallthrough: true }));

app.get('/healthz', async (req, res, next) => {
  try {
    const apps = await getEnabledApps();
    res.json({
      ok: true,
      linkHost: LINK_HOST,
      apps: apps.length,
      aasaEntries: buildAasa(apps).applinks.details.length,
      assetlinkStatements: buildAssetlinks(apps).length,
    });
  } catch (err) { next(err); }
});

app.use(deeplinkApi);
app.use(adminApi);

// Admin SPA. Served only if it has been built; otherwise a pointer rather than
// a bare 404, because "npm run admin:build" is easy to forget.
if (fs.existsSync(ADMIN_DIST_DIR)) {
  app.use('/admin', express.static(ADMIN_DIST_DIR, { redirect: false }));
  app.get(['/admin', '/admin/*'], (req, res) => {
    res.sendFile('index.html', { root: ADMIN_DIST_DIR });
  });
} else {
  app.get(['/admin', '/admin/*'], (req, res) => {
    res
      .status(503)
      .type('text/plain')
      .send('Admin UI is not built yet. Run:  npm install && npm run admin:build');
  });
}

app.use(deepLink);

// Vercel and local deployments open directly into the administration portal.
app.get('/', (req, res) => {
  res.redirect(302, '/admin');
});

app.use(legacy);

app.use((req, res) => {
  res.status(404).render('not-found', { slug: '', reason: 'Nothing is mapped to this URL.' });
});

app.use((err, req, res, next) => {
  console.error('[server] unhandled error', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Backend configuration or database error' });
  }
  res.status(500).render('not-found', {
    slug: '',
    reason: 'Something went wrong resolving this link.',
  });
});

if (process.env.VERCEL !== '1') app.listen(PORT, async () => {
  const apps = await getEnabledApps();
  console.log(`\nRunLoyal link service on :${PORT}`);
  console.log(`  public host   https://${LINK_HOST}`);
  console.log(`  config        ${APPS_FILE}`);
  console.log(`  apps          ${apps.map((a) => a.slug).join(', ') || '(none)'}`);
  console.log(`  AASA entries  ${buildAasa(apps).applinks.details.length}`);
  console.log(`  assetlinks    ${buildAssetlinks(apps).length}`);
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !ADMIN_EMAILS) {
    console.log('  ⚠ Supabase Auth or ADMIN_EMAILS is unset — admin email login is disabled');
  }
  if (LINK_HOST.includes('example.com')) {
    console.log('  ⚠ LINK_HOST is still the placeholder — set it before building the apps');
  }
  console.log('');
});

export default app;
