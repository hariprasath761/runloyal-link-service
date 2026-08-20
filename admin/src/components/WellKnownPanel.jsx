import { useEffect, useState } from 'react';

import * as api from '../api.js';

/**
 * Exactly what the two association files currently contain.
 *
 * Surfaced in the admin because both files fail silently: there is no error
 * anywhere when an app is missing from one of them, only links that quietly
 * open the browser. Seeing the generated JSON is the fastest way to tell the
 * difference between "not configured" and "not working".
 */
export default function WellKnownPanel({ onError }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    api.fetchWellKnown().then(setData).catch((e) => onError(e.message));
  }, [onError]);

  if (!data) return <p className="empty">Loading…</p>;

  const kb = (n) => `${(n / 1024).toFixed(1)} KB`;

  return (
    <div className="wellknown">
      <section className="panel">
        <div className="panel__head">
          <h2>apple-app-site-association</h2>
          <span className={data.aasaOverWarn ? 'pill pill--warn' : 'pill'}>
            {kb(data.aasaBytes)} / {kb(data.aasaLimitBytes)}
          </span>
        </div>
        <p className="note">
          Apple&rsquo;s hard limit is 128 KB. At roughly 170 bytes per minified entry, 300
          tenants land around 50–55 KB; plan a second host before ~550. Served without a{' '}
          <code>.json</code> extension, as <code>application/json</code>, with zero redirects.
        </p>
        <pre>{JSON.stringify(data.aasa, null, 2)}</pre>
      </section>

      <section className="panel">
        <div className="panel__head">
          <h2>assetlinks.json</h2>
          <span className="pill">{data.assetlinks.length} statements</span>
        </div>
        <p className="note">
          Apps without a SHA-256 fingerprint are omitted entirely rather than emitted with an
          empty array — one malformed statement can invalidate the whole file and take every
          other app on the domain down with it.
        </p>
        <pre>{JSON.stringify(data.assetlinks, null, 2)}</pre>
      </section>
    </div>
  );
}
