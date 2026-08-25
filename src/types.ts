export const APP_VERSION = '1.1.0';
export const DOC_ID = 'DOC-WH-INV-001';
export const DOC_VERSION = '1.1';
export const VALIDATION_BANNER =
  'Not validated — do not use for GMP decisions until IQ/OQ/PQ approved.';
export const SESSION_IDLE_MS = 15 * 60 * 1000;
export const DISPLAY_TZ = 'America/Los_Angeles';
export const LOCKOUT_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;
export const PASSWORD_EXPIRY_DAYS = 90;
export const PASSWORD_HISTORY_COUNT = 4;
export const PBKDF2_ITERATIONS = 100_000;

export const CAPABILITIES = [
  'viewDashboard',
  'viewRegister',
  'viewAudit',
  'viewAccessLog',
  'receive',
  'transfer',
  'issue',
  'returnToStock',
  'cycleCount',
  'reprintLabel',
  'scanLookup',
  'hold',
  'qaDisposition',
  'destroy',
  'adminMaterials',
  'adminUsers',
  'editPermissionMatrix',
  'backupRestore',
  'exportReports',
  'eSign',
] as const;
export type Capability = (typeof CAPABILITIES)[number];

export const CAPABILITY_GROUPS: { id: string; label: string; caps: Capability[] }[] = [
  {
    id: 'view',
    label: 'View',
    caps: ['viewDashboard', 'viewRegister', 'viewAudit', 'viewAccessLog', 'scanLookup'],
  },
  {
    id: 'inventory',
    label: 'Inventory',
    caps: ['receive', 'transfer', 'issue', 'returnToStock', 'cycleCount', 'reprintLabel'],
  },
  {
    id: 'qa',
    label: 'QA',
    caps: ['hold', 'qaDisposition', 'destroy', 'eSign'],
  },
  {
    id: 'admin',
    label: 'Admin',
    caps: ['adminMaterials', 'adminUsers', 'editPermissionMatrix', 'backupRestore', 'exportReports'],
  },
];

export const CAPABILITY_LABELS: Record<Capability, string> = {
  viewDashboard: 'View dashboard',
  viewRegister: 'View inventory register',
  viewAudit: 'View audit trail',
  viewAccessLog: 'View access log',
  receive: 'Goods receipt',
  transfer: 'Location transfer',
  issue: 'Issue / dispense',
  returnToStock: 'Return to stock',
  cycleCount: 'Cycle count',
  reprintLabel: 'Reprint labels',
  scanLookup: 'Scan lookup',
  hold: 'Place / remove Hold',
  qaDisposition: 'QA disposition',
  destroy: 'Destruction',
  adminMaterials: 'Material master',
  adminUsers: 'User administration',
  editPermissionMatrix: 'Edit permission matrix',
  backupRestore: 'Backup / restore',
  exportReports: 'Export reports',
  eSign: 'Apply electronic signature',
};

/** Stable role IDs. Display names live on RoleRecord.name. */
export const SYSTEM_ROLE_IDS = [
  'sysadmin',
  'supervisor',
  'operator',
  'qa',
  'qc',
  'readonly',
] as const;
export type SystemRoleId = (typeof SYSTEM_ROLE_IDS)[number];

/** v1.0 display names → v1.1 roleIds (IndexedDB / session migration). */
export const LEGACY_ROLE_MAP: Record<string, string> = {
  'Warehouse Operator': 'operator',
  'Warehouse Supervisor': 'supervisor',
  QA: 'qa',
  'Read-Only': 'readonly',
};

export type RoleId = string;
/** @deprecated Use RoleId (role record id). Kept as alias for call-site churn. */
export type Role = RoleId;

export interface RoleRecord {
  roleId: string;
  name: string;
  description: string;
  system: boolean;
  active: boolean;
}

export interface SodRules {
  qaDispositionXorReceive: boolean;
  destroyRequiresESign: boolean;
  editMatrixXorQaDisposition: boolean;
}

export const DEFAULT_SOD: SodRules = {
  qaDispositionXorReceive: true,
  destroyRequiresESign: true,
  editMatrixXorQaDisposition: true,
};

export type MatrixRows = Record<string, Record<Capability, boolean>>;

export interface PermissionMatrixDocument {
  version: number;
  rows: MatrixRows;
  sod: SodRules;
  modifiedBy: string;
  modifiedOnUtc: string;
  approvedBy: string;
  approvedOnUtc: string;
  reasonForChange: string;
  meaningOfSignature: string;
  sodWaiver?: string;
}

export interface MatrixCellChange {
  roleId: string;
  capability: Capability;
  oldValue: boolean;
  newValue: boolean;
}

export interface PermissionMatrixHistory {
  id: string;
  version: number;
  snapshot: PermissionMatrixDocument;
  savedBy: string;
  savedOnUtc: string;
  reasonForChange: string;
  meaningOfSignature: string;
  cellChanges: MatrixCellChange[];
  sodWaiver?: string;
}

export type PasswordAlgorithm = 'sha256-salt' | 'pbkdf2-sha256';

export const ITEM_TYPES = [
  'Raw Material',
  'Excipient',
  'API',
  'Intermediate',
  'Packaging Component',
  'Finished Product',
  'Sample',
  'Retain Sample',
  'Reference Standard',
  'Consumable',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];

