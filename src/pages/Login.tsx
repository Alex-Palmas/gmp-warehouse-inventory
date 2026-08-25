import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DOC_ID, DOC_VERSION, VALIDATION_BANNER, type Session } from '../types';
import { login } from '../lib/auth';

export function Login({ onLogin }: { onLogin: (s: Session) => void }) {
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const s = await login(userId, password);
      onLogin(s);
      nav('/');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Login failed');
    }
  }

  return (
    <div>
      <div className="banner">VALIDATION STATUS: {VALIDATION_BANNER}</div>
      <div className="page" style={{ maxWidth: 420 }}>
        <div className="card">
          <h1>GMP Warehouse Inventory</h1>
          <p className="help">
            {DOC_ID} v{DOC_VERSION} · Local system of record (IndexedDB). Demo passwords are in README
            only — change before any GMP use.
          </p>
          <form onSubmit={submit} className="grid">
            <label>
              User ID
              <input value={userId} onChange={(e) => setUserId(e.target.value)} autoComplete="username" required />
            </label>
            <label>
              Password
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </label>
            {err && <p className="err">{err}</p>}
            <button className="btn" type="submit">
              Sign in
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
