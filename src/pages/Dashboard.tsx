import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryRecord, Session } from '../types';
import { listInventory } from '../lib/inventory';
import { daysUntil, isExpired, todayIsoDateInTz } from '../lib/dates';
import { StatusBadge } from '../components/StatusBadge';
import { exportExcelWorkbook, downloadBlob } from '../lib/excelExport';
import { exportBackup } from '../lib/backup';
import { useCap } from '../hooks/useCap';

export function Dashboard({ session }: { session: Session }) {
  const canBackup = useCap(session, 'backupRestore');
  const canExport = useCap(session, 'exportReports');
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const asOf = todayIsoDateInTz();
  const byStatus = (s: string) => rows.filter((r) => r.status === s).length;
  const expired = rows.filter((r) => r.expiryDate && isExpired(r.expiryDate, asOf) && r.status !== 'Destroyed');
  const d30 = rows.filter((r) => {
    const d = daysUntil(r.expiryDate, asOf);
    return d >= 0 && d <= 30 && r.currentQty > 0 && r.status !== 'Destroyed';
  });
  const d90 = rows.filter((r) => {
    const d = daysUntil(r.expiryDate, asOf);
    return d > 30 && d <= 90 && r.currentQty > 0 && r.status !== 'Destroyed';
  });
  const qAge = rows.filter((r) => r.status === 'Quarantine');

  async function doExcel() {
    const blob = await exportExcelWorkbook(session);
    downloadBlob(blob, `WH-INV-export-${asOf}.xlsx`);
  }
  async function doBackup() {
    const payload = await exportBackup(session);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `WH-INV-backup-${asOf}.json`);
    setMsg('Backup downloaded.');
  }

  return (
    <div>
      <h1>Warehouse dashboard</h1>
      <div className="row" style={{ marginBottom: 12 }}>
        {[
          ['Quarantine', byStatus('Quarantine')],
          ['Released', byStatus('Released')],
          ['Hold', byStatus('Hold')],
          ['Rejected', byStatus('Rejected')],
          ['Expired', expired.length],
          ['Exp 30d', d30.length],
          ['Exp 90d', d90.length],
        ].map(([k, n]) => (
          <div className="kpi" key={String(k)}>
            <div className="help">{k}</div>
            <div className="n">{n}</div>
          </div>
        ))}
      </div>
      <div className="row no-print" style={{ marginBottom: 12 }}>
        {canExport && (
          <button className="btn" type="button" onClick={() => void doExcel()}>
            Export Excel reports
          </button>
        )}
        {canBackup && (
          <button className="btn btn-sec" type="button" onClick={() => void doBackup()}>
            Backup JSON
          </button>
        )}
      </div>
      {msg && <p className="ok">{msg}</p>}
      <div className="card">
        <h2>Quarantine aging</h2>
        <table>
          <thead>
            <tr>
              <th>Serial</th>
              <th>Material</th>
              <th>Receipt</th>
              <th>Qty</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {qAge.map((r) => (
              <tr key={r.serial}>
                <td className="mono">
                  <Link to={`/record/${r.serial}`}>{r.serial}</Link>
                </td>
                <td>
                  {r.materialCode} {r.materialName}
                </td>
                <td>{r.receiptDate}</td>
                <td>
                  {r.currentQty} {r.uom}
                </td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h2>Expired (not destroyed)</h2>
        <table>
          <thead>
            <tr>
              <th>Serial</th>
              <th>Material</th>
              <th>Expiry</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {expired.map((r) => (
              <tr key={r.serial}>
                <td className="mono">
                  <Link to={`/record/${r.serial}`}>{r.serial}</Link>
                </td>
                <td>
                  {r.materialCode} {r.materialName}
                </td>
                <td>{r.expiryDate}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
