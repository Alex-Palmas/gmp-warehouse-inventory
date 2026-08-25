import type { Status } from '../types';

export function StatusBadge({ status }: { status: Status | string }) {
  return <span className={`badge st-${status}`}>{status}</span>;
}
