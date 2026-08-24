import { useCallback, useEffect, useState } from 'react';

import * as api from './api.js';
import AddApp from './components/AddApp.jsx';
import AppEditor from './components/AppEditor.jsx';
import Login from './components/Login.jsx';
import Preview from './components/Preview.jsx';

export default function App() {
  const [authed, setAuthed] = useState(Boolean(api.getSession()));
  const [config, setConfig] = useState(null);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(async (preferredSlug = null) => {
    try {
      const data = await api.fetchConfig();
      setConfig(data);
      setError('');
      // Keep the current selection across reloads so saving does not bounce
      // the operator back to the first app in the list.
      setSelected((prev) =>
        preferredSlug && data.apps.some((a) => a.slug === preferredSlug)
          ? preferredSlug
          : prev && data.apps.some((a) => a.slug === prev)
            ? prev
            : data.apps[0]?.slug || null,
      );
    } catch (err) {
      setError(err.message);
      if (/session|sign in|authenticat|unauthorized/i.test(err.message)) setAuthed(false);
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
        <span className="topbar__user">{config?.admin?.email || ''}</span>
        <button
          className="btn btn--ghost"
          onClick={() => {
            api.clearSession();
            setAuthed(false);
          }}
        >
          Sign out
        </button>
      </header>

      {error ? <div className="banner banner--error">{error}</div> : null}

      <div className="layout">
          <aside className="sidebar">
            <div className="sidebar__head">
              <span>Apps</span>
              <span className="sidebar__actions">
                <span className="count">{config?.apps.length ?? 0}</span>
                <button className="btn btn--small btn--primary" onClick={() => setAdding(true)}>
                  Add app
                </button>
              </span>
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
                      <small>/app/{a.slug}</small>
                      {!a.enabled ? <em className="draft">Draft</em> : null}
                    </span>
                    {/* Readiness at a glance: an app missing from a well-known
                        file is otherwise only discoverable via a device that
                        refuses to verify. */}
                    <span className="readiness">
                      <i
                        className={a.readiness.aasa ? 'dot dot--ok' : 'dot dot--bad'}
                        title={
                          a.readiness.aasa
                            ? 'In AASA'
                            : !a.nativeDeepLinkEnabled
                              ? 'Not in AASA (native opening is disabled)'
                              : `Not in AASA (${a.readiness.native.missing.join(', ')})`
                        }
                      />
                      <i
                        className={a.readiness.assetlinks ? 'dot dot--ok' : 'dot dot--bad'}
                        title={
                          a.readiness.assetlinks
                            ? 'In assetlinks.json'
                            : !a.nativeDeepLinkEnabled
                              ? 'Not in assetlinks.json (native opening is disabled)'
                              : `Not in assetlinks.json (${a.readiness.native.missing.join(', ')})`
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

      {adding ? (
        <AddApp
          onClose={() => setAdding(false)}
          onError={setError}
          onCreated={async (slug) => {
            await load(slug);
            setAdding(false);
          }}
        />
      ) : null}
    </div>
  );
}
