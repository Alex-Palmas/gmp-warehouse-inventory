import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThemeToggle } from '../components/ThemeToggle';
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
    <div className="login-shell">
      <div className="banner">VALIDATION STATUS: {VALIDATION_BANNER}</div>
      <div className="login-top">
        <ThemeToggle />
      </div>
      <div className="page login-card">
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
            <p className="help">
              Presentation walkthrough: user ID <span className="mono">super</span> / password{' '}
              <span className="mono">Super123!xx</span>. After sign-in a View as bar lets you simulate each role.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
