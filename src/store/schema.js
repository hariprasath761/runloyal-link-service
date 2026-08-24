/**
 * Shape + validation for an app record.
 *
 * This is deliberately hand-rolled rather than a schema library: the whole
 * point of the validation is to refuse to emit a `.well-known` file that would
 * silently break deep linking, and the rules that matter (fingerprint format,
 * bundle-id shape, slug charset) are specific enough that a generic validator
 * would not catch them anyway.
 */

/**
 * `crawler` and `inAppWebview` are deliberately NOT configurable:
 *  - a crawler must always get meta tags and never a redirect, or link previews
 *    in Slack/iMessage/WhatsApp break and OG scrapers cache a 302;
 *  - an in-app webview must always get the interstitial, because that is the
 *    only surface where the "Open in browser" escape hatch can be shown.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]+$/;
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const APP_STORE_ID_RE = /^\d+$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export const defaultBehavior = () => ({
  ios: 'storeDirect',
  android: 'storeDirect',
});

export const defaultWeb = () => ({
  url: null,
  showLink: false,
  redirectDesktop: false,
});

/** Requirements that must be satisfied before an app can be published. */
export function publishReadiness(app) {
  const missing = [];
  if (!String(app?.ios?.bundleId || '').trim()) missing.push('iOS bundle ID');
  if (!String(app?.ios?.teamId || '').trim()) missing.push('Apple Team ID');
  if (!String(app?.ios?.appStoreId || '').trim()) missing.push('App Store ID');
  if (!String(app?.android?.packageName || '').trim()) missing.push('Android package name');
  if (!Array.isArray(app?.android?.sha256CertFingerprints) || app.android.sha256CertFingerprints.length === 0) {
    missing.push('Android SHA-256 signing fingerprint');
  }
  return { ready: missing.length === 0, missing };
}

/** Requirements for publishing both OS association statements. */
export function nativeDeepLinkReadiness(app) {
  const missing = [];
  if (app?.enabled !== true) missing.push('Published app');
  if (!String(app?.ios?.bundleId || '').trim()) missing.push('iOS bundle ID');
  if (!String(app?.ios?.teamId || '').trim()) missing.push('Apple Team ID');
  if (!String(app?.android?.packageName || '').trim()) missing.push('Android package name');
  if (!Array.isArray(app?.android?.sha256CertFingerprints) || app.android.sha256CertFingerprints.length === 0) {
    missing.push('Android SHA-256 signing fingerprint');
  }
  return { ready: missing.length === 0, missing };
}

/** Normalises a fingerprint to the colon-separated uppercase form Android wants. */
export function normalizeFingerprint(raw) {
  if (typeof raw !== 'string') return null;
  const hex = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
  if (hex.length !== 64) return null;
  return hex.match(/.{2}/g).join(':');
}

/**
 * Validates and normalises an app record.
 *
 * @returns {{ ok: true, value: object } | { ok: false, errors: string[] }}
 */
