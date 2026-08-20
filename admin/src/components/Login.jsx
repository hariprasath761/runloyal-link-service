import { useState } from 'react';

import * as api from '../api.js';

export default function Login({ onAuthed }) {
  const [token, setTokenValue] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    api.setToken(token.trim());
    try {
      // Verify against a real endpoint rather than storing blindly — otherwise
      // a wrong token looks accepted until the first save fails.
      await api.fetchConfig();
      onAuthed();
    } catch (err) {
      api.clearToken();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <h1>Link Service Admin</h1>
        <p className="muted">Enter the ADMIN_TOKEN from the server&rsquo;s .env file.</p>
        <input
          type="password"
          value={token}
          autoFocus
          placeholder="ADMIN_TOKEN"
          onChange={(e) => setTokenValue(e.target.value)}
        />
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn--primary" disabled={busy || !token.trim()}>
          {busy ? 'Checking…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
