import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Session } from '../types';
import { DOC_ID, DOC_VERSION, VALIDATION_BANNER } from '../types';
import { changeOwnPassword } from '../lib/auth';
import { validatePasswordPolicy } from '../lib/passwordPolicy';

export function ChangePassword({
  session,
  onChanged,
}: {
  session: Session;
  onChanged: (s: Session) => void;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [err, setErr] = useState('');
  const nav = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (next !== confirm) {
      setErr('New password and confirmation do not match');
      return;
    }
    const policy = validatePasswordPolicy(session.userId, next);
    if (policy.length) {
      setErr(policy[0]);
      return;
    }
    try {
      const s = await changeOwnPassword(session, current, next);
      onChanged(s);
      nav('/');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Change failed');
    }
  }

  return (
    <div>
      <div className="banner">VALIDATION STATUS: {VALIDATION_BANNER} | {DOC_ID} v{DOC_VERSION}</div>
      <div className="page" style={{ maxWidth: 480 }}>
        <div className="card">
          <h1>Change password</h1>
          <p className="help">
            Part 11 11.10(d): temporary and expired passwords must be changed before warehouse
            activity. Minimum 12 characters with upper, lower, digit, and special. Not equal to user
            ID. Not one of the last 4 passwords.
          </p>
          <form onSubmit={submit} className="grid">
            <label>
              User ID
              <input value={session.userId} readOnly />
            </label>
            <label>
              Current password
              <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" />
            </label>
            <label>
              New password
              <input type="password" value={next} onChange={(e) => setNext(e.target.value)} required autoComplete="new-password" />
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" />
            </label>
            {err && <p className="err">{err}</p>}
            <button className="btn" type="submit">
              Change password
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
