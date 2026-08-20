#!/usr/bin/env node
/**
 * Tests the boot script's redirect decisions against the REAL generated page.
 *
 * The boot script is the whole server, once the site is static — if it decides
 * wrong, every link on the domain goes to the wrong place. It is also the one
 * piece that cannot be checked with curl, because curl does not run JavaScript.
 *
 * So the script is extracted from the built HTML and evaluated against stubbed
 * browser globals, capturing what it would have navigated to. Testing the
 * generated artefact rather than the source means a build-step bug (bad config
 * interpolation, stale output) fails the test too.
 *
 * Run:  npm run build:static && node scripts/test-boot.mjs
 */

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { LINK_HOST } from '../src/config.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Version/17.5 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Instagram 300.0.0.0',
};

/** Pulls the inline boot script out of a generated page. */
function bootScriptFor(slug) {
  const html = fs.readFileSync(path.join(DIST, 't', slug, 'index.html'), 'utf8');
  const match = html.match(/<script>\s*\n\/\*\s*\n \* Static-hosting boot script[\s\S]*?<\/script>/);
  assert.ok(match, `no boot script found in t/${slug}/index.html`);
  return match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
}

/**
 * Evaluates the boot script and reports what it did.
 *
 * @returns {{ redirectedTo: string|null, state: object|null }}
 */
function run(slug, { ua, pathname, search = '' }) {
  const source = bootScriptFor(slug);

  let redirectedTo = null;
  const listeners = [];

  const location = {
    // Must match the host the pages were built for, or the canonical URL
    // assertions compare a runtime value against a build-time one.
    origin: `https://${LINK_HOST}`,
    pathname,
    search,
    replace(url) {
      redirectedTo = url;
    },
    assign() {
      throw new Error('boot script used location.assign — must be replace, or Back traps the user');
    },
  };

  const sandbox = {
    navigator: { userAgent: ua },
    location,
    URLSearchParams,
    window: { matchMedia: () => ({ matches: false }) },
    document: {
      documentElement: { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } },
      addEventListener: (event, fn) => listeners.push([event, fn]),
      querySelector: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
    },
    console,
  };
  sandbox.window.__RL = undefined;
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { timeout: 2000 });

  return { redirectedTo, state: sandbox.window.__RL || null };
}

/* ── Cases ────────────────────────────────────────────────────────────────── */

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'apps.json'), 'utf8'));
const kennel = config.apps.find((a) => a.slug === 'kennel');
const behaviorOf = (slug, platform) =>
  config.apps.find((a) => a.slug === slug).behavior[platform];

console.log('\nboot script — decisions on the generated page\n');
console.log(`  kennel behavior: ${JSON.stringify(kennel.behavior)}\n`);

test('desktop is never sent to a store', () => {
  const { redirectedTo } = run('kennel', { ua: UA.desktop, pathname: '/t/kennel' });
  if (redirectedTo) {
    assert.ok(
      !/apps\.apple\.com|play\.google\.com/.test(redirectedTo),
      `desktop was sent to a store: ${redirectedTo}`,
    );
  }
});

test('iPadOS desktop UA is treated as desktop, not iOS', () => {
  // iPadOS 13+ reports a Macintosh UA. Guessing "iPad" here would send Mac
  // users to the App Store.
  const { redirectedTo, state } = run('kennel', { ua: UA.ipadOS, pathname: '/t/kennel' });
  if (state) assert.equal(state.os, 'desktop');
  if (redirectedTo) assert.ok(!/apps\.apple\.com/.test(redirectedTo));
});

/** First app configured with `behavior` on `platform`, or null. */
const appWith = (platform, behavior) =>
  config.apps.find((a) => a.enabled && a.behavior[platform] === behavior)?.slug || null;

test('iOS storeDirect goes to the App Store', function () {
  const slug = appWith('ios', 'storeDirect');
  if (!slug) return 'skipped (no app is storeDirect on iOS)';
  const { redirectedTo } = run(slug, { ua: UA.ios, pathname: `/t/${slug}` });
  assert.match(redirectedTo || '', /^https:\/\/apps\.apple\.com\/app\/id\d+$/);
});

test('Android storeDirect goes to Play with a path-specific referrer', function () {
  const slug = appWith('android', 'storeDirect');
  if (!slug) return 'skipped (no app is storeDirect on Android)';
  const { redirectedTo } = run(slug, {
    ua: UA.android,
    pathname: `/t/${slug}/appointment/9d7e`,
  });
  assert.match(redirectedTo || '', /^https:\/\/play\.google\.com\/store\/apps\/details\?id=/);
  assert.match(redirectedTo, new RegExp(`referrer=rl_${slug}_appointment_9d7e`));
});

test('storeDirect on iOS never lands on a Play URL (and vice versa)', function () {
  // Cheap guard against the os/platform variables drifting apart in the boot
  // script — sending iPhone users to Google Play is the kind of bug that only
  // shows up in support tickets.
  const ios = appWith('ios', 'storeDirect');
  if (ios) {
    const { redirectedTo } = run(ios, { ua: UA.ios, pathname: `/t/${ios}` });
    assert.ok(!/play\.google\.com/.test(redirectedTo || ''), `iOS sent to Play: ${redirectedTo}`);
  }
  const android = appWith('android', 'storeDirect');
  if (android) {
    const { redirectedTo } = run(android, { ua: UA.android, pathname: `/t/${android}` });
    assert.ok(!/apps\.apple\.com/.test(redirectedTo || ''), `Android sent to App Store: ${redirectedTo}`);
  }
  if (!ios && !android) return 'skipped (no storeDirect app)';
});