export function validateApp(input, { existingSlugs = [], isNew = false } = {}) {
  const errors = [];
  const app = input && typeof input === 'object' ? input : {};

  const slug = String(app.slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug)) {
    errors.push(
      'slug must be 2-40 chars, lowercase letters/digits/hyphens, not starting or ending with a hyphen',
    );
  }
  if (isNew && existingSlugs.includes(slug)) {
    errors.push(`slug "${slug}" already exists`);
  }
  // The slug becomes a path prefix baked into app binaries. Reserving these
  // keeps a tenant from ever shadowing a service route.
  if (['well-known', 'api', 'admin', 'app', 'assets', 'uploads', 't'].includes(slug)) {
    errors.push(`slug "${slug}" is reserved`);
  }

  const displayName = String(app.displayName || '').trim();
  if (!displayName) errors.push('displayName is required');

  const enabled = app.enabled === true;

  const ios = app.ios && typeof app.ios === 'object' ? app.ios : {};
  const bundleId = String(ios.bundleId || '').trim();
  if (bundleId && !BUNDLE_ID_RE.test(bundleId)) {
    errors.push('ios.bundleId must look like a bundle identifier');
  }
  const teamId = String(ios.teamId || '').trim().toUpperCase();
  if (teamId && !TEAM_ID_RE.test(teamId)) {
    errors.push('ios.teamId must be a 10-character Apple Team ID');
  }
  const appStoreId = String(ios.appStoreId || '').trim();
  if (appStoreId && !APP_STORE_ID_RE.test(appStoreId)) {
    errors.push('ios.appStoreId must be numeric');
  }
  const android = app.android && typeof app.android === 'object' ? app.android : {};
  const packageName = String(android.packageName || '').trim();
  if (packageName && !BUNDLE_ID_RE.test(packageName)) {
    errors.push('android.packageName must look like a package name');
  }

  const rawPrints = Array.isArray(android.sha256CertFingerprints)
    ? android.sha256CertFingerprints
    : [];
  const fingerprints = [];
  rawPrints.forEach((fp, i) => {
    const normalized = normalizeFingerprint(fp);
    if (!normalized) {
      errors.push(
        `android.sha256CertFingerprints[${i}] is not 32 hex byte pairs — ` +
          'take it from Play Console > Release > Setup > App Signing, not a local keystore',
      );
      return;
    }
    if (!FINGERPRINT_RE.test(normalized)) {
      errors.push(`android.sha256CertFingerprints[${i}] failed normalisation`);
      return;
    }
    if (!fingerprints.includes(normalized)) fingerprints.push(normalized);
  });

  // A request reaching the service on iOS or Android means the OS did not open
  // an installed app. The only mobile fallback is therefore the platform store.
  const behavior = defaultBehavior();

  const inputWeb = app.web && typeof app.web === 'object' ? app.web : {};
  const web = defaultWeb();
  web.url = inputWeb.url ? String(inputWeb.url).trim() : null;
  web.showLink = inputWeb.showLink === true;
  web.redirectDesktop = inputWeb.redirectDesktop === true;

  if (web.url) {
    try {
      const parsed = new URL(web.url);
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
    } catch {
      errors.push('web.url must be an absolute http(s) URL');
    }
  }

  if (!web.url && (web.showLink || web.redirectDesktop)) {
    errors.push('web.url is required when a web link or web redirect is enabled');
  }

  if (enabled) {
    const readiness = publishReadiness({
      ios: { bundleId, teamId, appStoreId },
      android: { packageName, sha256CertFingerprints: fingerprints },
    });
    for (const item of readiness.missing) errors.push(`${item} is required before enabling the app`);
  }

  const nativeDeepLinkEnabled = app.nativeDeepLinkEnabled === true;
  if (nativeDeepLinkEnabled) {
    const readiness = nativeDeepLinkReadiness({
      enabled,
      ios: { bundleId, teamId },
      android: { packageName, sha256CertFingerprints: fingerprints },
    });
    for (const item of readiness.missing) {
      errors.push(`${item} is required before enabling open app when installed`);
    }
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      slug,
      displayName,
      tagline: String(app.tagline || 'Scan to download the app').trim(),
      enabled,
      iconPath: app.iconPath ? String(app.iconPath) : null,
      ios: {
        bundleId,
        teamId,
        appStoreId: appStoreId || null,
      },
      android: {
        packageName,
        sha256CertFingerprints: fingerprints,
      },
      behavior,
      // Shared, default-off release gate for both OS association files. The
      // compatible iOS and Android builds must be ready before this is enabled.
      nativeDeepLinkEnabled,
      web,
    },
  };
}

/**
 * Whether this app can appear in assetlinks.json.
 *
 * An entry with an empty `sha256_cert_fingerprints` array is not merely
 * useless — Android rejects the statement, and one bad statement can take the
 * whole file down for every other app on the domain. So apps without a
 * fingerprint are omitted rather than emitted empty.
 */
export const isAssetlinksReady = (app) =>
  Boolean(
    app.enabled &&
    app.nativeDeepLinkEnabled &&
    app.android.packageName &&
    app.android.sha256CertFingerprints.length > 0
  );

/**
 * Whether this app can appear in the AASA file. Needs a Team ID, because the
 * `appIDs` entry is `TEAMID.bundleId` and a missing prefix silently matches
 * nothing.
 */
export const isAasaReady = (app) =>
  Boolean(app.enabled && app.nativeDeepLinkEnabled && app.ios.bundleId && app.ios.teamId);
