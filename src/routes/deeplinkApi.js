import express from 'express';

import { getApp } from '../store/appsRepository.js';

/**
 * Deferred deep-link endpoints — CONTRACT STUBS.
 *
 * These exist so the request/response shape the pet-owner apps will consume is
 * locked now, while the two staff apps prove the rest of the mechanism. The
 * Flutter-side counterparts (Play Install Referrer read on Android, post-auth
 * identity lookup on iOS) are deliberately NOT built in this PoC — the referrer
 * API does not work on debug APKs, so wiring it would drag a Play internal-track
 * release into what is otherwise a local-tunnel exercise.
 *
 * What "deferred" means: the user taps a link, does not have the app, installs
 * it from the store, opens it — and still lands on the right screen. The link
 * has to survive a round trip through the App Store / Play Store, which strips
 * everything except (on Android) the install referrer.
 *
 * ## Android — deterministic
 * Play preserves the `referrer` query param through install. The app reads it
 * on first launch and POSTs it to /resolve.
 *
 * ## iOS — identity-based, not fingerprinting
 * There is no install referrer. Instead the app calls /pending after the user
 * authenticates, and the server returns any context queued against that
 * identity. Deterministic, no clipboard access, no IP/UA probabilistic matching
 * — and therefore unaffected by ATT and iCloud Private Relay, which is what
 * degraded Branch's accuracy on iOS in the first place.
 */

const router = express.Router();

/**
 * POST /api/deeplink/resolve
 * Body: { token: string }
 *
 * Token → link context. In production this reads a short-lived token table.
 * Here it parses the opaque `rl_<slug>_<path>` form minted by deepLink.js.
 */
router.post('/api/deeplink/resolve', express.json(), async (req, res, next) => {
  try {
    const token = String(req.body?.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'token is required' });
    }

    const match = /^rl_([a-z0-9-]+)(?:_(.*))?$/i.exec(token);
    if (!match) {
      return res.status(404).json({ error: 'unknown token', token });
    }

    const app = await getApp(match[1]);
    if (!app) {
      return res.status(404).json({ error: 'unknown app for token', token });
    }

    const path = (match[2] || '').replace(/_/g, '/');

    return res.json({
      token,
      slug: app.slug,
      path: path || null,
      // The pet-owner apps will expect a semantic target here rather than a raw
      // path — action + resource key. Shape is fixed now, population comes later.
      action: path ? path.split('/')[0] : null,
      resourceKey: path ? path.split('/').slice(1).join('/') || null : null,
      resolvedAt: new Date().toISOString(),
    });
  } catch (err) { next(err); }
});

/**
 * POST /api/deeplink/pending
 * Body: { identity: string, slug?: string }
 *
 * Identity → any pending invite / appointment / booking context queued for that
 * user. Called once on first launch after authentication.
 *
 * Returns 200 with `pending: null` rather than 404 when there is nothing — the
 * common case is "no pending link", and a 404 there would make every normal
 * launch log an error client-side.
 */
router.post('/api/deeplink/pending', express.json(), (req, res) => {
  const identity = String(req.body?.identity || '').trim();
  if (!identity) {
    return res.status(400).json({ error: 'identity is required' });
  }

  return res.json({
    identity,
    pending: null,
    checkedAt: new Date().toISOString(),
    note: 'PoC stub — no pending-context store is wired yet.',
  });
});

export default router;
