import express from 'express';

import { publicBaseUrl } from '../config.js';
import { getApp, getLegacyCode } from '../store/appsRepository.js';

/**
 * `GET /:code` — legacy Branch short-code resolution.
 *
 * Links already sitting in pet owners' SMS and email history do not change when
 * Branch is switched off. If the old short codes stop resolving, every one of
 * those messages becomes a dead end, and there is no way to reach the people
 * holding them.
 *
 * So the codes are mapped locally and 302'd onto the equivalent native link.
 * Requirements call for keeping this alive for a minimum of 12 months after the
 * generation flip.
 *
 * This router mounts LAST. A bare `/:code` pattern would otherwise swallow
 * `/admin`, `/api/...` and the well-known paths.
 */

const router = express.Router();

// Codes are short and opaque. Anything longer or containing a dot is far more
// likely to be a stray asset request than a Branch code, and matching it would
// turn every 404 for a missing file into a confusing redirect.
const CODE_RE = /^[A-Za-z0-9_-]{1,24}$/;

router.get('/:code', async (req, res, next) => {
  const code = String(req.params.code || '');
  if (!CODE_RE.test(code)) return next();

  const mapping = await getLegacyCode(code);
  if (!mapping) return next();

  const app = await getApp(mapping.slug);
  if (!app || !app.enabled) {
    return res.status(404).render('not-found', {
      slug: mapping.slug,
      reason: 'This legacy link points at an app that is no longer available.',
    });
  }

  const path = String(mapping.path || '').replace(/^\/+/, '');
  const target = `${publicBaseUrl()}/t/${app.slug}${path ? `/${path}` : ''}`;

  // 302 rather than 301: these mappings are editable from the admin UI, and a
  // permanent redirect would be cached in browsers past any correction.
  return res.redirect(302, target);
});

export default router;
