import { useState } from 'react';

import * as api from '../api.js';

export default function AddApp({ onClose, onCreated, onError }) {
  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    try {
      const app = await api.createApp({ slug, displayName, enabled: false });
      onError('');
      await onCreated(app.slug);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="modal__card" onSubmit={submit}>
        <div className="panel__head">
          <div>
            <h2>Add app</h2>
            <p className="note">This creates a disabled draft. Add native platform details before publishing it.</p>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
        </div>
        <label className="field">
          <span>Slug</span>
          <input
            autoFocus
            required
            value={slug}
            placeholder="tenant-name"
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
          <small>Becomes /app/tenant-name and cannot be changed after creation.</small>
        </label>
        <label className="field">
          <span>Display name</span>
          <input required value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <div className="modal__actions">
          <button className="btn btn--primary" disabled={busy || !slug.trim() || !displayName.trim()}>
            {busy ? 'Creating…' : 'Create draft'}
          </button>
        </div>
      </form>
    </div>
  );
}
