import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, returnToStock } from '../lib/inventory';
import { RecordSummary, SerialSelect } from '../components/fields';

export function ReturnToStock({ session }: { session: Session }) {
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
  const allowed = useCap(session, 'returnToStock');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="returnToStock" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const next = await returnToStock(session, serial, qty, reason);
      setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
      setMsg(`Returned ${qty} to ${next.serial}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <h1>Return to stock</h1>
      <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      <label>
        Quantity returned
        <input type="number" step="0.0001" min="0" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
      </label>
      <label>
        Reason for change
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" type="submit" disabled={!serial}>
        Return
      </button>
    </form>
  );
}
