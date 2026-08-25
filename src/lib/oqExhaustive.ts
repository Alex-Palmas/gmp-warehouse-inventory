/**
 * Exhaustive sandbox OQ extensions (RBAC, limits, HMI, trace, negatives, Part 11, process).
 * Automated evidence only — not approved site IQ/OQ/PQ. Live lots were not used.
 */
import type { ExtraCtx } from './oqExtra';
import { HMI_OQ_IDS, runHmiCases } from './oqHmi';
import { LIM_OQ_IDS, runLimitCases } from './oqLimits';
import { NEG_OQ_IDS, runNegativeCases } from './oqNegatives';
import { P11_OQ_IDS, runPart11Cases } from './oqPart11';
import { ATT_OQ_IDS, BKP_OQ_IDS, ISO_OQ_IDS, PROC_OQ_IDS, runProcessCases } from './oqProcess';
import { RBAC_OQ_IDS, runRbacCases } from './oqRbac';
import { TRACE_OQ_IDS, runTraceCoverage, runTraceStructural } from './oqTrace';

export const EXHAUSTIVE_OQ_IDS: string[] = [
  ...TRACE_OQ_IDS,
  ...HMI_OQ_IDS,
  ...LIM_OQ_IDS,
  ...RBAC_OQ_IDS,
  ...NEG_OQ_IDS,
  ...P11_OQ_IDS,
  ...PROC_OQ_IDS,
  ...ATT_OQ_IDS,
  ...BKP_OQ_IDS,
  ...ISO_OQ_IDS,
];

export async function runExhaustive(ctx: ExtraCtx): Promise<void> {
  await runTraceStructural(ctx);
  await runHmiCases(ctx);
  await runLimitCases(ctx);
  await runRbacCases(ctx);
  await runNegativeCases(ctx);
  await runPart11Cases(ctx);
  await runProcessCases(ctx);
  await runTraceCoverage(ctx);
}
