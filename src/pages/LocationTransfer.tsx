import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Location, Session } from '../types';
import { listInventory, transferLocation } from '../lib/inventory';
import { LocationFields, RecordSummary, SerialSelect, emptyLocation } from '../components/fields';
import { locationToString } from '../lib/dates';
import { isLocationCode, locationCode, resolveLocationScan, SEEDED_LOCATIONS, uniqueLocations } from '../lib/locations';
import { SCAN_EVENT } from '../components/ScanBox';
import { parseScanPayload } from '../lib/serial';
import { scanErr, scanOk } from '../lib/scanFeedback';

export function LocationTransfer({ session }: { session: Session }) {
  const [sp] = useSearchParams();
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [serial, setSerial] = useState('');
  const [loc, setLoc] = useState<Location>(emptyLocation());
  const [reason, setReason] = useState('Putaway / location transfer');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [printLocs, setPrintLocs] = useState(false);
  const allowed = useCap(session, 'transfer');

  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const rec = rows.find((r) => r.serial === serial);
  useEffect(() => {
    if (rec) setLoc(rec.location);
  }, [serial]);

  const known = useMemo(() => uniqueLocations(rows), [rows]);
  useEffect(() => {
    const q = sp.get('loc');
    if (!q) return;
    const resolved = resolveLocationScan(q, known);
    if (resolved) setLoc(resolved);
  }, [sp, known]);

  useEffect(() => {
    function onScan(e: Event) {
      const d = (e as CustomEvent<{ serial: string; locationCode?: string }>).detail;
      const raw = parseScanPayload(d?.serial ?? '');
      if (!raw) return;
      if (isLocationCode(raw) || d?.locationCode) {
        const resolved = resolveLocationScan(d.locationCode || raw, known);
        if (!resolved) {
          scanErr('Unknown location barcode');
          setErr('Unknown location barcode');
          return;
        }
        setLoc(resolved);
        if (serial) {
          void transferLocation(session, serial, resolved, reason || 'Putaway scan')
            .then((next) => {
              setRows((rs) => rs.map((r) => (r.serial === next.serial ? next : r)));
              setMsg(`Moved ${next.serial} → ${locationToString(next.location)}`);
              scanOk(`Putaway ${next.serial}`);
            })
            .catch((ex) => {
              const m = ex instanceof Error ? ex.message : 'Transfer failed';
              setErr(m);
              scanErr(m);
            });
        } else {
          scanOk(locationCode(resolved));
          setMsg(`Location ${locationCode(resolved)} — scan a container serial next`);
        }
        return;
      }
      const found = rows.find((r) => r.serial === raw);
      if (!found) {
        scanErr(`No record for ${raw}`);
        setErr(`No record for ${raw}`);
        return;
      }
      setSerial(raw);
      setLoc(found.location);
      scanOk(raw);
      setMsg(`${raw} selected — scan a location barcode to move`);
    }
    window.addEventListener(SCAN_EVENT, onScan);
    return () => window.removeEventListener(SCAN_EVENT, onScan);
  }, [known, rows, serial, session, reason]);

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

  const locList = known.length ? known : SEEDED_LOCATIONS;

  return (
    <div>
      <form className="card grid no-print" onSubmit={submit}>
        <h1>Location transfer / putaway</h1>
        <p className="help">
          Scan container serial, then scan a location barcode (LOC-SITE-BLDG-ROOM-RACK-SHELF-BIN) to move.
          Print location labels below for bin faces.
        </p>
        <SerialSelect records={rows.filter((r) => r.status !== 'Destroyed')} value={serial} onChange={setSerial} />
        <RecordSummary rec={rec} />
        {rec && (
          <p className="help mono">
            Current {locationToString(rec.location)} · code {locationCode(rec.location)}
          </p>
        )}
        <LocationFields value={loc} onChange={setLoc} />
        <p className="help mono">Target code: {locationCode(loc)}</p>
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
      <div className="card no-print">
        <h2>Location labels</h2>
        <p className="help">Seeded warehouse bins plus any locations already used on inventory.</p>
        <button className="btn btn-sec" type="button" onClick={() => { setPrintLocs(true); window.setTimeout(() => window.print(), 50); }}>
          Print location labels
        </button>
        <table>
          <thead>
            <tr>
              <th>Code</th>
              <th>Location</th>
            </tr>
          </thead>
          <tbody>
            {locList.map((l) => (
              <tr key={locationCode(l)}>
                <td className="mono">{locationCode(l)}</td>
                <td>{locationToString(l)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {printLocs && (
        <div className="labels">
          {locList.map((l) => (
            <LocationLabel key={locationCode(l)} loc={l} />
          ))}
        </div>
      )}
    </div>
  );
}

function LocationLabel({ loc }: { loc: Location }) {
  const ref = useRef<SVGSVGElement>(null);
  const code = locationCode(loc);
  useEffect(() => {
    if (ref.current) {
      JsBarcode(ref.current, code, {
        format: 'CODE128',
        displayValue: true,
        fontSize: 10,
        height: 40,
        margin: 4,
        width: 1.1,
      });
    }
  }, [code]);
  return (
    <div className="label-sheet" style={{ width: '4in', height: '2in', border: '1px solid #000', padding: 8, pageBreakAfter: 'always' }}>
      <div className="mono" style={{ fontWeight: 700 }}>
        {code}
      </div>
      <div>{locationToString(loc)}</div>
      <svg ref={ref} />
    </div>
  );
}
