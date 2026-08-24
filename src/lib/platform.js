/**
 * User-Agent classification.
 *
 * Order matters. A link opened inside the Instagram app reports an iOS or
 * Android UA *and* a webview marker, and the webview fact is the one that
 * changes what we render — so webview detection runs before OS detection is
 * allowed to decide the outcome. Likewise crawlers must be caught before
 * anything else, because a crawler that gets a 302 poisons the link preview
 * cached by Slack/iMessage/WhatsApp for everyone.
 */

export const PLATFORM = {
  IOS: 'ios',
  ANDROID: 'android',
  DESKTOP: 'desktop',
  CRAWLER: 'crawler',
  IN_APP_WEBVIEW: 'inAppWebview',
};

const CRAWLER_PATTERNS = [
  'facebookexternalhit',
  'facebookcatalog',
  'twitterbot',
  'slackbot',
  'slack-imgproxy',
  'linkedinbot',
  'whatsapp',
  'telegrambot',
  'discordbot',
  'pinterest',
  'redditbot',
  'googlebot',
  'bingbot',
  'applebot',
  'duckduckbot',
  'embedly',
  'quora link preview',
  'skypeuripreview',
  'nuzzel',
  'vkshare',
  'outbrain',
  'w3c_validator',
  'developers.google.com/+/web/snippet',
];

/**
 * In-app browser markers.
 *
 * `wv` is the Android WebView marker. `FBAN`/`FBAV` are Facebook, `Instagram`
 * is self-describing, `Line`/`MicroMessenger` cover LINE and WeChat. GmailApp
 * and the iOS Gmail UA both route through here.
 */
const WEBVIEW_PATTERNS = [
  'fban',
  'fbav',
  'fb_iab',
  'instagram',
  'line/',
  'micromessenger',
  'gmailapp',
  'gsa/', // Google Search App in-app browser
  'twitter',
  'linkedinapp',
  'snapchat',
  'pinterest/',
  'tiktok',
  'musical_ly',
];

/**
 * WhatsApp is both a crawler (link preview fetch) and an in-app browser. The
 * crawler fetch has no `Accept: text/html` with a browser-shaped UA, so the
 * crawler list wins — a human tapping through from WhatsApp opens the system
 * browser rather than a webview on both platforms.
 */
function isCrawler(ua) {
  return CRAWLER_PATTERNS.some((p) => ua.includes(p));
}

function isIos(ua) {
  // iPadOS 13+ reports a desktop Macintosh UA. There is no reliable
  // server-side way to tell that iPad from a real Mac, so it is treated as
  // desktop — which is the safe outcome: it renders the interstitial with a QR.
  return /iphone|ipod/.test(ua) || (/ipad/.test(ua) && !/macintosh/.test(ua));
}

const isAndroid = (ua) => ua.includes('android');

const isInAppWebview = (ua) =>
  WEBVIEW_PATTERNS.some((p) => ua.includes(p)) || /\bwv\b/.test(ua);

/**
 * Classifies a request.
 *
 * Returns both the routing bucket and the underlying OS, because an in-app
 * webview still needs to know which store badge to emphasise.
 *
 * @returns {{ platform: string, os: 'ios'|'android'|'desktop', forced: boolean }}
 */
export function detectPlatform(req) {
  const ua = String(req.get?.('user-agent') || req.headers?.['user-agent'] || '').toLowerCase();

  const os = isIos(ua) ? PLATFORM.IOS : isAndroid(ua) ? PLATFORM.ANDROID : PLATFORM.DESKTOP;

  // Admin preview drives the same code path as production so the preview
  // cannot drift from real behavior. Only the bucket is forced; the OS follows
  // it so store badges stay consistent.
  const forceRaw = String(req.query?.forcePlatform || '').trim();
  if (forceRaw) {
    const forced = Object.values(PLATFORM).find((p) => p.toLowerCase() === forceRaw.toLowerCase());
    if (forced) {
      const forcedOs =
        forced === PLATFORM.IOS || forced === PLATFORM.ANDROID ? forced : PLATFORM.DESKTOP;
      return { platform: forced, os: forcedOs, forced: true };
    }
  }

  if (isCrawler(ua)) return { platform: PLATFORM.CRAWLER, os, forced: false };
  if (os !== PLATFORM.DESKTOP && isInAppWebview(ua)) {
    return { platform: PLATFORM.IN_APP_WEBVIEW, os, forced: false };
  }

  return { platform: os, os, forced: false };
}

/**
 * Resolves behavior for a classified request.
 *
 * `crawler` and `inAppWebview` are not configurable — see the note in
 * store/schema.js for why.
 */
export function resolveBehavior(app, platform) {
  if (platform === PLATFORM.CRAWLER) return 'meta';
  if (platform === PLATFORM.IN_APP_WEBVIEW) return 'interstitial';

  if (platform === PLATFORM.DESKTOP) {
    return app?.web?.redirectDesktop && app?.web?.url ? 'portal' : 'interstitial';
  }

  // If an OS association was enabled and the compatible app was installed, the
  // OS opened it before this HTTP request existed. Reaching us on mobile means
  // the app is unavailable, so the deterministic fallback is the app store.
  return 'storeDirect';
}