export const STATUSES = [
  'Quarantine',
  'Released',
  'Rejected',
  'Restricted',
  'Hold',
  'Issued',
  'Consumed',
  'Destroyed',
] as const;
export type Status = (typeof STATUSES)[number];

export const UOMS = ['kg', 'g', 'mg', 'L', 'mL', 'each', 'bottle', 'drum', 'bag', 'vial', 'pack'] as const;
export type Uom = (typeof UOMS)[number];

export const STORAGE_CONDITIONS = [
  'CRT 15–25 °C',
  '2–8 °C',
  '−20 °C',
  '−80 °C',
  'Controlled humidity',
  'Light-sensitive',
  'Flammable',
] as const;
export type StorageCondition = (typeof STORAGE_CONDITIONS)[number];

export const PHARMACOPEIAS = ['USP', 'EP', 'JP', 'In-house', 'NF', 'BP'] as const;
export type Pharmacopeia = (typeof PHARMACOPEIAS)[number];

export const CONTAINER_TYPES = [
  'Drum',
  'Bag',
  'Bottle',
  'Vial',
  'Carton',
  'Pallet',
  'IBC',
  'Ampoule',
  'Blister',
  'Other',
] as const;
export type ContainerType = (typeof CONTAINER_TYPES)[number];

export const QA_DISPOSITIONS = ['Release', 'Reject', 'Restricted'] as const;
export type QaDisposition = (typeof QA_DISPOSITIONS)[number];

export interface Location {
  site: string;
  building: string;
  room: string;
  rack: string;
  shelf: string;
  bin: string;
}

export interface UserRecord {
  userId: string;
  fullName: string;
  role: RoleId;
  passwordHash: string;
  salt: string;
  algorithm: PasswordAlgorithm;
  active: boolean;
  mustChangePassword: boolean;
  createdOnUtc: string;
  lastLoginUtc?: string;
  failedAttempts: number;
  lockedUntilUtc?: string;
  lockReason?: string;
  passwordChangedUtc?: string;
  passwordHistory: string[];
}

export interface Session {
  userId: string;
  fullName: string;
  role: RoleId;
  roleName: string;
  startedUtc: string;
  lastActivityUtc: string;
  mustChangePassword: boolean;
}

export interface Material {
  materialCode: string;
  materialName: string;
  itemType: ItemType;
  gradeSpec: string;
  pharmacopeia: Pharmacopeia;
  defaultUom: Uom;
  defaultStorage: StorageCondition;
  samplingRequiredDefault: boolean;
  active: boolean;
  createdBy: string;
  createdOnUtc: string;
  modifiedBy: string;
  modifiedOnUtc: string;
}

export interface ESign {
  userId: string;
  printedName: string;
  signedAtUtc: string;
  meaningOfSignature: string;
}

export interface InventoryRecord {
  serial: string;
  barcode: string;
  materialCode: string;
  materialName: string;
  itemType: ItemType;
  gradeSpec: string;
  pharmacopeia: Pharmacopeia;
  manufacturer: string;
  manufacturerLot: string;
  supplier: string;
  supplierLot: string;
  poDeliveryNote: string;
  coaNumber: string;
  internalLot: string;
  qtyReceived: number;
  currentQty: number;
  uom: Uom;
  numberOfContainers: number;
  containerType: ContainerType;
  dateOfManufacture: string;
  receiptDate: string;
  expiryDate: string;
  retestDate: string;
  location: Location;
  storageCondition: StorageCondition;
  status: Status;
  samplingRequired: boolean;
  linkedSampleIds: string;
  comments: string;
  createdBy: string;
  createdOnUtc: string;
  modifiedBy: string;
  modifiedOnUtc: string;
  qaDisposition?: QaDisposition;
  qaEsign?: ESign;
  destructionReason?: string;
  destructionEsign?: ESign;
  holdReason?: string;
}

export interface Movement {
  id: string;
  serial: string;
  action: string;
  qty: number;
  fromLocation: string;
  toLocation: string;
  performedBy: string;
  performedOnUtc: string;
  reason: string;
  comments: string;
}

export interface AuditEntry {
  id: string;
  timestampUtc: string;
  timestampLocal: string;
  userId: string;
  userName: string;
  action: string;
  recordId: string;
  field: string;
  oldValue: string;
  newValue: string;
  reasonForChange: string;
  meaningOfSignature: string;
}

export interface AccessLogEntry {
  id: string;
  timestampUtc: string;
  userId: string;
  userName: string;
  event: string;
  detail: string;
}

export interface SerialCounter {
  year: number;
  lastN: number;
}

export type AuditAction =
  | 'CREATE'
  | 'UPDATE'
  | 'RECEIVE'
  | 'QA_DISPOSITION'
  | 'TRANSFER'
  | 'ISSUE'
  | 'RETURN'
  | 'HOLD'
  | 'UNHOLD'
  | 'CYCLE_COUNT'
  | 'DESTROY'
  | 'PRINT_LABEL'
  | 'LOGIN'
  | 'LOGOUT'
  | 'SESSION_TIMEOUT'
  | 'BACKUP'
  | 'RESTORE'
  | 'USER_CREATE'
  | 'USER_UPDATE'
  | 'USER_UNLOCK'
  | 'PASSWORD_CHANGE'
  | 'MATERIAL_CREATE'
  | 'MATERIAL_UPDATE'
  | 'MATRIX_SAVE'
  | 'ROLE_CREATE'
  | 'ROLE_UPDATE';
