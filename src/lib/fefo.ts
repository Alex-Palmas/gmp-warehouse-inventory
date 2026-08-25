export interface FefoCandidate {
  serial: string;
  materialCode: string;
  status: string;
  expiryDate: string;
  currentQty: number;
}

export function isIssueBlocked(
  rec: FefoCandidate,
  asOf: string,
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
  return { blocked: false, reason: '' };
}

/** True when another Released, in-qty, not-expired container of same material has earlier expiry. */
export function shouldWarnFefo(target: FefoCandidate, all: FefoCandidate[], asOf: string): {
  warn: boolean;
  earlier: FefoCandidate[];
} {
  const earlier = all.filter(
    (r) =>
      r.serial !== target.serial &&
      r.materialCode === target.materialCode &&
      r.status === 'Released' &&
      r.currentQty > 0 &&
      r.expiryDate &&
      r.expiryDate >= asOf &&
      r.expiryDate < target.expiryDate,
  );
  earlier.sort((a, b) => a.expiryDate.localeCompare(b.expiryDate));
  return { warn: earlier.length > 0, earlier };
}
