import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { AuditEntry, InventoryRecord, Session } from '../types';
import { getInventory } from '../lib/inventory';
import { listAuditForRecord } from '../lib/audit';
import { StatusBadge } from '../components/StatusBadge';
import { AttachmentList } from '../components/AttachmentList';
import { locationToString, toDisplayLocal } from '../lib/dates';

export function ScanLookup({ session }: { session: Session }) {
  const [sp] = useSearchParams();
  const serial = (sp.get('serial') ?? '').trim();
  const [rec, setRec] = useState<InventoryRecord | undefined>();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!serial) {
      setRec(undefined);
      return;
    }
    void getInventory(serial).then((r) => {
      setRec(r);
      setErr(r ? '' : `No record for ${serial}`);
    });
    void listAuditForRecord(serial).then(setAudit);
  }, [serial]);

  return (
    <div>
      <h1>Scan / lookup</h1>
      <p className="help">HID keyboard-wedge scanners send the serial then Enter. Use the black SCAN bar on every page.</p>
      {!serial && <p>Waiting for scan…</p>}
      {err && <p className="err">{err}</p>}
      {rec && (
        <div className="card">
          <h2 className="mono">
            {rec.serial} <StatusBadge status={rec.status} />
          </h2>
          <p>
            {rec.materialCode} {rec.materialName} · Lot {rec.internalLot} · Exp {rec.expiryDate}
          </p>
          <p>
            Qty {rec.currentQty} {rec.uom} · {locationToString(rec.location)} · {rec.storageCondition}
          </p>
          <p>
            <Link to={`/record/${rec.serial}`}>Open full record</Link>
          </p>
          <AttachmentList session={session} record={rec} />
        </div>
      )}
      {audit.length > 0 && (
        <div className="card">
          <h2>Audit for this serial</h2>
          <table>
            <thead>
              <tr>
                <th>Local</th>
                <th>User</th>
                <th>Action</th>
                <th>Field</th>
                <th>Old</th>
                <th>New</th>
              </tr>
            </thead>
            <tbody>
              {audit.map((a) => (
                <tr key={a.id}>
                  <td>{a.timestampLocal || toDisplayLocal(a.timestampUtc)}</td>
                  <td>
                    {a.userName} ({a.userId})
                  </td>
                  <td>{a.action}</td>
                  <td>{a.field}</td>
                  <td>{a.oldValue}</td>
                  <td>{a.newValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
