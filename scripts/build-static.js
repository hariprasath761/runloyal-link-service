#!/usr/bin/env node
/**
 * Builds the static site deployed to Firebase Hosting (free Spark plan).
 *
 * Firebase Hosting serves files only — no server. So everything the Express app
 * computes per request is instead either
 *   - generated here at build time (the association files, one page per app), or
 *   - computed in the browser by the boot script (platform detection, redirects).
 *
 * Consequence to be aware of: **config changes require a redeploy.** The admin
 * UI still runs locally against `npm start` and writes data/apps.json; this
 * script turns that file into the deployed site.
 *
 * One upside of going static: crawlers get correct behaviour for free. Bots do
 * not execute JavaScript, so they receive the HTML with its OG tags and are
 * never redirected — which is exactly what the dynamic version had to detect
 * user agents to achieve.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import ejs from 'ejs';
import QRCode from 'qrcode';

import { LINK_HOST, PUBLIC_DIR, ROOT, UPLOADS_DIR, VIEWS_DIR } from '../src/config.js';
import { buildAasa, buildAssetlinks } from '../src/routes/wellKnown.js';
import { getEnabledApps, getState } from '../src/store/appsRepository.js';

const DIST = path.join(ROOT, 'dist');

const log = (msg) => console.log(`  ${msg}`);

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/* ── Association files ────────────────────────────────────────────────────── */

function writeWellKnown(apps) {
  const dir = path.join(DIST, '.well-known');
  fs.mkdirSync(dir, { recursive: true });

  const aasa = buildAasa(apps);
  const assetlinks = buildAssetlinks(apps);

  // No .json extension — Apple requests the extensionless path. Firebase serves
  // by extension, so this file would go out as application/octet-stream without
  // the explicit Content-Type header written into firebase.json below.
  fs.writeFileSync(path.join(dir, 'apple-app-site-association'), JSON.stringify(aasa));
  fs.writeFileSync(path.join(dir, 'assetlinks.json'), JSON.stringify(assetlinks));

  const bytes = Buffer.byteLength(JSON.stringify(aasa));
  log(`.well-known/apple-app-site-association  ${aasa.applinks.details.length} entries, ${bytes} bytes`);
  log(`.well-known/assetlinks.json             ${assetlinks.length} statements`);

  if (bytes > 100 * 1024) {
    console.warn(`  ! AASA is ${(bytes / 1024).toFixed(1)} KB — approaching Apple's 128 KB hard limit`);
  }
}

/* ── Per-app page ─────────────────────────────────────────────────────────── */

