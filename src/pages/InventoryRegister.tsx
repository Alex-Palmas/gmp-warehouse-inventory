import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InventoryRecord, Status } from '../types';
import { STATUSES } from '../types';
import { listInventory } from '../lib/inventory';
import { StatusBadge } from '../components/StatusBadge';
import { locationToString } from '../lib/dates';

export function InventoryRegister() {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [q, setQ] = useState('');
  const [st, setSt] = useState<Status | ''>('');
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);
  const filtered = rows.filter((r) => {
    if (st && r.status !== st) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.serial, r.materialCode, r.materialName, r.internalLot, r.manufacturerLot].some((x) =>
      x.toLowerCase().includes(s),
    );
  });
  return (
    <div>
      <h1>Inventory register</h1>
      <p className="help">System of record is IndexedDB. This table is a view — use forms to mutate GMP fields.</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="Filter serial / material / lot" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setSt(e.target.value as Status | '')}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>Serial</th>
            <th>Material</th>
            <th>Lot</th>
            <th>Qty</th>
            <th>Exp</th>
            <th>Status</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.serial}>
              <td className="mono">
                <Link to={`/record/${r.serial}`}>{r.serial}</Link>
              </td>
              <td>
                {r.materialCode} {r.materialName}
              </td>
              <td>{r.internalLot}</td>
              <td>
                {r.currentQty} {r.uom}
              </td>
              <td>{r.expiryDate}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>{locationToString(r.location)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
