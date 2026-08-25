import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, cycleCount } from '../lib/inventory';
import { RecordSummary, SerialSelect } from '../components/fields';

export function CycleCount({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [qty, setQty] = useState(0);
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const allowed = useCap(session, 'cycleCount');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="cycleCount" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const next = await cycleCount(session, serial, qty, reason);
      setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
      setMsg(`Adjusted ${next.serial} to ${next.currentQty} ${next.uom}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <h1>Cycle count / quantity adjustment</h1>
      <p className="help">Reason for change is required. No hard-delete; quantity is adjusted in place.</p>
      <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      <label>
        Counted quantity
        <input type="number" step="0.0001" min="0" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
      </label>
      <label>
        Reason for change
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" type="submit" disabled={!serial}>
        Adjust quantity
      </button>
    </form>
  );
}
