/**
 * Shape + validation for an app record.
 *
 * This is deliberately hand-rolled rather than a schema library: the whole
 * point of the validation is to refuse to emit a `.well-known` file that would
 * silently break deep linking, and the rules that matter (fingerprint format,
 * bundle-id shape, slug charset) are specific enough that a generic validator
 * would not catch them anyway.
 */

/** How a platform should be handled when the interstitial URL is hit. */
export const BEHAVIORS = ['interstitial', 'storeDirect', 'portal'];

/** Platform buckets the admin can configure. */
export const PLATFORMS = ['ios', 'android', 'desktop'];

/**
 * `crawler` and `inAppWebview` are deliberately NOT configurable:
 *  - a crawler must always get meta tags and never a redirect, or link previews
 *    in Slack/iMessage/WhatsApp break and OG scrapers cache a 302;
 *  - an in-app webview must always get the interstitial, because that is the
 *    only surface where the "Open in browser" escape hatch can be shown.
 */
export const FIXED_PLATFORMS = ['crawler', 'inAppWebview'];

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$/;
const BUNDLE_ID_RE = /^[A-Za-z0-9.-]+$/;
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;
const APP_STORE_ID_RE = /^\d+$/;
const SCHEME_RE = /^[a-z][a-z0-9.+-]*$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export const defaultBehavior = () => ({
  ios: 'interstitial',
  android: 'interstitial',
  desktop: 'interstitial',
});

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
  if (['well-known', 'api', 'admin', 'assets', 'uploads', 't'].includes(slug)) {
    errors.push(`slug "${slug}" is reserved`);
  }

  const displayName = String(app.displayName || '').trim();
  if (!displayName) errors.push('displayName is required');

  const ios = app.ios && typeof app.ios === 'object' ? app.ios : {};
  const bundleId = String(ios.bundleId || '').trim();
  if (!bundleId || !BUNDLE_ID_RE.test(bundleId)) {
    errors.push('ios.bundleId is required and must look like a bundle identifier');
  }
  const teamId = String(ios.teamId || '').trim().toUpperCase();
  if (teamId && !TEAM_ID_RE.test(teamId)) {
    errors.push('ios.teamId must be a 10-character Apple Team ID');
  }
  const appStoreId = String(ios.appStoreId || '').trim();
  if (appStoreId && !APP_STORE_ID_RE.test(appStoreId)) {
    errors.push('ios.appStoreId must be numeric');
  }
  const scheme = String(ios.scheme || '').trim().toLowerCase();
  if (scheme && !SCHEME_RE.test(scheme)) {
    errors.push('ios.scheme must be a valid URL scheme');
  }

  const android = app.android && typeof app.android === 'object' ? app.android : {};
  const packageName = String(android.packageName || '').trim();
  if (!packageName || !BUNDLE_ID_RE.test(packageName)) {
    errors.push('android.packageName is required and must look like a package name');
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

  const behavior = defaultBehavior();
  const inBehavior = app.behavior && typeof app.behavior === 'object' ? app.behavior : {};
  for (const platform of PLATFORMS) {
    const value = inBehavior[platform];
    if (value === undefined || value === null || value === '') continue;
    if (!BEHAVIORS.includes(value)) {
      errors.push(`behavior.${platform} must be one of ${BEHAVIORS.join(', ')}`);
      continue;
    }
    behavior[platform] = value;
  }

  // `portal` needs somewhere to go. Catch it here rather than 500-ing at
  // request time on a redirect to `undefined`.
  const portalOverride = app.portalUrlOverride ? String(app.portalUrlOverride).trim() : null;
  if (portalOverride && !/^https?:\/\//i.test(portalOverride)) {
    errors.push('portalUrlOverride must be an absolute http(s) URL');
  }

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      slug,
      displayName,
      tagline: String(app.tagline || 'Scan to download the app').trim(),
      enabled: app.enabled !== false,
      iconPath: app.iconPath ? String(app.iconPath) : null,
      ios: {
        bundleId,
        teamId,
        appStoreId: appStoreId || null,
        scheme: scheme || null,
      },
      android: {
        packageName,
        sha256CertFingerprints: fingerprints,
      },
      behavior,
      // Defaults to OFF. Opening an installed app straight from the browser
      // needs the app side to handle the link (Universal Links / App Links plus
      // a scheme handler), which is deferred — so the default is the behaviour
      // that always works: send everyone to the store or the portal. Turning
      // this on before the apps can receive links means iOS users get an
      // "Open in …?" prompt that leads nowhere.
      openAppIfInstalled: app.openAppIfInstalled === true,
      portalUrlOverride: portalOverride,
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
  Boolean(app.enabled && app.android.packageName && app.android.sha256CertFingerprints.length > 0);

/**
 * Whether this app can appear in the AASA file. Needs a Team ID, because the
 * `appIDs` entry is `TEAMID.bundleId` and a missing prefix silently matches
 * nothing.
 */
export const isAasaReady = (app) => Boolean(app.enabled && app.ios.bundleId && app.ios.teamId);
