import { useEffect, useState } from 'react';
import type { AuditEntry } from '../types';
import { listAudit } from '../lib/audit';

export function AuditTrail() {
  const [rows, setRows] = useState<AuditEntry[]>([]);
  useEffect(() => {
    void listAudit().then(setRows);
  }, []);
  return (
    <div>
      <h1>Audit trail</h1>
      <p className="help">Append-only. There is no UI or API to edit or delete audit rows.</p>
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
          {rows.map((a) => (
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
