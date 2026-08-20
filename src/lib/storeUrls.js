import { portalUrlFor } from '../store/appsRepository.js';

/**
 * URL builders for every destination a link can end at.
 *
 * The `intent:` builder is the important one. On Android it replaces the
 * JavaScript "try the scheme, start a timer, fall back to the store" dance
 * entirely: Chrome resolves an intent URL natively, opening the app when it is
 * installed and following `S.browser_fallback_url` when it is not. No timer, no
 * error banner, no race. iOS has no equivalent, which is why only iOS is left
 * with the probe.
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

/**
 * Android `intent:` URL that opens the app if installed, else falls back.
 *
 * Format is Chrome's intent-scheme syntax. `S.browser_fallback_url` must be
 * URI-encoded or Chrome drops everything after the first `&`.
 */
export function androidIntentUrl(app, { deepLinkPath, fallbackUrl }) {
  const pkg = app?.android?.packageName;
  if (!pkg) return null;

  const scheme = app?.ios?.scheme || `runloyal${app.slug}`;
  const path = String(deepLinkPath || '').replace(/^\/+/, '');

  const parts = [
    `intent://${path}#Intent`,
    `scheme=${scheme}`,
    `package=${pkg}`,
    'action=android.intent.action.VIEW',
    'category=android.intent.category.BROWSABLE',
  ];
  if (fallbackUrl) {
    parts.push(`S.browser_fallback_url=${encodeURIComponent(fallbackUrl)}`);
  }
  return `${parts.join(';')};end`;
}

/**
 * Custom-scheme URL used by the iOS probe.
 *
 * This is a best-effort fallback, not the mechanism. It only ever runs when
 * the server received the request at all — meaning the Universal Link did not
 * fire (app absent, or opened somewhere UL is not honoured).
 */
export function customSchemeUrl(app, { deepLinkPath }) {
  const scheme = app?.ios?.scheme;
  if (!scheme) return null;
  const path = String(deepLinkPath || '').replace(/^\/+/, '');
  return `${scheme}://${path}`;
}

/** Web equivalent of the linked content, for desktop and `portal` behavior. */
export function portalUrl(app, { deepLinkPath } = {}) {
  const base = portalUrlFor(app);
  if (!base) return null;
  const path = String(deepLinkPath || '').replace(/^\/+/, '');
  if (!path) return base;
  return `${base.replace(/\/+$/, '')}/${path}`;
}

/**
 * The store URL for a given OS, or null when there is none (desktop).
 */
export function storeUrlForOs(app, os, { referrer } = {}) {
  if (os === 'ios') return appStoreUrl(app);
  if (os === 'android') return playStoreUrl(app, { referrer });
  return null;
}
