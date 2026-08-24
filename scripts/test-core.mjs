#!/usr/bin/env node

import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ejs from 'ejs';

import { PLATFORM, resolveBehavior } from '../src/lib/platform.js';
import { webUrl } from '../src/lib/storeUrls.js';
import { buildLinkContext } from '../src/routes/deepLink.js';
import { buildAasa, buildAssetlinks } from '../src/routes/wellKnown.js';
import { validateApp } from '../src/store/schema.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FINGERPRINT = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join(':');

const completeInput = (overrides = {}) => ({
  slug: 'pet-owner-one',
  displayName: 'Pet Owner One',
  enabled: true,
  ios: {
    bundleId: 'com.runloyal.petowner.one',
    teamId: 'E8Q47GVS49',
    appStoreId: '1234567890',
  },
  android: {
    packageName: 'com.runloyal.petowner.one',
    sha256CertFingerprints: [FINGERPRINT],
  },
  behavior: { ios: 'storeDirect', android: 'storeDirect' },
  nativeDeepLinkEnabled: false,
  web: { url: null, showLink: false, redirectDesktop: false },
  ...overrides,
});

const cases = [];
const test = (name, fn) => cases.push([name, fn]);

test('a minimal disabled draft is valid and receives safe defaults', () => {
  const result = validateApp({ slug: 'new-tenant', displayName: 'New Tenant', enabled: false });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.ios, { bundleId: '', teamId: '', appStoreId: null });
  assert.equal(result.value.nativeDeepLinkEnabled, false);
  assert.deepEqual(result.value.web, { url: null, showLink: false, redirectDesktop: false });
});

test('new slugs reject duplicates and reserved service paths', () => {
  assert.equal(
    validateApp({ slug: 'new-tenant', displayName: 'New Tenant' }, { isNew: true, existingSlugs: ['new-tenant'] }).ok,
    false,
  );
  assert.equal(validateApp({ slug: 'admin', displayName: 'Admin' }, { isNew: true }).ok, false);
});

test('an incomplete app cannot be enabled', () => {
  const result = validateApp({ slug: 'new-tenant', displayName: 'New Tenant', enabled: true });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((message) => message.includes('Apple Team ID')));
  assert.ok(result.errors.some((message) => message.includes('Android SHA-256')));
});

test('a complete app stays out of association files until native opening is enabled', () => {
  const result = validateApp(completeInput());
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(buildAasa([result.value]).applinks.details.length, 0);
  assert.equal(buildAssetlinks([result.value]).length, 0);
});

test('native opening requires a published, native-ready app', () => {
  const disabled = validateApp(completeInput({ enabled: false, nativeDeepLinkEnabled: true }));
  assert.equal(disabled.ok, false);
  assert.ok(disabled.errors.some((message) => message.includes('Published app')));

  const incomplete = validateApp({
    slug: 'native-draft',
    displayName: 'Native Draft',
    enabled: false,
    nativeDeepLinkEnabled: true,
  });
  assert.equal(incomplete.ok, false);
  assert.ok(incomplete.errors.some((message) => message.includes('Apple Team ID')));
});

test('native-ready apps emit exact and nested iOS paths plus Android association', () => {
  const result = validateApp(completeInput({ nativeDeepLinkEnabled: true }));
  assert.equal(result.ok, true, result.errors?.join('\n'));
  assert.equal(buildAasa([result.value]).applinks.details.length, 1);
  assert.equal(buildAssetlinks([result.value]).length, 1);
  assert.deepEqual(
    buildAasa([result.value]).applinks.details[0].components.map((component) => component['/']),
    ['/app/pet-owner-one', '/app/pet-owner-one/*'],
  );
});

test('web controls require a valid absolute URL', () => {
  for (const input of [
    completeInput({ enabled: false, web: { url: null, showLink: true, redirectDesktop: false } }),
    completeInput({ enabled: false, web: { url: 'mailto:test@example.com', showLink: true, redirectDesktop: false } }),
  ]) {
    assert.equal(validateApp(input).ok, false);
  }
});

test('mobile fallback is always its platform store and ignores legacy behavior choices', () => {
  const app = validateApp(completeInput({
    behavior: { ios: 'portal', android: 'interstitial' },
    web: { url: 'https://tenant.example.com', showLink: false, redirectDesktop: false },
  })).value;
  assert.deepEqual(app.behavior, { ios: 'storeDirect', android: 'storeDirect' });
  assert.equal(resolveBehavior(app, PLATFORM.IOS), 'storeDirect');
  assert.equal(resolveBehavior(app, PLATFORM.ANDROID), 'storeDirect');
});

test('desktop redirect is opt-in and fixed platform buckets remain safe', () => {
  const app = validateApp(completeInput({
    web: { url: 'https://tenant.example.com/home?from=link', showLink: true, redirectDesktop: false },
  })).value;
  assert.equal(resolveBehavior(app, PLATFORM.DESKTOP), 'interstitial');
  app.web.redirectDesktop = true;
  assert.equal(resolveBehavior(app, PLATFORM.DESKTOP), 'portal');
  assert.equal(resolveBehavior(app, PLATFORM.CRAWLER), 'meta');
  assert.equal(resolveBehavior(app, PLATFORM.IN_APP_WEBVIEW), 'interstitial');
  assert.equal(webUrl(app), 'https://tenant.example.com/home?from=link');
});

test('the landing page shows the exact web action only when enabled', async () => {
  const app = validateApp(completeInput({
    web: { url: 'https://tenant.example.com/exact?from=link', showLink: true, redirectDesktop: false },
  })).value;
  const req = { get: () => 'Mozilla/5.0 (iPhone)', query: { forcePlatform: 'ios' } };
  const ctx = await buildLinkContext(req, app, 'appointment/123');
  assert.equal(ctx.webUrl, 'https://tenant.example.com/exact?from=link');
  const template = path.join(ROOT, 'src', 'views', 'interstitial.ejs');
  const shown = await ejs.renderFile(template, ctx);
  assert.match(shown, /class="web-link"/);
  assert.match(shown, /href="https:\/\/tenant\.example\.com\/exact\?from=link"/);

  app.web.showLink = false;
  const hidden = await ejs.renderFile(template, await buildLinkContext(req, app, 'appointment/123'));
  assert.doesNotMatch(hidden, /class="web-link"/);
});

let failed = 0;
console.log('\ncore behavior\n');
for (const [name, fn] of cases) {
  try {
    await fn();
    console.log(`  \x1b[32m✓\x1b[0m ${name}`);
  } catch (error) {
    failed++;
    console.log(`  \x1b[31m✗\x1b[0m ${name}`);
    console.log(`      ${error.message}`);
  }
}
console.log(failed ? `\n\x1b[31m${failed} failed\x1b[0m\n` : `\n\x1b[32mAll ${cases.length} passed\x1b[0m\n`);
process.exit(failed ? 1 : 0);
