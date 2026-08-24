/**
 * URL builders for every destination a link can end at.
 *
 * Installed-app opening is deliberately absent here: Universal Links and App
 * Links are handled by the OS before an HTTP request reaches this service. If
 * a request does arrive, these builders provide deterministic store/web
 * destinations without custom schemes or browser launch probes.
 */

export function appStoreUrl(app) {
  const id = app?.ios?.appStoreId;
  if (!id) return null;
  return `https://apps.apple.com/app/id${id}`;
}

/**
 * Play Store URL.
 *
 * `referrer` rides along as the Install Referrer payload — Play preserves it
 * through the install and the app reads it back on first launch to resolve
 * deferred deep links. It must stay short and opaque: it is visible to anyone
 * who inspects the URL, so no PII or business data goes in it.
 */
export function playStoreUrl(app, { referrer } = {}) {
  const pkg = app?.android?.packageName;
  if (!pkg) return null;
  const url = new URL('https://play.google.com/store/apps/details');
  url.searchParams.set('id', pkg);
  if (referrer) url.searchParams.set('referrer', referrer);
  return url.toString();
}

/** Exact per-app web destination. Deep-link paths are deliberately not appended. */
export const webUrl = (app) => app?.web?.url || null;

/**
 * The store URL for a given OS, or null when there is none (desktop).
 */
export function storeUrlForOs(app, os, { referrer } = {}) {
  if (os === 'ios') return appStoreUrl(app);
  if (os === 'android') return playStoreUrl(app, { referrer });
  return null;
}
