import { useEffect, useMemo, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, issueDispense } from '../lib/inventory';
import { shouldWarnFefo, isIssueBlocked } from '../lib/fefo';
import { todayIsoDateInTz } from '../lib/dates';
import { RecordSummary, SerialSelect } from '../components/fields';

export function IssueDispense({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [qty, setQty] = useState(0);
  const [dest, setDest] = useState('');
  const [reason, setReason] = useState('');
  const [override, setOverride] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const asOf = todayIsoDateInTz();
  const fefo = useMemo(() => (rec ? shouldWarnFefo(rec, rows, asOf) : { warn: false, earlier: [] }), [rec, rows, asOf]);
  const block = rec ? isIssueBlocked(rec, asOf) : { blocked: false, reason: '' };
  const allowed = useCap(session, 'issue');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="issue" />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const { rec: next, fefoWarning } = await issueDispense(session, serial, qty, dest, reason, override);
      setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
      setMsg(`Issued ${qty} ${next.uom} from ${next.serial}. ${fefoWarning}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <h1>Issue / dispense</h1>
      <p className="help">Only Released, non-expired stock may be issued. FEFO warning if an earlier-expiry Released lot exists.</p>
      <SerialSelect records={rows} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      {block.blocked && rec && <p className="err">{block.reason}</p>}
      {fefo.warn && (
        <p className="err">
          FEFO: earlier-expiry Released lots: {fefo.earlier.map((e) => `${e.serial} exp ${e.expiryDate}`).join(', ')}. Override reason required.
        </p>
      )}
      <label>
        Quantity
        <input type="number" step="0.0001" min="0" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
      </label>
      <label>
        Destination (order / batch / area)
        <input value={dest} onChange={(e) => setDest(e.target.value)} required />
      </label>
      <label>
        Reason
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} required />
      </label>
      {fefo.warn && (
        <label>
          FEFO override reason
          <textarea value={override} onChange={(e) => setOverride(e.target.value)} required />
        </label>
      )}
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn" type="submit" disabled={!serial || block.blocked}>
        Issue
      </button>
    </form>
  );
}
