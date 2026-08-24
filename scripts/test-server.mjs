#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'runloyal-link-test-'));
await fs.writeFile(path.join(tempDir, 'apps.json'), JSON.stringify({ apps: [], legacyCodes: {} }));

const authServer = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  const send = (status, payload) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  };

  if (req.url === '/auth/v1/token?grant_type=password') {
    if (body.email !== 'admin@example.com' || body.password !== 'test-password') {
      return send(400, { msg: 'Invalid login credentials' });
    }
    return send(200, {
      access_token: 'server-test-access', refresh_token: 'server-test-refresh', expires_in: 3600,
      user: { email: 'admin@example.com' },
    });
  }
  if (req.url === '/auth/v1/token?grant_type=refresh_token') {
    return send(200, {
      access_token: 'server-test-refreshed', refresh_token: 'server-test-refresh-2', expires_in: 3600,
      user: { email: 'admin@example.com' },
    });
  }
  if (req.url === '/auth/v1/user' && ['Bearer server-test-access', 'Bearer server-test-refreshed'].includes(req.headers.authorization)) {
    return send(200, { email: 'admin@example.com' });
  }
  return send(401, { msg: 'Invalid token' });
});
authServer.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  authServer.once('listening', resolve);
  authServer.once('error', reject);
});

process.env.DATA_DIR = tempDir;
process.env.LINK_HOST = 'links.example.test';
process.env.SUPABASE_DB_HOST = '';
process.env.SUPABASE_DB_USER = '';
process.env.SUPABASE_DB_PASSWORD = '';
process.env.SUPABASE_URL = `http://127.0.0.1:${authServer.address().port}`;
process.env.SUPABASE_ANON_KEY = 'test-anon-key';
process.env.ADMIN_EMAILS = 'admin@example.com';
process.env.VERCEL = '1';

const { default: app } = await import('../src/server.js');
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve, reject) => {
  server.once('listening', resolve);
  server.once('error', reject);
});

const origin = `http://127.0.0.1:${server.address().port}`;

try {
  console.log('\nserver integration\n');

  const root = await fetch(`${origin}/`, { redirect: 'manual' });
  assert.equal(root.status, 302);
  assert.equal(root.headers.get('location'), '/admin');
  console.log('  \x1b[32m✓\x1b[0m root redirects to /admin');

  const badLogin = await fetch(`${origin}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'wrong' }),
  });
  assert.equal(badLogin.status, 401);

  const login = await fetch(`${origin}/api/admin/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@example.com', password: 'test-password' }),
  });
  assert.equal(login.status, 200);
  const session = await login.json();
  const auth = { Authorization: `Bearer ${session.accessToken}` };
  console.log('  \x1b[32m✓\x1b[0m admin signs in with email and password');

  const jsonRequest = (method, url, body) => fetch(`${origin}${url}`, {
    method,
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

  const create = await jsonRequest('POST', '/api/admin/apps', {
    slug: 'draft-one', displayName: 'Draft One', enabled: false,
  });
  assert.equal(create.status, 201);
  const draft = await create.json();
  assert.equal(draft.enabled, false);
  console.log('  \x1b[32m✓\x1b[0m admin creates a minimal disabled draft');

  const incomplete = await jsonRequest('PUT', '/api/admin/apps/draft-one', { ...draft, enabled: true });
  assert.equal(incomplete.status, 400);
  assert.match(JSON.stringify(await incomplete.json()), /Apple Team ID/);
  console.log('  \x1b[32m✓\x1b[0m API blocks publishing an incomplete draft');

  const fingerprint = Array.from({ length: 32 }, (_, i) => (255 - i).toString(16).padStart(2, '0')).join(':');
  const target = 'https://tenant.example.com/exact?source=link';
  const publish = await jsonRequest('PUT', '/api/admin/apps/draft-one', {
    ...draft,
    slug: 'attempted-change',
    enabled: true,
    ios: { bundleId: 'com.runloyal.draft.one', teamId: 'E8Q47GVS49', appStoreId: '1234567890' },
    android: { packageName: 'com.runloyal.draft.one', sha256CertFingerprints: [fingerprint] },
    behavior: { ios: 'portal', android: 'interstitial' },
    nativeDeepLinkEnabled: true,
    web: { url: target, showLink: true, redirectDesktop: true },
  });
  assert.equal(publish.status, 200);
  const published = await publish.json();
  assert.equal(published.slug, 'draft-one');
  assert.deepEqual(published.behavior, { ios: 'storeDirect', android: 'storeDirect' });
  console.log('  \x1b[32m✓\x1b[0m publishing is ready-only, immutable, and fixes mobile store fallback');

  const desktop = await fetch(`${origin}/app/draft-one/appointment/123`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' }, redirect: 'manual',
  });
  assert.equal(desktop.status, 302);
  assert.equal(desktop.headers.get('location'), target);

  const ios = await fetch(`${origin}/app/draft-one/appointment/123?forcePlatform=ios`, { redirect: 'manual' });
  assert.equal(ios.status, 302);
  assert.match(ios.headers.get('location'), /^https:\/\/apps\.apple\.com\/app\/id1234567890$/);
  console.log('  \x1b[32m✓\x1b[0m desktop uses its web URL while mobile fallback opens its store');

  const compatibility = await fetch(`${origin}/t/draft-one/appointment/123`, { redirect: 'manual' });
  assert.equal(compatibility.status, 302);
  assert.equal(compatibility.headers.get('location'), '/app/draft-one/appointment/123');
  console.log('  \x1b[32m✓\x1b[0m old /t links redirect to canonical /app links');

  const webview = await fetch(`${origin}/app/draft-one/appointment/123?forcePlatform=inAppWebview`, { redirect: 'manual' });
  assert.equal(webview.status, 200);
  assert.match(await webview.text(), /class="web-link"/);

  const crawler = await fetch(`${origin}/app/draft-one/appointment/123`, {
    headers: { 'User-Agent': 'Slackbot-LinkExpanding 1.0' }, redirect: 'manual',
  });
  assert.equal(crawler.status, 200);
  assert.match(await crawler.text(), /property="og:url"/);
  console.log('  \x1b[32m✓\x1b[0m webviews render and crawlers receive metadata');

  const configResponse = await fetch(`${origin}/api/admin/config`, { headers: auth });
  const config = await configResponse.json();
  assert.equal(config.admin.email, 'admin@example.com');
  assert.equal(config.behaviors, undefined);
  assert.equal(config.apps[0].linkUrl, 'https://links.example.test/app/draft-one');
  assert.equal(config.apps[0].readiness.native.ready, true);

  const aasa = await fetch(`${origin}/.well-known/apple-app-site-association`).then((response) => response.json());
  assert.deepEqual(
    aasa.applinks.details[0].components.map((component) => component['/']),
    ['/app/draft-one', '/app/draft-one/*'],
  );
  const assetlinks = await fetch(`${origin}/.well-known/assetlinks.json`).then((response) => response.json());
  assert.equal(assetlinks[0].target.package_name, 'com.runloyal.draft.one');
  console.log('  \x1b[32m✓\x1b[0m API readiness and OS association paths use /app');

  console.log('\n\x1b[32mAll 10 passed\x1b[0m\n');
} finally {
  await new Promise((resolve) => server.close(resolve));
  await new Promise((resolve) => authServer.close(resolve));
  await fs.rm(tempDir, { recursive: true, force: true });
}
