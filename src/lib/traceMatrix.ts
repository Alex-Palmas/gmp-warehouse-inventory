/**
 * URS → OQ id map mirroring docs/04-Traceability-Matrix.md.
 * Keep the markdown table in sync when adding a URS row or core OQ id.
 * Extension families (HMI/LIM/RBAC/NEG/P11/PROC/TM/ATT/BKP/ISO) are documented
 * separately and do not need a URS column of their own.
 */
export const TRACE_MAP: Record<string, string[]> = {
  'URS-01': ['OQ-01', 'PQ-01'],
  'URS-02': ['OQ-03', 'OQ-04', 'PQ-02'],
  'URS-03': ['OQ-08', 'PQ-03'],
  'URS-04': ['OQ-11', 'HMI-VOCAB'],
  'URS-05': ['OQ-06', 'OQ-07', 'PQ-04', 'PROC-FEFO-OLDEST'],
  'URS-06': ['OQ-05', 'OQ-27', 'OQ-28', 'PQ-05', 'P11-AUDIT-ROLE'],
  'URS-07': ['OQ-10', 'OQ-17', 'P11-LOCK-5-YES', 'HMI-BANNER'],
  'URS-08': ['OQ-09', 'P11-HASH-BACKUP'],
  'URS-09': ['OQ-08', 'OQ-09', 'OQ-18', 'HMI-ESIGN-SHAPE'],
  'URS-10': ['OQ-03', 'OQ-04', 'OQ-05', 'OQ-06', 'OQ-07', 'OQ-08', 'HMI-ROUTES'],
  'URS-11': ['OQ-12'],
  'URS-12': ['OQ-11'],
  'URS-13': ['OQ-03'],
  'URS-14': ['OQ-02', 'PQ-07', 'HMI-SCAN-PARSE'],
  'URS-15': ['OQ-13', 'PQ-08', 'BKP-KEYS'],
  'URS-16': ['OQ-10', 'OQ-18', 'OQ-19', 'OQ-26', 'RBAC-MATRIX'],
  'URS-17': ['OQ-14'],
  'URS-18': ['OQ-15', 'HMI-BANNER'],
  'URS-19': ['OQ-16'],
  'URS-20': ['OQ-05', 'OQ-08', 'P11-REASON-FOR-CHANGE'],
  'URS-21': ['OQ-21', 'PQ-01', 'PROC-RECEIPT-BATCH', 'PROC-SERIAL-FORMAT'],
  'URS-22': ['OQ-22', 'OQ-28', 'PQ-04'],
  'URS-23': ['OQ-25'],
  'URS-24': ['OQ-18', 'OQ-19', 'OQ-20', 'OQ-26', 'RBAC-MATRIX'],
  'URS-25': ['OQ-23', 'PROC-SAMPLE-PARENT-QTY', 'PROC-CHILD-KIND'],
  'URS-26': ['OQ-24', 'PQ-07'],
  'URS-27': ['OQ-14'],
  'URS-28': ['OQ-ATT', 'ATT-SERIAL', 'ATT-BATCH'],
  'URS-29': ['OQ-22', 'PQ-04', 'PROC-DEST-LVM'],
  'URS-30': ['VAL-SOD', 'TM-01'],
};

export const URS_IDS = Array.from({ length: 30 }, (_, i) => `URS-${String(i + 1).padStart(2, '0')}`);

/** Duplicate of Layout.tsx NAV — keep in sync. Caps must be real Capability ids. */
export const NAV_ITEMS: { to: string; label: string; cap: string }[] = [
  { to: '/', label: 'Dashboard', cap: 'viewDashboard' },
  { to: '/requests', label: 'Material Transfer', cap: 'submitRequest' },
  { to: '/submit-material', label: 'Submit material', cap: 'submitMaterial' },
  { to: '/register', label: 'Register', cap: 'viewRegister' },
  { to: '/inbox', label: 'Inbox', cap: 'viewInbox' },
  { to: '/receive', label: 'Receipt', cap: 'receive' },
  { to: '/qa', label: 'QA Disp.', cap: 'qaDisposition' },
  { to: '/samples', label: 'Samples', cap: 'samplePull' },
  { to: '/transfer', label: 'Transfer', cap: 'transfer' },
  { to: '/issue', label: 'Issue', cap: 'issue' },
  { to: '/return', label: 'Return', cap: 'returnToStock' },
  { to: '/hold', label: 'Hold', cap: 'hold' },
  { to: '/count', label: 'Cycle Count', cap: 'cycleCount' },
  { to: '/destroy', label: 'Destroy', cap: 'destroy' },
  { to: '/reprint', label: 'Labels', cap: 'reprintLabel' },
  { to: '/scan', label: 'Scan', cap: 'scanLookup' },
  { to: '/materials', label: 'Materials', cap: 'adminMaterials' },
  { to: '/access', label: 'Access', cap: 'adminUsers' },
  { to: '/audit', label: 'Audit', cap: 'viewAudit' },
  { to: '/validation', label: 'Validation', cap: 'runValidation' },
];

/** Hash routes used by the SPA (App.tsx). Keep in sync. */
export const HASH_ROUTES = [
  '/',
  '/requests',
  '/submit-material',
  '/register',
  '/inbox',
  '/receive',
  '/qa',
  '/samples',
  '/transfer',
  '/issue',
  '/return',
  '/hold',
  '/count',
  '/destroy',
  '/reprint',
  '/scan',
  '/materials',
  '/access',
  '/audit',
  '/validation',
  '/login',
] as const;

export const EXTENSION_ID_RE =
  /^(IQ-|PQ-|OQ-EXT|OQ-ATT|OQ-02-PRINT|VAL-|HMI-|LIM-|RBAC-|NEG-|P11-|PROC-|TM-|ATT-|BKP-|ISO-|OQ-\d+)/;

export function isDocumentedOqId(id: string, traceIds: Set<string>): boolean {
  if (traceIds.has(id)) return true;
  return EXTENSION_ID_RE.test(id);
}

export function allTraceOqIds(): Set<string> {
  const s = new Set<string>();
  for (const ids of Object.values(TRACE_MAP)) {
    for (const id of ids) s.add(id);
  }
  return s;
}
