import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, QaDisposition, Session } from '../types';
import { QA_DISPOSITIONS } from '../types';
import { listInventory, qaDisposition } from '../lib/inventory';
import { ESignModal } from '../components/ESignModal';
import { RecordSummary, SerialSelect } from '../components/fields';

export function QADisposition({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [disp, setDisp] = useState<QaDisposition>('Release');
  const [sign, setSign] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const allowed = useCap(session, 'qaDisposition');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="qaDisposition" />;

  return (
    <div>
      <h1>QA disposition</h1>
      <p className="help">Electronic signature required. Warehouse operators cannot release stock.</p>
      <div className="card grid">
        <SerialSelect records={rows.filter((r) => !['Destroyed', 'Issued', 'Consumed'].includes(r.status))} value={serial} onChange={setSerial} />
        <RecordSummary rec={rec} />
        <label>
          Disposition
          <select value={disp} onChange={(e) => setDisp(e.target.value as QaDisposition)}>
            {QA_DISPOSITIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
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
          title={`E-sign: ${disp}`}
          meaningDefault={
            disp === 'Release'
              ? 'I attest this container meets specification and is Released for GMP use.'
              : disp === 'Reject'
                ? 'I attest this container is Rejected and must not be used in production.'
                : 'I attest this container is Restricted; use only as documented in the reason.'
          }
          onCancel={() => setSign(false)}
          onSigned={async (esign, reason) => {
            setErr('');
            try {
              const next = await qaDisposition(session, rec.serial, disp, esign, reason);
              setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
              setMsg(`${next.serial} is now ${next.status}`);
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
