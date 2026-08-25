import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, setHold } from '../lib/inventory';
import { RecordSummary, SerialSelect } from '../components/fields';

export function Hold({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const allowed = useCap(session, 'hold');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="hold" />;

  async function apply(hold: boolean) {
    setErr('');
    try {
      const next = await setHold(session, serial, hold, reason);
      setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
      setMsg(`${next.serial} status ${next.status}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <div className="card grid">
      <h1>Place / remove Hold</h1>
      <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      <label>
        Reason for change
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <div className="row">
        <button className="btn" type="button" disabled={!serial} onClick={() => void apply(true)}>
          Place Hold
        </button>
        <button className="btn btn-sec" type="button" disabled={!serial} onClick={() => void apply(false)}>
          Remove Hold
        </button>
      </div>
    </div>
  );
}
