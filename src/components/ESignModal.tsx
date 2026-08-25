import { useState } from 'react';
import type { ESign, Session } from '../types';
import { nowUtcIso } from '../lib/dates';
import { reverifyPassword } from '../lib/auth';

export function ESignModal(props: {
  session: Session;
  title: string;
  meaningDefault: string;
  onCancel: () => void;
  onSigned: (esign: ESign, reason: string) => void;
  requireReason?: boolean;
}) {
  const [password, setPassword] = useState('');
  const [meaning, setMeaning] = useState(props.meaningDefault);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    if (props.requireReason !== false && !reason.trim()) {
      setErr('Reason for change is required');
      return;
    }
    if (!meaning.trim()) {
      setErr('Meaning of signature is required');
      return;
    }
    setBusy(true);
    const ok = await reverifyPassword(props.session.userId, password);
    setBusy(false);
    if (!ok) {
      setErr('Password re-verification failed');
      return;
    }
    props.onSigned(
      {
        userId: props.session.userId,
        printedName: props.session.fullName,
        signedAtUtc: nowUtcIso(),
        meaningOfSignature: meaning.trim(),
      },
      reason.trim(),
    );
  }

  return (
    <div className="modal-bg">
      <form className="modal" onSubmit={submit}>
        <h2>{props.title}</h2>
        <p className="help">
          21 CFR 11 electronic signature: re-enter password. Printed name, user ID, and datetime
          are captured from the authenticated session.
        </p>
        <div className="grid">
          <label>
            User ID
            <input value={props.session.userId} readOnly />
          </label>
          <label>
            Printed name
            <input value={props.session.fullName} readOnly />
          </label>
          <label>
            Password (re-enter)
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <label>
            Meaning of signature
            <textarea value={meaning} onChange={(e) => setMeaning(e.target.value)} required />
          </label>
          <label>
            Reason for change
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
          </label>
        </div>
        {err && <p className="err">{err}</p>}
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn" type="submit" disabled={busy}>
            Sign
          </button>
          <button className="btn btn-sec" type="button" onClick={props.onCancel}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
