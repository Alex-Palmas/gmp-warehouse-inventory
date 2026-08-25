import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryRecord, Session } from '../types';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import { listInventory, samplePull } from '../lib/inventory';
import { RecordSummary, SerialSelect } from '../components/fields';
import { StatusBadge } from '../components/StatusBadge';

export function Samples({ session }: { session: Session }) {
  const allowed = useCap(session, 'samplePull');
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [qty, setQty] = useState(0);
  const [kind, setKind] = useState<'sample' | 'retain'>('sample');
  const [comments, setComments] = useState('');
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const children = rows.filter((r) => r.recordKind === 'sample' || r.recordKind === 'retain');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="samplePull" />;

  return (
    <div>
      <h1>Sampling</h1>
      <p className="help">
        Pull a sample or retain from an identified parent container (211.84). Child gets its own serial and
        barcode; parent currentQty is decremented. Sample/retain records are recordKind sample|retain with
        parentSerial set.
      </p>
      <form
        className="card grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try {
            const child = await samplePull(session, serial, qty, kind, comments);
            setRows((rs) => {
              const parent = rs.find((r) => r.serial === serial);
              const next = rs.map((r) =>
                r.serial === serial && parent
                  ? { ...r, currentQty: r.currentQty - qty, linkedSampleIds: child.serial }
                  : r,
              );
              return [child, ...next];
            });
            setMsg(`Created ${child.serial} (${kind}) from ${serial}`);
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Failed');
          }
        }}
      >
        <SerialSelect
          records={rows.filter((r) => (r.recordKind ?? 'container') === 'container' && !['Destroyed', 'Issued', 'Consumed'].includes(r.status))}
          value={serial}
          onChange={setSerial}
        />
        <RecordSummary rec={rec} />
        <div className="grid grid-3">
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as 'sample' | 'retain')}>
              <option value="sample">sample</option>
              <option value="retain">retain</option>
            </select>
          </label>
          <label>
            Qty taken
            <input type="number" min="0" step="0.0001" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
          </label>
          <label>
            Comments
            <input value={comments} onChange={(e) => setComments(e.target.value)} />
          </label>
        </div>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="btn" type="submit" disabled={!serial}>
          Pull {kind}
        </button>
      </form>
      <h2>Sample / retain records</h2>
      <table>
        <thead>
          <tr>
            <th>Serial</th>
            <th>Kind</th>
            <th>Parent</th>
            <th>Material</th>
            <th>Qty</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {children.map((r) => (
            <tr key={r.serial}>
              <td className="mono">
                <Link to={`/record/${r.serial}`}>{r.serial}</Link>
              </td>
              <td>{r.recordKind}</td>
              <td className="mono">
                {r.parentSerial ? <Link to={`/record/${r.parentSerial}`}>{r.parentSerial}</Link> : ''}
              </td>
              <td>
                {r.materialCode} {r.materialName}
              </td>
              <td>
                {r.currentQty} {r.uom}
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
