import { useEffect, useRef } from 'react';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { InventoryRecord } from '../types';
import { locationToString } from '../lib/dates';

export function LabelCanvases({ rec, size }: { rec: InventoryRecord; size: '2x1' | '4x2' }) {
  const barRef = useRef<SVGSVGElement>(null);
  const qrRef = useRef<HTMLCanvasElement>(null);
  const payload = `${rec.serial}|${rec.internalLot}|${rec.expiryDate}|${rec.status}|${rec.containerType}`;

  useEffect(() => {
    if (barRef.current) {
      JsBarcode(barRef.current, rec.serial, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 10,
        height: size === '2x1' ? 32 : 48,
        margin: 4,
        width: 1.2,
      });
    }
    if (qrRef.current) {
      QRCode.toCanvas(qrRef.current, payload, { width: size === '2x1' ? 64 : 96, margin: 0 });
    }
  }, [rec.serial, payload, size]);

  const dim = size === '2x1' ? { w: '2in', h: '1in' } : { w: '4in', h: '2in' };

  return (
    <div
      className="label-sheet"
      style={{
        width: dim.w,
        height: dim.h,
        border: '1px solid #000',
        padding: 4,
        fontSize: 9,
        display: 'flex',
        gap: 6,
        overflow: 'hidden',
        background: '#fff',
        color: '#000',
      }}
    >
      <div style={{ flex: 1 }}>
        <div className="mono" style={{ fontWeight: 700 }}>
          {rec.serial}
        </div>
        <div>
          {rec.materialCode} {rec.materialName}
        </div>
        <div>Lot {rec.internalLot} · Exp {rec.expiryDate}</div>
        <div>
          {rec.status} · {rec.containerType}
          {rec.containerIndex && rec.numberOfContainers
            ? ` ${rec.containerIndex}/${rec.numberOfContainers}`
            : ''}{' '}
          · {rec.storageCondition}
        </div>
        {rec.receiptBatchId && rec.receiptBatchId !== rec.serial && (
          <div>Batch {rec.receiptBatchId}</div>
        )}
        <div>{locationToString(rec.location)}</div>
        <svg ref={barRef} />
      </div>
      <canvas ref={qrRef} width={size === '2x1' ? 64 : 96} height={size === '2x1' ? 64 : 96} />
    </div>
  );
}

export function PrintLabels({ records, size }: { records: InventoryRecord[]; size: '2x1' | '4x2' }) {
  return (
    <div className="labels">
      {records.map((r) => (
        <LabelCanvases key={r.serial + size} rec={r} size={size} />
      ))}
    </div>
  );
}
