import { CAPABILITIES } from '../types';
import { defaultMatrixRows } from './permissions';
import type { ExtraCtx } from './oqExtra';
import { dump } from './oqSuite';
import { allTraceOqIds, HASH_ROUTES, isDocumentedOqId, NAV_ITEMS, TRACE_MAP, URS_IDS } from './traceMatrix';

export const TRACE_OQ_IDS = ['TM-01', 'TM-02', 'TM-03', 'TM-04'] as const;

export async function runTraceStructural(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq } = ctx;

  await oq(
    results,
    'TM-03',
    'URS-16',
    'CAPABILITIES equals defaultMatrixRows column set',
    'No orphan capabilities: every CAPABILITIES member is a matrix column; no extra row keys.',
    async () => {
      const rows = defaultMatrixRows();
      const caps = [...CAPABILITIES];
      const mismatches: string[] = [];
      for (const [role, row] of Object.entries(rows)) {
        const keys = Object.keys(row).sort();
        const expected = [...caps].sort();
        if (keys.join() !== expected.join()) {
          mismatches.push(`${role}: keys ${keys.join(',')} vs ${expected.join(',')}`);
        }
      }
      return dump(mismatches);
    },
    onResult,
  );

  await oq(
    results,
    'TM-04',
    'URS-16',
    'NAV list caps are real Capability values',
    'NAV_ITEMS (keep in sync with Layout.tsx) uses only CAPABILITIES members. HASH_ROUTES unique.',
    async () => {
      const capSet = new Set<string>(CAPABILITIES as readonly string[]);
      const mismatches: string[] = [];
      for (const item of NAV_ITEMS) {
        if (!capSet.has(item.cap)) mismatches.push(`NAV ${item.to} cap ${item.cap} is not a Capability`);
      }
      const routes = [...HASH_ROUTES];
      if (new Set(routes).size !== routes.length) mismatches.push('HASH_ROUTES has duplicates');
      return dump(mismatches);
    },
    onResult,
  );
}

export async function runTraceCoverage(ctx: ExtraCtx): Promise<void> {
  const { results, onResult, oq } = ctx;

  await oq(
    results,
    'TM-01',
    'URS-30',
    'Every URS-01..30 has ≥1 OQ id present in this run',
    'TRACE_MAP lists at least one executed result.id per URS-01 through URS-30. Fail listing gaps.',
    async () => {
      const present = new Set(results.map((r) => r.id));
      const gaps: string[] = [];
      for (const urs of URS_IDS) {
        const mapped = TRACE_MAP[urs] ?? [];
        if (!mapped.length) {
          gaps.push(`${urs}: no TRACE_MAP row`);
          continue;
        }
        if (!mapped.some((id) => present.has(id))) {
          gaps.push(`${urs}: none of [${mapped.join(', ')}] in results`);
        }
      }
      return dump(gaps);
    },
    onResult,
  );

  await oq(
    results,
    'TM-02',
    'URS-30',
    'Every result.id is in TRACE_MAP or a documented extension family',
    'Core OQ/PQ/VAL ids live in TRACE_MAP; extensions match IQ/PQ/OQ-EXT/HMI/LIM/RBAC/NEG/P11/PROC/TM/ATT/BKP/ISO.',
    async () => {
      const traceIds = allTraceOqIds();
      const gaps = results.filter((r) => !isDocumentedOqId(r.id, traceIds)).map((r) => r.id);
      return dump(gaps);
    },
    onResult,
  );
}
