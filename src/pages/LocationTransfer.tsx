import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Location, Session } from '../types';
import { listInventory, transferLocation } from '../lib/inventory';
import { LocationFields, RecordSummary, SerialSelect, emptyLocation } from '../components/fields';

export function LocationTransfer({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [loc, setLoc] = useState<Location>(emptyLocation());
  const [reason, setReason] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  useEffect(() => {
    if (rec) setLoc(rec.location);
  }, [serial]);
  const allowed = useCap(session, 'transfer');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="transfer" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const next = await transferLocation(session, serial, loc, reason);
      setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
      setMsg(`Moved ${next.serial}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <h1>Location transfer</h1>
      <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      <LocationFields value={loc} onChange={setLoc} />
      <label>
        Reason for change
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" type="submit" disabled={!serial}>
        Transfer
      </button>
    </form>
  );
}
