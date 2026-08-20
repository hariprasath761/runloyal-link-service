import { useState } from 'react';

import * as api from '../api.js';

/**
 * Legacy Branch short-code mappings.
 *
 * Links already sitting in pet owners' SMS and email history do not change when
 * Branch is switched off. Without these mappings every one of those messages
 * becomes a dead end, and there is no way to reach the people holding them —
 * which is why the requirement is to keep them resolvable for at least 12
 * months after generation flips to native.
 */
export default function LegacyCodes({ codes, apps, linkHost, onSaved, onError }) {
  const [code, setCode] = useState('');
  const [slug, setSlug] = useState(apps[0]?.slug || '');
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);

  async function add(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      await api.saveLegacyCode(code.trim(), { slug, path });
      setCode('');
      setPath('');
      onError('');
      await onSaved();
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(key) {
    try {
      await api.removeLegacyCode(key);
      await onSaved();
    } catch (err) {
      onError(err.message);
    }
  }

  const entries = Object.entries(codes);

  return (
    <section className="panel">
      <div className="panel__head">
        <h2>Legacy Branch codes</h2>
        <span className="pill">{entries.length} mapped</span>
      </div>
      <p className="note">
        Old Branch short codes resolved from this map and 302&rsquo;d onto the native link.
        Keep these alive for at least 12 months after link generation flips — do not cancel
        Branch on flip day.
      </p>

      <form className="legacyform" onSubmit={add}>
        <input
          placeholder="short code (e.g. a1b2c3)"
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
        <select value={slug} onChange={(e) => setSlug(e.target.value)}>
          {apps.map((a) => (
            <option key={a.slug} value={a.slug}>
              {a.displayName}
            </option>
          ))}
        </select>
        <input
          placeholder="target path (optional)"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button className="btn btn--primary" disabled={busy || !code.trim()}>
          Add
        </button>
      </form>

      {entries.length === 0 ? (
        <p className="empty">No legacy codes mapped.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Old link</th>
              <th>Resolves to</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map(([key, value]) => (
              <tr key={key}>
                <td>
                  <code>/{key}</code>
                  {value.note ? <small className="muted"> — {value.note}</small> : null}
                </td>
                <td>
                  <code>
                    https://{linkHost}/t/{value.slug}
                    {value.path ? `/${value.path}` : ''}
                  </code>
                </td>
                <td>
                  <button className="btn btn--ghost" onClick={() => remove(key)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
