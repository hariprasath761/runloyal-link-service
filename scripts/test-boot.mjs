#!/usr/bin/env node
/** Exercises redirect decisions in the generated static page's real boot script. */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import { LINK_HOST } from '../src/config.js';
import { getEnabledApps } from '../src/store/appsRepository.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const ORIGIN = `https://${LINK_HOST}`;
const enabledApps = await getEnabledApps();
const first = enabledApps[0];

const UA = {
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  ipadOS: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36',
  instagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile Instagram 300.0',
};

function clientConfig(app, overrides = {}) {
  return {
    slug: app.slug,
    appStoreId: app.ios.appStoreId,
    packageName: app.android.packageName,
    web: app.web,
    ...overrides,
  };
}

function bootScriptFor(slug, override) {
  const file = path.join(DIST, 'app', slug, 'index.html');
  const html = fs.readFileSync(file, 'utf8');
  const match = html.match(/<script>\s*\n\/\*\s*\n \* Static-hosting boot script[\s\S]*?<\/script>/);
  assert.ok(match, `no boot script found in app/${slug}/index.html`);
  const source = match[0].replace(/^<script>/, '').replace(/<\/script>$/, '');
  return override ? source.replace(/var CFG = .*;/, `var CFG = ${JSON.stringify(override)};`) : source;
}

function run(slug, { ua, pathname, search = '', configOverride = null }) {
  let redirectedTo = null;
  const location = {
    origin: ORIGIN,
    pathname,
    search,
    replace(url) { redirectedTo = url; },
    assign() { throw new Error('location.assign must not be used'); },
  };
  const sandbox = {
    navigator: { userAgent: ua },
    location,
    URLSearchParams,
    window: { matchMedia: () => ({ matches: false }) },
    document: {
      documentElement: { setAttribute() {} },
      addEventListener() {},
      querySelector: () => null,
      createElement: () => ({}),
      head: { appendChild() {} },
    },
    console,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(bootScriptFor(slug, configOverride), sandbox, { timeout: 2000 });
  return { redirectedTo, state: sandbox.window.__RL || null };
}

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('iOS fallback always opens the App Store', () => {
  const { redirectedTo } = run(first.slug, { ua: UA.ios, pathname: `/app/${first.slug}` });
  assert.match(redirectedTo, /^https:\/\/apps\.apple\.com\/app\/id\d+$/);
});

test('Android fallback opens Play with a path-specific referrer', () => {
  const { redirectedTo } = run(first.slug, {
    ua: UA.android,
    pathname: `/app/${first.slug}/appointment/9d7e`,
  });
  assert.match(redirectedTo, /^https:\/\/play\.google\.com\/store\/apps\/details\?id=/);
  assert.match(redirectedTo, new RegExp(`referrer=rl_${first.slug}_appointment_9d7e`));
});

test('legacy mobile behavior cannot redirect to a web URL', () => {
  const target = 'https://tenant.example.com/should-not-open';
  const { redirectedTo } = run(first.slug, {
    ua: UA.ios,
    pathname: `/app/${first.slug}`,
    configOverride: { ...clientConfig(first), behavior: { ios: 'portal' }, web: { url: target, showLink: true, redirectDesktop: true } },
  });
  assert.notEqual(redirectedTo, target);
  assert.match(redirectedTo, /^https:\/\/apps\.apple\.com/);
});

test('desktop stays on the landing page by default', () => {
  const { redirectedTo, state } = run(first.slug, { ua: UA.desktop, pathname: `/app/${first.slug}` });
  assert.equal(redirectedTo, null);
  assert.equal(state.os, 'desktop');
});

test('desktop web redirect uses the exact configured URL', () => {
  const target = 'https://tenant.example.com/dashboard?source=link';
  const { redirectedTo } = run(first.slug, {
    ua: UA.desktop,
    pathname: `/app/${first.slug}/appointment/9d7e`,
    configOverride: clientConfig(first, { web: { url: target, showLink: true, redirectDesktop: true } }),
  });
  assert.equal(redirectedTo, target);
});

test('in-app webviews render instead of redirecting', () => {
  const { redirectedTo, state } = run(first.slug, { ua: UA.instagram, pathname: `/app/${first.slug}` });
  assert.equal(redirectedTo, null);
  assert.equal(state.platform, 'inAppWebview');
});

test('iPadOS desktop UA is not sent to the iOS store', () => {
  const { redirectedTo, state } = run(first.slug, { ua: UA.ipadOS, pathname: `/app/${first.slug}` });
  assert.equal(redirectedTo, null);
  assert.equal(state.os, 'desktop');
});

test('nested paths produce canonical /app URLs', () => {
  const { state } = run(first.slug, { ua: UA.desktop, pathname: `/app/${first.slug}/vax/upload/c4b8e1/` });
  assert.equal(state.deepPath, 'vax/upload/c4b8e1');
  assert.equal(state.canonical, `${ORIGIN}/app/${first.slug}/vax/upload/c4b8e1`);
});

test('old /t paths are parsed but canonicalized to /app', () => {
  const { state } = run(first.slug, { ua: UA.desktop, pathname: `/t/${first.slug}/appointments/123` });
  assert.equal(state.deepPath, 'appointments/123');
  assert.equal(state.canonical, `${ORIGIN}/app/${first.slug}/appointments/123`);
});

test('generated pages use configured host and contain no browser app probes', () => {
  assert.ok(!LINK_HOST.includes('example.com'), `LINK_HOST is still placeholder (${LINK_HOST})`);
  for (const app of enabledApps) {
    const html = fs.readFileSync(path.join(DIST, 'app', app.slug, 'index.html'), 'utf8');
    assert.match(html, new RegExp(`${ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/app/${app.slug}`));
    assert.doesNotMatch(html, /intent:\/\/|data-probe|PROBE_MS|openAppIfInstalled/);
  }
});

let failed = 0;
console.log('\nboot script — generated static pages\n');
for (const [name, fn] of cases) {
  try {
    fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}\n      ${error.message}`);
  }
}
console.log(failed ? `\n\x1b[31m${failed} failed\x1b[0m\n` : `\n\x1b[32mAll ${cases.length} passed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
