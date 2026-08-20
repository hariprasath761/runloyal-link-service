import { useState } from 'react';

/**
 * Live preview of the real interstitial.
 *
 * The iframe hits the actual `/t/:slug` route with `?forcePlatform=`, which
 * drives the same code path production traffic takes. That is deliberate: a
 * preview that rendered its own approximation of the page would drift from the
 * real one exactly when it mattered.
 */

const VIEWS = [
  { key: 'ios', label: 'iOS', width: 390 },
  { key: 'android', label: 'Android', width: 412 },
  { key: 'desktop', label: 'Desktop', width: 1040 },
  { key: 'inAppWebview', label: 'In-app webview', width: 390 },
  { key: 'crawler', label: 'Crawler', width: 640 },
];

export default function Preview({ app, linkHost }) {
  const [view, setView] = useState('desktop');
  const [path, setPath] = useState('');

  const active = VIEWS.find((v) => v.key === view);
  const suffix = path.replace(/^\/+/, '');
  const src = `/t/${app.slug}${suffix ? `/${suffix}` : ''}?forcePlatform=${view}`;
  const publicUrl = `https://${linkHost}/t/${app.slug}${suffix ? `/${suffix}` : ''}`;

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Preview</h2>
        <code className="publicurl">{publicUrl}</code>
      </div>

      <div className="previewbar">
        <div className="segmented">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              className={v.key === view ? 'segmented__btn segmented__btn--active' : 'segmented__btn'}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <input
          className="pathinput"
          value={path}
          placeholder="appointment/9d7e4f2a"
          onChange={(e) => setPath(e.target.value)}
        />
      </div>

      <p className="note">
        {view === 'crawler'
          ? 'Crawlers always get meta tags and never a redirect — a 302 here gets cached by Slack, iMessage and WhatsApp, and every link preview on the domain stays broken until it expires.'
          : view === 'inAppWebview'
            ? 'In-app webviews always get the download page plus an “Open in browser” escape hatch, because Universal Links do not fire inside them at all.'
            : `Behaviour: ${app.behavior[view]}. A redirect will navigate the frame below rather than render.`}
      </p>

      <div className="previewframe" style={{ maxWidth: active.width }}>
        <iframe key={src} src={src} title="Interstitial preview" />
      </div>
    </section>
  );
}
