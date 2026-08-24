import { useState } from 'react';

import * as api from '../api.js';

export default function Login({ onAuthed }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(ev) {
    ev.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.login(email.trim(), password);
      onAuthed();
    } catch (err) {
      api.clearSession();
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <h1>Link Service Admin</h1>
        <p className="muted">Sign in with your authorized admin account.</p>
        <label className="field">
          <span>Email<b className="required-mark" aria-hidden="true">*</b></span>
          <input
            type="email"
            value={email}
            required
            autoFocus
            autoComplete="username"
            placeholder="admin@example.com"
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          <span>Password<b className="required-mark" aria-hidden="true">*</b></span>
          <input
            type="password"
            value={password}
            required
            autoComplete="current-password"
            placeholder="Password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error ? <p className="error">{error}</p> : null}
        <button className="btn btn--primary" disabled={busy || !email.trim() || !password}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
