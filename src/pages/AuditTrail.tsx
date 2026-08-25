import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { AuditEntry, Session } from '../types';
import { appendAudit, formatAuditCsv, listAudit } from '../lib/audit';
import { downloadBlob } from '../lib/excelExport';
import { useCap } from '../hooks/useCap';
import { todayIsoDateInTz } from '../lib/dates';

export function AuditTrail({ session }: { session: Session }) {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  const [sp, setSp] = useSearchParams();
  const canExportAudit = useCap(session, 'exportAudit');
  const canExportReports = useCap(session, 'exportReports');
  const canExport = Boolean(canExportAudit || canExportReports);
  const [err, setErr] = useState('');

  const user = sp.get('user') ?? '';
  const action = sp.get('action') ?? '';
  const record = sp.get('record') ?? '';
  const from = sp.get('from') ?? '';
  const to = sp.get('to') ?? '';

  useEffect(() => {
    void listAudit().then(setRows);
  }, []);

  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(sp);
    if (value.trim()) next.set(key, value);
    else next.delete(key);
    setSp(next, { replace: true });
  }

  const filtered = useMemo(() => {
    const u = user.trim().toLowerCase();
    const a = action.trim().toLowerCase();
    const rec = record.trim().toLowerCase();
    return rows.filter((e) => {
      if (u && !e.userId.toLowerCase().includes(u) && !e.userName.toLowerCase().includes(u)) return false;
      if (a && !e.action.toLowerCase().includes(a)) return false;
      if (rec && !e.recordId.toLowerCase().includes(rec)) return false;
      const day = e.timestampUtc.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      return true;
    });
  }, [rows, user, action, record, from, to]);

  async function exportCsv() {
    setErr('');
    try {
      const csv = formatAuditCsv(filtered);
      await appendAudit(session, {
        action: 'EXPORT',
        recordId: 'AUDIT',
        field: 'csv',
        newValue: String(filtered.length),
        reasonForChange: 'Audit trail CSV exported',
      });
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `WH-INV-audit-${todayIsoDateInTz()}.csv`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Export failed');
    }
  }

  return (
    <div>
      <h1>Audit trail</h1>
      <div className="card legend">
        <strong>21 CFR 11.10(e) — append-only computer-generated audit trail</strong>
        There is no UI or API to edit or delete audit rows. Timestamps are stored UTC and shown local
        (America/Los_Angeles). This trail is not WORM / independent archive.
      </div>
      <form className="card grid grid-4" onSubmit={(e) => e.preventDefault()}>
        <label>
          User
          <input value={user} onChange={(e) => setFilter('user', e.target.value)} placeholder="user id or name" />
        </label>
        <label>
          Action
          <input value={action} onChange={(e) => setFilter('action', e.target.value)} placeholder="RECEIVE, LOGIN, …" />
        </label>
        <label>
          Record / serial
          <input value={record} onChange={(e) => setFilter('record', e.target.value)} placeholder="record id" />
        </label>
        <span />
        <label>
          Date from (UTC)
          <input type="date" value={from} onChange={(e) => setFilter('from', e.target.value)} />
        </label>
        <label>
          Date to (UTC)
          <input type="date" value={to} onChange={(e) => setFilter('to', e.target.value)} />
        </label>
        <div className="row" style={{ alignSelf: 'end' }}>
          <button
            className="btn btn-sec"
            type="button"
            onClick={() => setSp(new URLSearchParams(), { replace: true })}
          >
            Clear filters
          </button>
          {canExport && (
            <button className="btn" type="button" onClick={() => void exportCsv()}>
              Export CSV
            </button>
          )}
        </div>
      </form>
      <p className="help">
        Newest first. Showing {filtered.length} of {rows.length} rows. Filters are query parameters (deep-linkable).
      </p>
      {err && <p className="err">{err}</p>}
      <table>
        <thead>
          <tr>
            <th>UTC</th>
            <th>Local</th>
            <th>User</th>
            <th>Action</th>
            <th>Record</th>
            <th>Field</th>
            <th>Old</th>
            <th>New</th>
            <th>Reason</th>
            <th>Meaning of signature</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => (
            <tr key={a.id}>
              <td className="mono">{a.timestampUtc}</td>
              <td>{a.timestampLocal}</td>
              <td>
                {a.userName} ({a.userId})
              </td>
              <td>{a.action}</td>
              <td className="mono">{a.recordId}</td>
              <td>{a.field}</td>
              <td>{a.oldValue}</td>
              <td>{a.newValue}</td>
              <td>{a.reasonForChange}</td>
              <td>{a.meaningOfSignature}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