async function writeAppPages(apps, portalUrl) {
  const template = fs.readFileSync(path.join(VIEWS_DIR, 'interstitial.ejs'), 'utf8');

  for (const app of apps) {
    const canonical = `https://${LINK_HOST}/t/${app.slug}`;

    // Baked for the base link so the QR works with JavaScript disabled. When a
    // deeper path is open, the boot script redraws it for that exact URL.
    const qr = await QRCode.toString(canonical, {
      type: 'svg',
      margin: 0,
      width: 220,
      errorCorrectionLevel: 'M',
      color: { dark: '#0B1220', light: '#FFFFFF' },
    }).then((svg) =>
      svg
        .replace(/\s(width|height)="[^"]*"/g, '')
        .replace('<svg', '<svg preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false"'),
    );

    const clientConfig = {
      slug: app.slug,
      behavior: app.behavior,
      openAppIfInstalled: app.openAppIfInstalled,
      appStoreId: app.ios.appStoreId,
      packageName: app.android.packageName,
      scheme: app.ios.scheme,
      portalUrl: app.portalUrlOverride || portalUrl || null,
    };

    const html = ejs.render(
      template,
      {
        mode: 'static',
        app,
        clientConfig,
        deepLinkPath: '',
        canonicalUrl: canonical,
        iconUrl: app.iconPath,
        qr,
        // Server-mode fields the template still references. In static mode the
        // boot script owns all of these, so they are neutral defaults that
        // double as the no-JavaScript rendering.
        platform: '',
        os: '',
        forced: false,
        behavior: 'interstitial',
        isInAppWebview: false,
        appStoreUrl: app.ios.appStoreId ? `https://apps.apple.com/app/id${app.ios.appStoreId}` : null,
        playStoreUrl: app.android.packageName
          ? `https://play.google.com/store/apps/details?id=${app.android.packageName}`
          : null,
        portalUrl: clientConfig.portalUrl,
        intentUrl: null,
        schemeUrl: null,
        probe: { ios: null, android: null },
        storeUrl: null,
      },
      { filename: path.join(VIEWS_DIR, 'interstitial.ejs') },
    );

    const dir = path.join(DIST, 't', app.slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    log(`t/${app.slug}/index.html`);
  }
}

/* ── QR bundle ────────────────────────────────────────────────────────────── */

function buildQrBundle() {
  const entry = path.join(ROOT, '.qr-entry.js');
  fs.writeFileSync(
    entry,
    [
      "import QRCode from 'qrcode';",
      'window.RLQR = function (text) {',
      "  return QRCode.toString(text, { type: 'svg', margin: 0, width: 220,",
      "    errorCorrectionLevel: 'M', color: { dark: '#0B1220', light: '#FFFFFF' } });",
      '};',
    ].join('\n'),
  );

  try {
    execFileSync(
      'npx',
      [
        '--yes', 'esbuild', entry,
        '--bundle', '--minify', '--format=iife',
        `--outfile=${path.join(DIST, 'qr.js')}`,
        '--log-level=error',
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    const size = fs.statSync(path.join(DIST, 'qr.js')).size;
    log(`qr.js  ${(size / 1024).toFixed(1)} KB (loaded only on desktop, and only for deep paths)`);
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

/* ── Root index ───────────────────────────────────────────────────────────── */

/**
 * A directory of the live links.
 *
 * Nothing routes through `/`, so this used to be a one-line stub — which made
 * the bare domain look like a broken deploy to anyone who opened it before
 * knowing the `/t/<slug>` grammar. Listing the apps costs nothing and answers
 * the question the URL bar invites.
 */
function writeIndex(apps) {
  const escape = (s) =>
    String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  const rows = apps
    .map((app) => {
      const behavior = ['ios', 'android', 'desktop']
        .map((p) => `${p}: ${app.behavior[p]}`)
        .join(' · ');
      return `    <li class="row">
      ${app.iconPath ? `<img src="${escape(app.iconPath)}" alt="" width="44" height="44">` : '<span class="ph"></span>'}
      <span class="meta">
        <a href="/t/${escape(app.slug)}">/t/${escape(app.slug)}</a>
        <strong>${escape(app.displayName)}</strong>
        <small>${escape(behavior)}</small>
      </span>
    </li>`;
    })
    .join('\n');

  fs.writeFileSync(
    path.join(DIST, 'index.html'),
    `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>RunLoyal link service</title>
<style>
  body{margin:0;background:#f0f2f5;color:#0b1220;font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{max-width:620px;margin:0 auto;padding:48px 20px}
  h1{font-size:20px;margin:0 0 4px}
  p.sub{margin:0 0 28px;color:#667085;font-size:14px}
  ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:10px}
  .row{display:flex;gap:14px;align-items:center;background:#fff;border-radius:12px;padding:14px 16px}
  .row img,.ph{width:44px;height:44px;border-radius:11px;flex:none;object-fit:cover;background:#eef0f4}
  .meta{display:flex;flex-direction:column;min-width:0}
  .meta a{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;color:#1570ef;text-decoration:none}
  .meta a:hover{text-decoration:underline}
  .meta strong{font-size:14px;font-weight:600;margin-top:2px}
  .meta small{color:#667085;font-size:12px;margin-top:2px}
  @media (prefers-color-scheme:dark){
    body{background:#0f141b;color:#f3f5f8}.row{background:#1a212b}
    .meta small,p.sub{color:#7d8794}.row .ph{background:#232b36}
  }
</style>
</head><body>
<main>
  <h1>RunLoyal link service</h1>
  <p class="sub">Deep links live under <code>/t/&lt;app&gt;</code>. Nothing is served from this page.</p>
  <ul>
${rows}
  </ul>
</main>
</body></html>
`,
  );
  log(`index.html  (directory of ${apps.length} apps)`);
}

/* ── firebase.json ────────────────────────────────────────────────────────── */

function writeFirebaseJson(apps, legacyCodes) {
  const config = {
    hosting: {
      public: 'dist',

      // `firebase init` puts "**/.*" here by default, which matches the
      // .well-known DIRECTORY and silently drops both association files from
      // the deploy. The site looks fine and deep linking never works.
      ignore: ['firebase.json', '**/node_modules/**'],

      // Firebase generates its own AASA for Dynamic Links when this is "AUTO"
      // (the default) and would shadow ours. Dynamic Links is shut down, but
      // the Hosting behaviour remains.
      appAssociation: 'NONE',

      // Both add redirects, and ANY redirect on a .well-known path is a hard
      // failure for Apple and Android alike.
      cleanUrls: false,
      trailingSlash: false,

      headers: [
        {
          // Extensionless, so Firebase would otherwise serve it as
          // application/octet-stream and iOS would ignore it.
          source: '/.well-known/apple-app-site-association',
          headers: [
            { key: 'Content-Type', value: 'application/json' },
            { key: 'Cache-Control', value: 'public, max-age=300' },
          ],
        },
        {
          source: '/.well-known/assetlinks.json',
          headers: [
            { key: 'Content-Type', value: 'application/json' },
            { key: 'Cache-Control', value: 'public, max-age=300' },
          ],
        },
      ],

      // Legacy Branch short codes. Static redirects, so they cost nothing and
      // keep working for the 12+ months the migration requires.
      redirects: Object.entries(legacyCodes).map(([code, mapping]) => {
        // Strip both ends: a stored path of "/" (meaning "the app's base link")
        // would otherwise produce a "//" destination, which Hosting serves as a
        // protocol-relative URL and sends the visitor off-site.
        const target = String(mapping.path || '').replace(/^\/+|\/+$/g, '');
        return {
          source: `/${code}`,
          destination: `/t/${mapping.slug}${target ? `/${target}` : ''}`,
          type: 302,
        };
      }),

      // One page per app serves every path beneath it; the boot script reads
      // the action and token out of location.pathname. Both patterns are
      // needed — "/t/kennel/**" does not match "/t/kennel" itself.
      rewrites: apps.flatMap((app) => [
        { source: `/t/${app.slug}`, destination: `/t/${app.slug}/index.html` },
        { source: `/t/${app.slug}/**`, destination: `/t/${app.slug}/index.html` },
      ]),
    },
  };

  fs.writeFileSync(path.join(ROOT, 'firebase.json'), JSON.stringify(config, null, 2) + '\n');
  log(`firebase.json  ${config.hosting.rewrites.length} rewrites, ${config.hosting.redirects.length} redirects`);
}

/* ── Entry ────────────────────────────────────────────────────────────────── */

async function main() {
  const state = getState();
  const apps = getEnabledApps();

  if (apps.length === 0) {
    console.error('No enabled apps in data/apps.json — nothing to build.');
    process.exit(1);
  }

  console.log(`\nBuilding static site for https://${LINK_HOST}\n`);

  rmrf(DIST);
  fs.mkdirSync(DIST, { recursive: true });

  writeWellKnown(apps);
  await writeAppPages(apps, state.portalUrl);

  copyDir(PUBLIC_DIR, DIST);
  copyDir(UPLOADS_DIR, path.join(DIST, 'uploads'));
  log('copied public/ and uploads/');

  buildQrBundle();

  writeIndex(apps);

  writeFirebaseJson(apps, state.legacyCodes);

  console.log(`\n  ✓ dist/ ready — deploy with:  firebase deploy --only hosting\n`);
  if (LINK_HOST.includes('example.com')) {
    console.warn('  ! LINK_HOST is still the placeholder. Set it in .env before deploying.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
