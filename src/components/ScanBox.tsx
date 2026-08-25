import { useRef, useState } from 'react';
import type { Session } from '../types';
import { useLocation, useNavigate } from 'react-router-dom';
import { parseScanPayload } from '../lib/serial';
import { isLocationCode } from '../lib/locations';
import { scanErr, scanOk } from '../lib/scanFeedback';
import { appendAudit } from '../lib/audit';
import { loadSession } from '../lib/auth';

export const SCAN_EVENT = 'gmp-wh-scan';

export function ScanBox({ session }: { session?: Session } = {}) {
  const [v, setV] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const ref = useRef<HTMLInputElement>(null);
  const onPick = loc.pathname.startsWith('/requests');
  const onTransfer = loc.pathname.startsWith('/transfer');

  function onKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const s = parseScanPayload(v);
    if (!s) {
      scanErr('Empty scan');
      return;
    }
    window.dispatchEvent(
      new CustomEvent(SCAN_EVENT, { detail: { serial: s, locationCode: isLocationCode(s) ? s : undefined } }),
    );
    if (!isLocationCode(s)) {
      const ssn = session ?? loadSession();
      if (ssn) {
        void appendAudit(ssn, {
          action: 'SCAN',
          recordId: s,
          field: 'scan',
          newValue: s,
          reasonForChange: 'Barcode scan',
        });
      }
    }
    if (!onPick && !onTransfer) {
      if (isLocationCode(s)) {
        scanOk(s);
        nav(`/transfer?loc=${encodeURIComponent(s)}`);
      } else {
        scanOk(s);
        nav(`/scan?serial=${encodeURIComponent(s)}`);
      }
    }
    setV('');
  }

  const placeholder = onPick
    ? 'Scan serial to add to open request, then Enter'
    : onTransfer
      ? 'Scan container serial, then location barcode LOC-…'
      : 'HID scanner or type serial / LOC-…, then Enter';

  return (
    <div className="scan no-print">
      <span className="mono">SCAN</span>
      <input
        ref={ref}
        placeholder={placeholder}
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={onKey}
        aria-label="Barcode scan lookup"
      />
    </div>
  );
}
