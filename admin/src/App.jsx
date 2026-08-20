import { useCallback, useEffect, useState } from 'react';

import * as api from './api.js';
import AppEditor from './components/AppEditor.jsx';
import LegacyCodes from './components/LegacyCodes.jsx';
import Login from './components/Login.jsx';
import Preview from './components/Preview.jsx';
import WellKnownPanel from './components/WellKnownPanel.jsx';

export default function App() {
  const [authed, setAuthed] = useState(Boolean(api.getToken()));
  const [config, setConfig] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('apps');

  const load = useCallback(async () => {
    try {
      const data = await api.fetchConfig();
      setConfig(data);
      setError('');
      // Keep the current selection across reloads so saving does not bounce
      // the operator back to the first app in the list.
      setSelected((prev) =>
        prev && data.apps.some((a) => a.slug === prev) ? prev : data.apps[0]?.slug || null,
      );
    } catch (err) {
      setError(err.message);
      if (/unauthorized/i.test(err.message)) setAuthed(false);
    }
  }, []);

  useEffect(() => {
    if (authed) load();
  }, [authed, load]);

  if (!authed) {
    return (
      <Login
        onAuthed={() => {
          setAuthed(true);
          setError('');
        }}
      />
    );
  }

  const app = config?.apps.find((a) => a.slug === selected) || null;

  return (
    <div className="shell">
      <header className="topbar">
        <div>
          <h1>Link Service</h1>
          <p className="topbar__host">{config?.linkHost || '…'}</p>
        </div>
        <nav className="tabs">
          {['apps', 'well-known', 'legacy'].map((t) => (
            <button
              key={t}
              className={tab === t ? 'tab tab--active' : 'tab'}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </nav>
        <button
          className="btn btn--ghost"
          onClick={() => {
            api.clearToken();
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>

      {error ? <div className="banner banner--error">{error}</div> : null}

      {tab === 'apps' ? (
        <div className="layout">
          <aside className="sidebar">
            <div className="sidebar__head">
              <span>Apps</span>
              <span className="count">{config?.apps.length ?? 0}</span>
            </div>
            <ul className="applist">
              {config?.apps.map((a) => (
                <li key={a.slug}>
                  <button
                    className={a.slug === selected ? 'applist__item applist__item--active' : 'applist__item'}
                    onClick={() => setSelected(a.slug)}
                  >
                    <span className="applist__icon">
                      {a.iconPath ? <img src={a.iconPath} alt="" /> : <i>{a.displayName[0]}</i>}
                    </span>
                    <span className="applist__text">
                      <strong>{a.displayName}</strong>
                      <small>/t/{a.slug}</small>
                    </span>
                    {/* Readiness at a glance: an app missing from a well-known
                        file is otherwise only discoverable via a device that
                        refuses to verify. */}
                    <span className="readiness">
                      <i
                        className={a.readiness.aasa ? 'dot dot--ok' : 'dot dot--bad'}
                        title={a.readiness.aasa ? 'In AASA' : 'Missing from AASA (needs Team ID)'}
                      />
                      <i
                        className={a.readiness.assetlinks ? 'dot dot--ok' : 'dot dot--bad'}
                        title={
                          a.readiness.assetlinks
                            ? 'In assetlinks.json'
                            : 'Missing from assetlinks.json (needs a SHA-256 fingerprint)'
                        }
                      />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <main className="main">
            {app ? (
              <>
                <AppEditor
                  key={app.slug}
                  app={app}
                  behaviors={config.behaviors}
                  platforms={config.platforms}
                  onSaved={load}
                  onError={setError}
                />
                <Preview app={app} linkHost={config.linkHost} />
              </>
            ) : (
              <p className="empty">No apps configured.</p>
            )}
          </main>
        </div>
      ) : null}

      {tab === 'well-known' ? <WellKnownPanel onError={setError} /> : null}

      {tab === 'legacy' ? (
        <LegacyCodes
          codes={config?.legacyCodes || {}}
          apps={config?.apps || []}
          linkHost={config?.linkHost}
          onSaved={load}
          onError={setError}
        />
      ) : null}
    </div>
  );
}
