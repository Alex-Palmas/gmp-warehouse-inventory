import type { InventoryRecord, Location } from '../types';
import { StatusBadge } from './StatusBadge';

export function LocationFields({
  value,
  onChange,
  disabled,
}: {
  value: Location;
  onChange: (l: Location) => void;
  disabled?: boolean;
}) {
  const set = (k: keyof Location, v: string) => onChange({ ...value, [k]: v });
  return (
    <div className="grid grid-3">
      {(['site', 'building', 'room', 'rack', 'shelf', 'bin'] as const).map((k) => (
        <label key={k}>
          {k.charAt(0).toUpperCase() + k.slice(1)}
          <input value={value[k]} disabled={disabled} onChange={(e) => set(k, e.target.value)} />
        </label>
      ))}
    </div>
  );
}

export function SerialSelect({
  records,
  value,
  onChange,
}: {
  records: InventoryRecord[];
  value: string;
  onChange: (s: string) => void;
}) {
  return (
    <label>
      Container serial
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {records.map((r) => (
          <option key={r.serial} value={r.serial}>
            {r.serial} · {r.materialCode} · {r.status} · qty {r.currentQty} {r.uom}
          </option>
        ))}
      </select>
    </label>
  );
}

export function RecordSummary({ rec }: { rec: InventoryRecord | undefined }) {
  if (!rec) return null;
  return (
    <div className="card">
      <div className="row">
        <strong className="mono">{rec.serial}</strong>
        <StatusBadge status={rec.status} />
        <span>
          {rec.materialCode} {rec.materialName}
        </span>
      </div>
      <div className="help">
        Lot {rec.internalLot} / Mfr {rec.manufacturerLot} · Exp {rec.expiryDate} · Qty {rec.currentQty}{' '}
        {rec.uom} · {rec.storageCondition}
      </div>
    </div>
  );
}

export const emptyLocation = (): Location => ({
  site: 'MAIN',
  building: 'WH-1',
  room: '',
  rack: '',
  shelf: '',
  bin: '',
});