test('portal redirect carries the deep path through', function () {
  const slug = appWith('desktop', 'portal') || appWith('ios', 'portal');
  if (!slug) return 'skipped (no app is set to portal)';
  const platform = config.apps.find((a) => a.slug === slug).behavior.desktop === 'portal'
    ? UA.desktop
    : UA.ios;
  const { redirectedTo } = run(slug, { ua: platform, pathname: `/t/${slug}/appointment/9d7e` });
  assert.ok(redirectedTo, 'expected a portal redirect');
  assert.match(redirectedTo, /\/appointment\/9d7e$/);
});

test('in-app webview always renders, never redirects', () => {
  const { redirectedTo, state } = run('kennel', { ua: UA.instagram, pathname: '/t/kennel' });
  assert.equal(redirectedTo, null, `webview was redirected to ${redirectedTo}`);
  assert.equal(state.platform, 'inAppWebview');
  assert.equal(state.isWebview, true);
});

/**
 * An app configured to render rather than redirect on this platform.
 *
 * Resolved from config rather than hardcoded: these tests assert URL parsing,
 * which needs the page to actually render (a redirect returns before `__RL` is
 * set). Naming a specific app here made the suite fail the moment that app's
 * behavior was changed in the admin — a config edit is not a regression.
 */
const rendering = (platform = 'desktop') =>
  config.apps.find((a) => a.behavior[platform] === 'interstitial')?.slug || null;

/** Origin the pages were built for — what the baked QR and og:url encode. */
const ORIGIN = `https://${LINK_HOST}`;

test('the built pages encode the configured host, not the placeholder', () => {
  // The boot script computes redirects from location.origin, so a stale
  // LINK_HOST leaves every redirect working while the baked-in QR code and
  // og:url point at a domain that does not exist. Scanning the QR goes
  // nowhere, and nothing about the deployed site looks wrong.
  assert.ok(
    !LINK_HOST.includes('example.com'),
    `LINK_HOST is still the placeholder (${LINK_HOST}) — set it in .env and rebuild`,
  );

  for (const app of config.apps.filter((a) => a.enabled)) {
    const html = fs.readFileSync(path.join(DIST, 't', app.slug, 'index.html'), 'utf8');
    const ogUrl = html.match(/property="og:url" content="([^"]*)"/)?.[1];
    assert.equal(
      ogUrl,
      `${ORIGIN}/t/${app.slug}`,
      `t/${app.slug} was built for a different host — rebuild after changing LINK_HOST`,
    );
  }
});

test('an interstitial app renders on every platform', function () {
  const slug = rendering('desktop');
  if (!slug) return 'skipped (no app is set to interstitial)';
  for (const [name, ua] of [['ios', UA.ios], ['android', UA.android], ['desktop', UA.desktop]]) {
    if (config.apps.find((a) => a.slug === slug).behavior[name] !== 'interstitial') continue;
    const { redirectedTo } = run(slug, { ua, pathname: `/t/${slug}` });
    assert.equal(redirectedTo, null, `${slug} redirected on ${name}: ${redirectedTo}`);
  }
});

test('deep path is parsed out from under /t/<slug>', function () {
  const slug = rendering();
  if (!slug) return 'skipped (no app is set to interstitial)';
  const { state } = run(slug, { ua: UA.desktop, pathname: `/t/${slug}/vax/upload/c4b8e1` });
  assert.equal(state.deepPath, 'vax/upload/c4b8e1');
  assert.equal(state.canonical, `${ORIGIN}/t/${slug}/vax/upload/c4b8e1`);
});

test('trailing slash does not corrupt the canonical URL', function () {
  const slug = rendering();
  if (!slug) return 'skipped (no app is set to interstitial)';
  const { state } = run(slug, { ua: UA.desktop, pathname: `/t/${slug}/appointments/` });
  assert.equal(state.deepPath, 'appointments');
  assert.ok(!state.canonical.endsWith('//'));
});

test('bare /t/<slug> yields no deep path', function () {
  const slug = rendering();
  if (!slug) return 'skipped (no app is set to interstitial)';
  const { state } = run(slug, { ua: UA.desktop, pathname: `/t/${slug}` });
  assert.equal(state.deepPath, '');
  assert.equal(state.canonical, `${ORIGIN}/t/${slug}`);
});

test('?forcePlatform drives the same code path as real detection', function () {
  // Needs a platform the app renders on, or the forced run redirects and there
  // is no state left to inspect.
  const slug = rendering('android');
  if (!slug) return 'skipped (no app renders on android)';
  const { state } = run(slug, {
    ua: UA.desktop,
    pathname: `/t/${slug}`,
    search: '?forcePlatform=android',
  });
  assert.equal(state.os, 'android');
});

/* ── Runner ───────────────────────────────────────────────────────────────── */

let failed = 0;
let skipped = 0;
for (const [name, fn] of cases) {
  try {
    const result = fn();
    if (typeof result === 'string' && result.startsWith('skipped')) {
      skipped++;
      console.log(`  \x1b[90m- ${name} — ${result}\x1b[0m`);
    } else {
      console.log(`  \x1b[32m✓\x1b[0m ${name}`);
    }
  } catch (err) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${err.message}`);
  }
}

console.log(
  failed
    ? `\n\x1b[31m${failed} failed\x1b[0m, ${cases.length - failed - skipped} passed, ${skipped} skipped\n`
    : `\n\x1b[32mAll ${cases.length - skipped} passed\x1b[0m${skipped ? `, ${skipped} skipped` : ''}\n`,
);
process.exit(failed ? 1 : 0);
