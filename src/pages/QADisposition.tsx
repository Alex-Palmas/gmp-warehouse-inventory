import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, QaDisposition, Session } from '../types';
import { QA_DISPOSITIONS } from '../types';
import { listByReceiptBatch, listInventory, qaDisposition } from '../lib/inventory';
import { ESignModal } from '../components/ESignModal';
import { RecordSummary, SerialSelect } from '../components/fields';
import { StatusBadge } from '../components/StatusBadge';

export function QADisposition({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [disp, setDisp] = useState<QaDisposition>('Release');
  const [scope, setScope] = useState<'batch' | 'container'>('batch');
  const [siblings, setSiblings] = useState<InventoryRecord[]>([]);
  const [sign, setSign] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  useEffect(() => {
    if (!rec?.receiptBatchId) {
      setSiblings([]);
      return;
    }
    void listByReceiptBatch(rec.receiptBatchId).then(setSiblings);
  }, [rec?.receiptBatchId, rec?.serial]);
  useEffect(() => {
    if (disp === 'Release') setScope('batch');
  }, [disp]);
  const allowed = useCap(session, 'qaDisposition');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="qaDisposition" />;

  const qSiblings = siblings.filter((s) => s.status === 'Quarantine' && (s.recordKind ?? 'container') === 'container');

  return (
    <div>
      <h1>QA disposition</h1>
      <p className="help">
        Electronic signature required. Default: one e-sign Releases all Quarantine sibling containers in the
        receipt batch (211.84 lot release). Single-container Reject/Restricted is allowed for damage.
      </p>
      <div className="card grid">
        <SerialSelect records={rows.filter((r) => !['Destroyed', 'Issued', 'Consumed'].includes(r.status))} value={serial} onChange={setSerial} />
        <RecordSummary rec={rec} />
        {rec && (
          <p className="help">
            Receipt batch <span className="mono">{rec.receiptBatchId}</span> · container {rec.containerIndex} of{' '}
            {rec.numberOfContainers} · {qSiblings.length} Quarantine sibling(s)
          </p>
        )}
        {siblings.length > 1 && (
          <table>
            <thead>
              <tr>
                <th>Serial</th>
                <th>Index</th>
                <th>Qty</th>
                <th>Status</th>
                <th>Kind</th>
              </tr>
            </thead>
            <tbody>
              {siblings.map((s) => (
                <tr key={s.serial} className={s.serial === serial ? 'highlight' : ''}>
                  <td className="mono">{s.serial}</td>
                  <td>
                    {s.containerIndex}/{s.numberOfContainers}
                  </td>
                  <td>
                    {s.currentQty} {s.uom}
                  </td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>{s.recordKind ?? 'container'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <label>
          Disposition
          <select value={disp} onChange={(e) => setDisp(e.target.value as QaDisposition)}>
            {QA_DISPOSITIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Scope
          <select value={scope} onChange={(e) => setScope(e.target.value as 'batch' | 'container')}>
            <option value="batch">Entire receipt batch (all eligible Quarantine siblings)</option>
            <option value="container">This container only</option>
          </select>
        </label>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="btn" type="button" disabled={!serial} onClick={() => setSign(true)}>
          Sign and apply
        </button>
      </div>
      {sign && rec && (
        <ESignModal
          session={session}
          title={`E-sign: ${disp} (${scope === 'batch' ? 'receipt batch' : 'single container'})`}
          meaningDefault={
            disp === 'Release'
              ? scope === 'batch'
                ? 'I attest the containers in this receipt batch meet specification and are Released for GMP use.'
                : 'I attest this container meets specification and is Released for GMP use.'
              : disp === 'Reject'
                ? 'I attest this container is Rejected and must not be used in production.'
                : 'I attest this container is Restricted; use only as documented in the reason.'
          }
          onCancel={() => setSign(false)}
          onSigned={async (esign, reason) => {
            setErr('');
            try {
              const next = await qaDisposition(session, rec.serial, disp, esign, reason, scope);
              setRows((rs) => rs.map((r) => next.find((n) => n.serial === r.serial) ?? r));
              setMsg(`${next.map((n) => n.serial).join(', ')} → ${next[0]?.status}`);
              setSign(false);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : 'Failed');
            }
          }}
        />
      )}
    </div>
  );
}
