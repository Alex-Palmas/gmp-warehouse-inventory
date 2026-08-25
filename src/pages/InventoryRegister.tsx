import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InventoryRecord, Status } from '../types';
import { STATUSES } from '../types';
import { listInventory } from '../lib/inventory';
import { StatusBadge } from '../components/StatusBadge';
import { locationToString, todayIsoDateInTz } from '../lib/dates';
import { EXTRA_FILTERS, extraFilterLabel, matchesRegisterKpi, parseRegisterQuery } from '../lib/kpiFilter';
import type { ExtraRegisterFilter } from '../lib/kpiFilter';

type Group = { batchId: string; rows: InventoryRecord[] };

export function InventoryRegister() {
  const [rows, setRows] = useState<InventoryRecord[]>([]);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [sp, setSp] = useSearchParams();
  const { status: st, extra } = parseRegisterQuery(sp);
  const asOf = todayIsoDateInTz();
  useEffect(() => {
    void listInventory().then(setRows);
  }, []);

  function setStatus(v: Status | '') {
    const next = new URLSearchParams(sp);
    if (v) next.set('status', v);
    else next.delete('status');
    setSp(next, { replace: true });
  }
  function setExtra(v: ExtraRegisterFilter) {
    const next = new URLSearchParams(sp);
    if (v) next.set('filter', v);
    else next.delete('filter');
    setSp(next, { replace: true });
  }
  function clearFilters() {
    setSp({}, { replace: true });
    setQ('');
  }

  const filtered = rows.filter((r) => {
    if (!matchesRegisterKpi(r, { status: st || undefined, extra, asOf })) return false;
    if (!q) return true;
    const s = q.toLowerCase();
    return [r.serial, r.materialCode, r.materialName, r.internalLot, r.manufacturerLot, r.receiptBatchId, r.parentSerial ?? ''].some((x) =>
      (x || '').toLowerCase().includes(s),
    );
  });

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, InventoryRecord[]>();
    for (const r of filtered) {
      const id = r.receiptBatchId || r.serial;
      const arr = map.get(id) ?? [];
      arr.push(r);
      map.set(id, arr);
    }
    const out: Group[] = [];
    for (const [batchId, rs] of map) {
      rs.sort((a, b) => (a.containerIndex || 1) - (b.containerIndex || 1));
      out.push({ batchId, rows: rs });
    }
    out.sort((a, b) => (b.rows[0]?.createdOnUtc || '').localeCompare(a.rows[0]?.createdOnUtc || ''));
    return out;
  }, [filtered]);

  useEffect(() => {
    const next: Record<string, boolean> = {};
    if (q) {
      const s = q.toLowerCase();
      for (const g of groups) {
        if (g.rows.length > 1 && g.rows.some((r) => r.serial.toLowerCase().includes(s))) {
          next[g.batchId] = true;
        }
      }
    }
    if (extra) {
      for (const g of groups) {
        if (g.rows.length > 1) next[g.batchId] = true;
      }
    }
    if (Object.keys(next).length) setOpen((o) => ({ ...o, ...next }));
  }, [q, extra, groups]);

  function toggle(id: string) {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  }

  return (
    <div>
      <h1>Inventory register</h1>
      <p className="help">
        Grouped by receipt batch so N vials do not flood the table. Search still finds an individual serial.
        System of record is IndexedDB — use forms to mutate GMP fields. Dashboard KPI cards deep-link here
        (HashRouter, e.g. <span className="mono">#/register?status=Released</span>).
      </p>
      {(st || extra) && (
        <p className="ok">
          Filtered from dashboard: {st || extraFilterLabel(extra)} · {filtered.length} record{filtered.length === 1 ? '' : 's'}.
        </p>
      )}
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="Filter serial / batch / material / lot" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={st} onChange={(e) => setStatus(e.target.value as Status | '')} aria-label="Status filter">
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select value={extra} onChange={(e) => setExtra(e.target.value as ExtraRegisterFilter)} aria-label="Extra filter">
          {EXTRA_FILTERS.map((f) => (
            <option key={f.value || 'none'} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        {(st || extra || q) && (
          <button className="btn btn-sec" type="button" onClick={clearFilters}>
            Clear filter
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th></th>
            <th>Serial / batch</th>
            <th>Material</th>
            <th>Lot</th>
            <th>Qty</th>
            <th>Exp</th>
            <th>Status</th>
            <th>Location</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const multi = g.rows.length > 1;
            const head = g.rows[0];
            const expanded = open[g.batchId] ?? Boolean(q && g.rows.some((r) => r.serial.toLowerCase().includes(q.toLowerCase())));
            const qtySum = g.rows.reduce((s, r) => s + r.currentQty, 0);
            const statuses = Array.from(new Set(g.rows.map((r) => r.status)));
            return (
              <RegisterGroup
                key={g.batchId}
                multi={multi}
                expanded={expanded}
                head={head}
                rows={g.rows}
                qtySum={qtySum}
                statuses={statuses}
                batchId={g.batchId}
                onToggle={() => toggle(g.batchId)}
                query={q}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function RegisterGroup({
  multi,
  expanded,
  head,
  rows,
  qtySum,
  statuses,
  batchId,
  onToggle,
  query,
}: {
  multi: boolean;
  expanded: boolean;
  head: InventoryRecord;
  rows: InventoryRecord[];
  qtySum: number;
  statuses: string[];
  batchId: string;
  onToggle: () => void;
  query: string;
}) {
  const q = query.toLowerCase();
  return (
    <>
      <tr>
        <td>
          {multi && (
            <button className="btn btn-sec" type="button" onClick={onToggle} aria-label="Expand receipt batch">
              {expanded ? '−' : '+'}
            </button>
          )}
        </td>
        <td className="mono">
          {multi ? (
            <>
              <div>
                <Link to={`/record/${head.serial}`}>{batchId}</Link>
              </div>
              <div className="help">
                {rows.length} containers · {head.containerType}
              </div>
            </>
          ) : (
            <Link to={`/record/${head.serial}`}>{head.serial}</Link>
          )}
        </td>
        <td>
          {head.materialCode} {head.materialName}
        </td>
        <td>{head.internalLot}</td>
        <td>
          {multi ? qtySum : head.currentQty} {head.uom}
        </td>
        <td>{head.expiryDate}</td>
        <td>
          {statuses.length === 1 ? <StatusBadge status={head.status} /> : statuses.join(', ')}
          {rows.some((r) => r.reservedForRequestId) && (
            <div>
              <span className="badge-reserved">Reserved</span>
            </div>
          )}
        </td>
        <td>{locationToString(head.location)}</td>
      </tr>
      {multi &&
        expanded &&
        rows.map((r) => (
          <tr key={r.serial} className={q && r.serial.toLowerCase().includes(q) ? 'highlight' : 'child-row'}>
            <td></td>
            <td className="mono">
              <Link to={`/record/${r.serial}`}>{r.serial}</Link>
              <div className="help">
                {r.containerIndex} of {r.numberOfContainers} · {r.recordKind ?? 'container'}
                {r.parentSerial ? ` · parent ${r.parentSerial}` : ''}
              </div>
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
              {r.reservedForRequestId && (
                <div>
                  <span className="badge-reserved">Reserved {r.reservedForRequestId}</span>
                </div>
              )}
            </td>
            <td>{locationToString(r.location)}</td>
          </tr>
        ))}
    </>
  );
}
