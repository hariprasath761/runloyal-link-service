import express from 'express';

import { getEnabledApps } from '../store/appsRepository.js';
import { isAasaReady, isAssetlinksReady } from '../store/schema.js';

/**
 * The two association files, generated from apps.json on every request.
 *
 * ## Hard requirements — every one of these fails SILENTLY if violated
 *
 * - HTTPS with a publicly trusted certificate.
 * - `Content-Type: application/json` on both.
 * - **Zero redirects.** Not even a trailing-slash 301. This is why the router
 *   is mounted before every other middleware in server.js.
 * - No auth, no VPN, no IP allowlist on these paths.
 * - The AASA file has **no** `.json` extension.
 *
 * Neither Apple nor Android surfaces an error when one of these is wrong. The
 * only symptom is that links open the browser instead of the app, which is
 * indistinguishable from "the app is not installed".
 */

const router = express.Router();

/** Path scope for a tenant. Everything under `/t/<slug>/` belongs to that app. */
const pathPrefixFor = (app) => `/t/${app.slug}`;

/**
 * Apple App Site Association.
 *
 * Path scoping per tenant is MANDATORY. Without a `components` entry, any
 * installed app that claims this domain claims *every* path on it, and two
 * tenant apps on one device fight over which one opens.
 */
export function buildAasa(apps = getEnabledApps()) {
  const details = apps.filter(isAasaReady).map((app) => ({
    appIDs: [`${app.ios.teamId}.${app.ios.bundleId}`],
    components: [
      {
        '/': `${pathPrefixFor(app)}/*`,
        comment: `Deep links for ${app.displayName}`,
      },
    ],
  }));

  return {
    applinks: { details },
    // Declared but empty: this domain does not vend passwords or handoff.
    // Present so the file shape stays stable if either is added later.
    webcredentials: { apps: apps.filter(isAasaReady).map((a) => `${a.ios.teamId}.${a.ios.bundleId}`) },
  };
}

/**
 * Android Digital Asset Links.
 *
 * Apps without a fingerprint are omitted entirely rather than emitted with an
 * empty array — one malformed statement can invalidate the whole file and take
 * every other app on the domain down with it.
 */
export function buildAssetlinks(apps = getEnabledApps()) {
  return apps.filter(isAssetlinksReady).map((app) => ({
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: app.android.packageName,
      sha256_cert_fingerprints: app.android.sha256CertFingerprints,
    },
  }));
}

/**
 * Shared response shaping — explicit content type, explicit no-redirect.
 *
 * `res.end` rather than `res.send`: Express appends `; charset=utf-8` to the
 * Content-Type of any string it sends. Both platforms tolerate the parameter,
 * but Apple's documented requirement is a bare `application/json`, and there is
 * no upside to differing from the spec on a file whose failure mode is silent.
 */
function sendJson(res, body) {
  const payload = JSON.stringify(body);
  res.status(200);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  // Apple's CDN caches aggressively and has no manual invalidation. A short
  // max-age keeps our own origin cheap without pretending we control theirs.
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.end(payload);
}

router.get('/.well-known/apple-app-site-association', (req, res) => {
  sendJson(res, buildAasa());
});

// Some tooling and a few older docs probe the `.json` variant. Serving the same
// body is correct; redirecting to the extensionless path would NOT be, because
// a redirect on a well-known path is itself a failure.
router.get('/.well-known/apple-app-site-association.json', (req, res) => {
  sendJson(res, buildAasa());
});

router.get('/.well-known/assetlinks.json', (req, res) => {
  sendJson(res, buildAssetlinks());
});

export default router;
