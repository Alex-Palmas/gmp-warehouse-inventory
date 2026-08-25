import { useEffect, useState } from 'react';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, destroyContainer } from '../lib/inventory';
import { ESignModal } from '../components/ESignModal';
import { RecordSummary, SerialSelect } from '../components/fields';

export function Destruction({ session }: { session: Session }) {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [sign, setSign] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const allowed = useCap(session, 'destroy');
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="destroy" />;

  return (
    <div className="card grid">
      <h1>Destruction</h1>
      <p className="help">Logical status Destroyed. Record is retained. QA electronic signature required.</p>
      <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
      <RecordSummary rec={rec} />
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <button className="btn btn-danger" type="button" disabled={!serial} onClick={() => setSign(true)}>
        Sign and destroy
      </button>
      {sign && rec && (
        <ESignModal
          session={session}
          title="E-sign destruction"
          meaningDefault="I authorize destruction of this container. It must not be returned to stock."
          onCancel={() => setSign(false)}
          onSigned={async (esign, reason) => {
            try {
              const next = await destroyContainer(session, rec.serial, reason, esign);
              setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
              setMsg(`${next.serial} destroyed`);
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
