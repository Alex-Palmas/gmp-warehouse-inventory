import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryRecord, MaterialRequest, MaterialSubmission, Session } from '../types';
import { countReservedUnpicked, listInventory } from '../lib/inventory';
import { daysUntil, isExpired, todayIsoDateInTz } from '../lib/dates';
import { StatusBadge } from '../components/StatusBadge';
import { exportExcelWorkbook, downloadBlob } from '../lib/excelExport';
import { exportBackup } from '../lib/backup';
import { useCap, useCaps } from '../hooks/useCap';
import { listOpenRequests, listPendingQa, listPendingSupervisor, listRequests } from '../lib/requests';
import { listSubmissions } from '../lib/submissions';

export function Dashboard({ session }: { session: Session }) {
  const canBackup = useCap(session, 'backupRestore');
  const canExport = useCap(session, 'exportReports');
  const caps = useCaps(session);
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [openReqs, setOpenReqs] = useState<MaterialRequest[]>([]);
  const [myReqs, setMyReqs] = useState<MaterialRequest[]>([]);
  const [pendingSup, setPendingSup] = useState<MaterialRequest[]>([]);
  const [pendingQa, setPendingQa] = useState<MaterialRequest[]>([]);
  const [pendingSub, setPendingSub] = useState<MaterialSubmission[]>([]);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void listInventory().then(setRows);
    void listOpenRequests().then(setOpenReqs);
    void listPendingSupervisor().then(setPendingSup);
    void listPendingQa().then(setPendingQa);
    void listRequests().then((all) => setMyReqs(all.filter((r) => r.requestedBy === session.userId)));
    void listSubmissions().then((all) => setPendingSub(all.filter((s) => s.status === 'Submitted')));
  }, [session.userId]);
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
  const isRequester = Boolean(caps?.has('submitRequest') && !caps.has('fulfillRequest') && !caps.has('receive'));
  const isWarehouse = Boolean(caps?.has('receive') || caps?.has('fulfillRequest'));
  const isQa = Boolean(caps?.has('qaDisposition'));
  const myOpen = myReqs.filter((r) =>
    ['Submitted', 'Pending Supervisor', 'Pending QA', 'Approved', 'Picking', 'Partially Issued', 'Issued'].includes(r.status),
  );
  const reservedUnpicked = countReservedUnpicked(rows);

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
      <div className="hero-actions">
        {(caps?.has('submitRequest') || caps?.has('fulfillRequest')) && (
          <Link className="hero-card" to="/requests">
            <div className="hero-kicker">Main workflow</div>
            <div className="hero-title">Material Transfer</div>
            <div className="help">Requestor e-sign → supervisor/QA approve → warehouse pick/issue.</div>
          </Link>
        )}
        {caps?.has('submitMaterial') && (
          <Link className="hero-card" to="/submit-material">
            <div className="hero-kicker">Main workflow</div>
            <div className="hero-title">Submit material</div>
            <div className="help">Propose a new material for QA / supervisor approval, then receive it.</div>
          </Link>
        )}
        {caps?.has('fulfillRequest') && (
          <Link className="hero-card hero-card-alt" to="/requests?view=open">
            <div className="hero-kicker">Warehouse</div>
            <div className="hero-title">Open requests ({openReqs.length})</div>
            <div className="help">Pick and issue approved material transfers (FEFO, scan-verified).</div>
          </Link>
        )}
      </div>
      {isRequester && (
        <div className="card">
          <h2>My requests</h2>
          <div className="row">
            <KpiLink to="/requests?view=mine" label="My open requests" n={myOpen.length} />
            <Link className="btn btn-sec" to="/requests?view=mine">
              View my requests ({myOpen.length})
            </Link>
          </div>
        </div>
      )}
      {isWarehouse && (
        <div className="card">
          <h2>Warehouse</h2>
          <div className="row">
            <KpiLink to="/requests?view=approve" label="Pending supervisor" n={pendingSup.length} />
            <KpiLink to="/requests?view=open" label="Open transfers" n={openReqs.length} />
            <KpiLink to="/register?filter=reserved" label="Reserved, unpicked" n={reservedUnpicked} />
            <Link className="btn" to="/requests?view=open">
              Fulfill requests
            </Link>
            {caps?.has('receive') && (
              <Link className="btn btn-sec" to="/receive">
                Receive goods
              </Link>
            )}
          </div>
        </div>
      )}
      {isQa && (
        <div className="card">
          <h2>QA</h2>
          <div className="row">
            <KpiLink to="/register?status=Quarantine" label="Quarantine containers" n={qAge.length} />
            <KpiLink to="/requests?view=approve" label="Pending QA transfers" n={pendingQa.length} />
            <KpiLink to="/submit-material" label="Pending submissions" n={pendingSub.length} />
            <Link className="btn" to="/qa">
              QA disposition
            </Link>
            <Link className="btn btn-sec" to="/submit-material">
              Review submissions
            </Link>
          </div>
        </div>
      )}
      <div className="row" style={{ marginBottom: 12 }}>
        <KpiLink to="/register?status=Quarantine" label="Quarantine" n={byStatus('Quarantine')} />
        <KpiLink to="/register?status=Released" label="Released" n={byStatus('Released')} />
        <KpiLink to="/register?status=Hold" label="Hold" n={byStatus('Hold')} />
        <KpiLink to="/register?status=Rejected" label="Rejected" n={byStatus('Rejected')} />
        <KpiLink to="/register?status=Restricted" label="Restricted" n={byStatus('Restricted')} />
        <KpiLink to="/register?filter=expired" label="Expired" n={expired.length} />
        <KpiLink to="/register?filter=exp30" label="Exp 30d" n={d30.length} />
        <KpiLink to="/register?filter=exp90" label="Exp 90d" n={d90.length} />
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
              <th>Batch</th>
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
                <td className="mono">{r.receiptBatchId}</td>
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

function KpiLink({ to, label, n }: { to: string; label: string; n: number }) {
  return (
    <Link className="kpi kpi-link" to={to} aria-label={`${label}: ${n}. Open filtered list.`}>
      <div className="help">{label}</div>
      <div className="n">{n}</div>
    </Link>
  );
}
