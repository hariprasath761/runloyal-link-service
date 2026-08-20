import express from 'express';

import { publicBaseUrl } from '../config.js';
import { qrSvg } from '../lib/qr.js';
import { PLATFORM, detectPlatform, resolveBehavior } from '../lib/platform.js';
import {
  androidIntentUrl,
  appStoreUrl,
  customSchemeUrl,
  playStoreUrl,
  portalUrl,
  storeUrlForOs,
} from '../lib/storeUrls.js';
import { getApp } from '../store/appsRepository.js';

/**
 * `GET /t/:slug/*` — the link itself.
 *
 * ## When this handler does NOT run
 *
 * The best outcome for an installed app is that this code never executes. A
 * Universal Link or App Link tapped from Messages, Mail, or another native app
 * is intercepted by the OS before any network request is made, and the app
 * opens directly. The server sees nothing.
 *
 * So every request that *does* arrive here means one of:
 *   - the app is not installed, or
 *   - the link was opened somewhere Universal Links do not fire — pasted into
 *     Chrome's address bar, inside an Instagram/WhatsApp webview, or on iOS
 *     after the user once chose "open in Safari" (which latches a per-domain
 *     declined flag until they long-press and pick Open in App).
 *
 * That is why the scheme probe below is a fallback and not the mechanism.
 */

const router = express.Router();

/** The path after `/t/<slug>`, e.g. `appointment/9d7e4f2a`. */
function deepLinkPathFrom(req, slug) {
  const full = req.path.replace(/^\/+/, '');
  const prefix = `t/${slug}`;
  const rest = full.startsWith(prefix) ? full.slice(prefix.length) : '';
  return rest.replace(/^\/+/, '');
}

/** Absolute canonical URL for this link — what the QR encodes. */
function canonicalUrl(slug, deepLinkPath) {
  const suffix = deepLinkPath ? `/${deepLinkPath}` : '';
  return `${publicBaseUrl()}/t/${slug}${suffix}`;
}

/**
 * Opaque referrer token for the Play Install Referrer path.
 *
 * Deliberately just the slug and path — no PII, no business data. The real
 * context is resolved server-side via /api/deeplink/resolve after install.
 */
const referrerToken = (slug, deepLinkPath) =>
  `rl_${slug}${deepLinkPath ? `_${deepLinkPath.replace(/[^a-z0-9]+/gi, '_')}` : ''}`.slice(0, 96);

/**
 * Builds the full view model shared by every render path, so the interstitial
 * template and the admin preview cannot diverge.
 */
export async function buildLinkContext(req, app, deepLinkPath) {
  const { platform, os, forced } = detectPlatform(req);
  const behavior = resolveBehavior(app, platform);

  const canonical = canonicalUrl(app.slug, deepLinkPath);
  const referrer = referrerToken(app.slug, deepLinkPath);

  const ios = appStoreUrl(app);
  const android = playStoreUrl(app, { referrer });
  const portal = portalUrl(app, { deepLinkPath });

  // Android's intent URL falls back to the Play Store by itself. iOS gets a
  // scheme probe with a timer because it has no equivalent primitive.
  const intent = androidIntentUrl(app, {
    deepLinkPath,
    fallbackUrl: android || portal || canonical,
  });
  const scheme = customSchemeUrl(app, { deepLinkPath });

  return {
    app,
    deepLinkPath,
    platform,
    os,
    forced,
    behavior,
    canonicalUrl: canonical,
    storeUrl: storeUrlForOs(app, os, { referrer }),
    appStoreUrl: ios,
    playStoreUrl: android,
    portalUrl: portal,
    intentUrl: intent,
    schemeUrl: scheme,
    // Only probe when the operator asked for it AND we have something to probe.
    probe: app.openAppIfInstalled
      ? { ios: os === PLATFORM.IOS ? scheme : null, android: os === PLATFORM.ANDROID ? intent : null }
      : { ios: null, android: null },
    qr: await qrSvg(canonical),
    iconUrl: app.iconPath || null,
    isInAppWebview: platform === PLATFORM.IN_APP_WEBVIEW,
  };
}

/** Renders the download page. */
function renderInterstitial(res, ctx, status = 200) {
  res.status(status).render('interstitial', ctx);
}

// Two explicit paths rather than one wildcard: Express 4's `*` does not match
// an empty segment, so `/t/kennel` (no action) would 404 under `/t/:slug/*`
// alone. `/t/kennel` is a legitimate link — it is the plain "download the app"
// case, which is exactly what the current Branch link does.
router.get(['/t/:slug', '/t/:slug/*'], async (req, res, next) => {
  try {
    const slug = String(req.params.slug || '').toLowerCase();
    const app = await getApp(slug);

    if (!app || !app.enabled) {
      return res.status(404).render('not-found', {
        slug,
        reason: app ? 'This app link is currently disabled.' : 'Unknown app link.',
      });
    }

    const deepLinkPath = deepLinkPathFrom(req, slug);
    const ctx = await buildLinkContext(req, app, deepLinkPath);

    // A crawler must always get meta tags and never a redirect — a 302 here
    // gets cached by Slack/iMessage/WhatsApp and the preview stays broken.
    if (ctx.behavior === 'meta') {
      return res.status(200).render('meta', ctx);
    }

    if (ctx.behavior === 'portal') {
      if (ctx.portalUrl) return res.redirect(302, ctx.portalUrl);
      // Configured for portal but no URL set — render rather than 500.
      return renderInterstitial(res, ctx);
    }

    if (ctx.behavior === 'storeDirect') {
      // With openAppIfInstalled on, Android still goes through the intent URL:
      // Chrome opens the app when present and follows browser_fallback_url to
      // Play when it is not. Strictly better than redirecting straight to Play.
      if (ctx.os === PLATFORM.ANDROID && app.openAppIfInstalled && ctx.intentUrl) {
        return res.redirect(302, ctx.intentUrl);
      }
      if (ctx.storeUrl) return res.redirect(302, ctx.storeUrl);
      return renderInterstitial(res, ctx);
    }

    return renderInterstitial(res, ctx);
  } catch (err) {
    next(err);
  }
});

export default router;
