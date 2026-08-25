import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Session } from '../types';
import { listByReceiptBatch, listInventory, reprintBatchLabels, reprintLabel } from '../lib/inventory';
import { PrintLabels, LabelCanvases } from '../components/LabelPrint';
import { RecordSummary, SerialSelect } from '../components/fields';

export function LabelReprint({ session }: { session: Session }) {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState(sp.get('serial') ?? '');
  const [selected, setSelected] = useState<string[]>([]);
  const [size, setSize] = useState<'2x1' | '4x2'>('4x2');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [batchSummary, setBatchSummary] = useState(false);
  const allowed = useCap(session, 'reprintLabel');
  const batchParam = sp.get('batch') ?? '';

  useEffect(() => {
    void listInventory().then(async (all) => {
      setRows(all);
      if (batchParam) {
        const sibs = await listByReceiptBatch(batchParam);
        setSelected(sibs.map((s) => s.serial));
        if (sibs[0]) setSerial(sibs[0].serial);
      }
    });
  }, [batchParam]);

  const rec = rows.find((r) => r.serial === serial);
  const toPrint = useMemo(() => {
    const set = new Set(selected.length ? selected : rec ? [rec.serial] : []);
    return rows.filter((r) => set.has(r.serial));
  }, [rows, selected, rec]);
  const autoDone = useRef(false);

  async function doPrint() {
    if (!toPrint.length || !allowed) return;
    try {
      if (batchParam && toPrint.length > 1) {
        await reprintBatchLabels(session, batchParam);
      } else {
        for (const r of toPrint) await reprintLabel(session, r.serial);
      }
      setMsg(`PRINT_LABEL audited for ${toPrint.map((r) => r.serial).join(', ')}`);
      window.print();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  useEffect(() => {
    if (autoDone.current) return;
    if (allowed && sp.get('autoprint') === '1' && toPrint.length) {
      autoDone.current = true;
      void doPrint();
    }
  }, [allowed, toPrint, sp]);

  async function loadBatch() {
    if (!rec?.receiptBatchId) return;
    const sibs = await listByReceiptBatch(rec.receiptBatchId);
    setSelected(sibs.map((s) => s.serial));
  }

  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="reprintLabel" />;

  return (
    <div>
      <div className="card grid no-print">
        <h1>Label reprint</h1>
        <p className="help">
          Code 128 of the container serial. QR encodes serial|lot|expiry|status|containerType. Print all N
          labels in a receipt batch (page-break each) or selected serials. Offline bundled libraries.
        </p>
        <SerialSelect records={rows} value={serial} onChange={setSerial} />
        <RecordSummary rec={rec} />
        <div className="row">
          <button className="btn btn-sec" type="button" disabled={!rec} onClick={() => void loadBatch()}>
            Select entire receipt batch
          </button>
          <label className="row">
            <input type="checkbox" checked={batchSummary} onChange={(e) => setBatchSummary(e.target.checked)} /> Include
            batch summary label
          </label>
        </div>
        {selected.length > 0 && (
          <p className="help">
            {selected.length} serial(s) selected.{' '}
            <button className="btn btn-sec" type="button" onClick={() => setSelected(rec ? [rec.serial] : [])}>
              This container only
            </button>
          </p>
        )}
        <label>
          Size
          <select value={size} onChange={(e) => setSize(e.target.value as '2x1' | '4x2')}>
            <option value="2x1">2 × 1 in</option>
            <option value="4x2">4 × 2 in</option>
          </select>
        </label>
        {toPrint[0] && (
          <div>
            <LabelCanvases rec={toPrint[0]} size={size} />
          </div>
        )}
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="btn" type="button" disabled={!toPrint.length} onClick={() => void doPrint()}>
          Print {toPrint.length || ''} label{toPrint.length === 1 ? '' : 's'} (audited)
        </button>
      </div>
      <PrintLabels records={toPrint} size={size} />
      {batchSummary && toPrint.length > 1 && toPrint[0] && (
        <div className="labels">
          <div className="label-sheet" style={{ width: '4in', padding: 8, border: '1px solid #000', pageBreakAfter: 'always' }}>
            <div className="mono" style={{ fontWeight: 700 }}>
              BATCH {toPrint[0].receiptBatchId}
            </div>
            <div>
              {toPrint[0].materialCode} {toPrint[0].materialName}
            </div>
            <div>
              {toPrint.length} × {toPrint[0].containerType} · Lot {toPrint[0].internalLot} · Exp {toPrint[0].expiryDate}
            </div>
            <div className="mono">{toPrint.map((r) => r.serial).join(', ')}</div>
          </div>
        </div>
      )}
    </div>
  );
}
