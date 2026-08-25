import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { AuditEntry, InventoryRecord } from '../types';
import { getInventory } from '../lib/inventory';
import { listAuditForRecord } from '../lib/audit';
import { StatusBadge } from '../components/StatusBadge';
import { locationToString, toDisplayLocal } from '../lib/dates';

export function RecordDetail() {
  const { serial } = useParams();
  const [rec, setRec] = useState<InventoryRecord | undefined>();
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  useEffect(() => {
    if (!serial) return;
    void getInventory(serial).then(setRec);
    void listAuditForRecord(serial).then(setAudit);
  }, [serial]);
  if (!rec) return <p>Record not found.</p>;
  const rows: [string, string][] = [
    ['Serial / barcode', rec.serial],
    ['Material', `${rec.materialCode} ${rec.materialName}`],
    ['Item type', rec.itemType],
    ['Grade / spec', rec.gradeSpec],
    ['Pharmacopeia', rec.pharmacopeia],
    ['Manufacturer', `${rec.manufacturer} lot ${rec.manufacturerLot}`],
    ['Supplier', `${rec.supplier} lot ${rec.supplierLot}`],
    ['PO / DN', rec.poDeliveryNote],
    ['CoA', rec.coaNumber],
    ['Internal lot', rec.internalLot],
    ['Qty received / current', `${rec.qtyReceived} / ${rec.currentQty} ${rec.uom}`],
    ['Containers', `${rec.numberOfContainers} × ${rec.containerType}`],
    ['DOM / receipt / expiry / retest', `${rec.dateOfManufacture} / ${rec.receiptDate} / ${rec.expiryDate} / ${rec.retestDate}`],
    ['Location', locationToString(rec.location)],
    ['Storage', rec.storageCondition],
    ['Status', rec.status],
    ['Sampling required', rec.samplingRequired ? 'Y' : 'N'],
    ['Linked samples', rec.linkedSampleIds],
    ['Comments', rec.comments],
    ['Created', `${rec.createdBy} ${toDisplayLocal(rec.createdOnUtc)}`],
    ['Modified', `${rec.modifiedBy} ${toDisplayLocal(rec.modifiedOnUtc)}`],
    ['QA disposition', rec.qaDisposition ?? ''],
    ['QA e-sign', rec.qaEsign ? `${rec.qaEsign.printedName} (${rec.qaEsign.userId}) ${toDisplayLocal(rec.qaEsign.signedAtUtc)} — ${rec.qaEsign.meaningOfSignature}` : ''],
    ['Destruction', rec.destructionReason ?? ''],
  ];
  return (
    <div>
      <h1 className="mono">
        {rec.serial} <StatusBadge status={rec.status} />
      </h1>
      <p className="help">
        View only. Use dedicated forms to change GMP fields.{' '}
        <Link to={`/reprint?serial=${rec.serial}`}>Reprint label</Link>
      </p>
      <table>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th style={{ width: 220 }}>{k}</th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 style={{ marginTop: 16 }}>Audit trail</h2>
      <table>
        <thead>
          <tr>
            <th>UTC</th>
            <th>Local</th>
            <th>User</th>
            <th>Action</th>
            <th>Field</th>
            <th>Old</th>
            <th>New</th>
            <th>Reason</th>
          </tr>
        </thead>
        <tbody>
          {audit.map((a) => (
            <tr key={a.id}>
              <td className="mono">{a.timestampUtc}</td>
              <td>{a.timestampLocal}</td>
              <td>
                {a.userName} ({a.userId})
              </td>
              <td>{a.action}</td>
              <td>{a.field}</td>
              <td>{a.oldValue}</td>
              <td>{a.newValue}</td>
              <td>{a.reasonForChange}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
