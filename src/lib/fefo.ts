export interface FefoCandidate {
  serial: string;
  materialCode: string;
  status: string;
  expiryDate: string;
  currentQty: number;
  reservedForRequestId?: string;
  reservedQty?: number;
}

/** Qty not reserved for a *different* request. */
export function freeQty(rec: FefoCandidate, forRequestId?: string): number {
  const reserved = rec.reservedQty ?? 0;
  const owner = rec.reservedForRequestId;
  if (!owner || reserved <= 0) return rec.currentQty;
  if (forRequestId && owner === forRequestId) return rec.currentQty;
  return Math.max(0, rec.currentQty - reserved);
}

export function isIssueBlocked(
  rec: FefoCandidate,
  asOf: string,
  forRequestId?: string,
): { blocked: boolean; reason: string } {
  if (rec.status !== 'Released') {
    return { blocked: true, reason: `Cannot issue: status is ${rec.status} (Released required)` };
  }
  if (rec.expiryDate && rec.expiryDate < asOf) {
    return { blocked: true, reason: `Cannot issue: lot expired on ${rec.expiryDate}` };
  }
  if (rec.currentQty <= 0) {
    return { blocked: true, reason: 'Cannot issue: current quantity is zero' };
  }
  const owner = rec.reservedForRequestId;
  if (owner && (rec.reservedQty ?? 0) > 0 && owner !== forRequestId) {
    return { blocked: true, reason: `Cannot issue: serial reserved for request ${owner}` };
  }
  return { blocked: false, reason: '' };
}

/** True when another Released, in-qty, not-expired container of same material has earlier expiry. */
export function shouldWarnFefo(
  target: FefoCandidate,
  all: FefoCandidate[],
  asOf: string,
  forRequestId?: string,
): {
  warn: boolean;
  earlier: FefoCandidate[];
} {
  const earlier = all.filter(
    (r) =>
      r.serial !== target.serial &&
      r.materialCode === target.materialCode &&
      r.status === 'Released' &&
      freeQty(r, forRequestId) > 0 &&
      r.expiryDate &&
      r.expiryDate >= asOf &&
      r.expiryDate < target.expiryDate,
  );
  earlier.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return { warn: earlier.length > 0, earlier };
}

export type FefoAllocation = { serial: string; qty: number };

/** Released, in-qty, not-expired containers of a material, earliest expiry first. Allocates qty (drums may be partial). */
export function proposeFefoAllocations(
  all: FefoCandidate[],
  materialCode: string,
  qtyNeeded: number,
  asOf: string,
  forRequestId?: string,
): FefoAllocation[] {
  const eligible = all
    .filter(
      (r) =>
        r.materialCode === materialCode &&
        r.status === 'Released' &&
        freeQty(r, forRequestId) > 0 &&
        (!r.expiryDate || r.expiryDate >= asOf),
    )
    .slice()
    .sort((a, b) => a.expiryDate.localeCompare(b.expiryDate) || a.serial.localeCompare(b.serial));
  const picked: FefoAllocation[] = [];
  let remaining = qtyNeeded;
  for (const r of eligible) {
    if (remaining <= 0) break;
    const take = Math.min(freeQty(r, forRequestId), remaining);
    if (take > 0) {
      picked.push({ serial: r.serial, qty: take });
      remaining -= take;
    }
  }
  return picked;
}

export function proposeFefo(
  all: FefoCandidate[],
  materialCode: string,
  qtyNeeded: number,
  asOf: string,
  forRequestId?: string,
): FefoCandidate[] {
  const lines = proposeFefoAllocations(all, materialCode, qtyNeeded, asOf, forRequestId);
  const bySerial = new Map(all.map((r) => [r.serial, r]));
  return lines.map((l) => bySerial.get(l.serial)).filter((r): r is FefoCandidate => Boolean(r));
}

export function availableReleasedQty(
  all: FefoCandidate[],
  materialCode: string,
  asOf: string,
  forRequestId?: string,
): number {
  return all
    .filter(
      (r) =>
        r.materialCode === materialCode &&
        r.status === 'Released' &&
        freeQty(r, forRequestId) > 0 &&
        (!r.expiryDate || r.expiryDate >= asOf),
    )
    .reduce((s, r) => s + freeQty(r, forRequestId), 0);
}
