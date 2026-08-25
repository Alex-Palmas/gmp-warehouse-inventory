import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listInventory, reprintLabel } from '../lib/inventory';
import { PrintLabels, LabelCanvases } from '../components/LabelPrint';
import { RecordSummary, SerialSelect } from '../components/fields';

export function LabelReprint({ session }: { session: Session }) {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState(sp.get('serial') ?? '');
  const [size, setSize] = useState<'2x1' | '4x2'>('4x2');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const allowed = useCap(session, 'reprintLabel');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  const selected = useMemo(() => (rec ? [rec] : []), [rec]);
  const autoDone = useRef(false);

  async function doPrint() {
    if (!rec || !allowed) return;
    try {
      await reprintLabel(session, rec.serial);
      setMsg(`PRINT_LABEL audited for ${rec.serial}`);
      window.print();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  useEffect(() => {
    if (autoDone.current) return;
    if (allowed && sp.get('autoprint') === '1' && rec) {
      autoDone.current = true;
      void doPrint();
    }
  }, [allowed, rec, sp]);

  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="reprintLabel" />;

  return (
    <div>
      <div className="card grid no-print">
        <h1>Label reprint</h1>
        <p className="help">Code 128 of serial (barcode payload). QR encodes serial|lot|expiry|status. Offline bundled libraries.</p>
        <SerialSelect records={rows} value={serial} onChange={setSerial} />
        <RecordSummary rec={rec} />
        <label>
          Size
          <select value={size} onChange={(e) => setSize(e.target.value as '2x1' | '4x2')}>
            <option value="2x1">2 × 1 in</option>
            <option value="4x2">4 × 2 in</option>
          </select>
        </label>
        {rec && (
          <div>
            <LabelCanvases rec={rec} size={size} />
          </div>
        )}
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="btn" type="button" disabled={!rec} onClick={() => void doPrint()}>
          Print (audited)
        </button>
      </div>
      <PrintLabels records={selected} size={size} />
    </div>
  );
}
