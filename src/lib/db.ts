import { openDB, type IDBPDatabase } from 'idb';
import type {
  AccessLogEntry,
  AttachmentRecord,
  AuditEntry,
  InboxMessage,
  InventoryRecord,
  Material,
  MaterialRequest,
  MaterialSubmission,
  Movement,
  PermissionMatrixDocument,
  PermissionMatrixHistory,
  RoleRecord,
  SerialCounter,
  UserRecord,
} from '../types';

export const PROD_DB_NAME = 'gmp-wh-inv';
export const OQ_DB_NAME = 'gmp-wh-inv-oq';
const DB_VERSION = 4;

let _db: IDBPDatabase | null = null;
let _dbName: string = PROD_DB_NAME;

export function currentDbName(): string {
  return _dbName;
}

export async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(currentDbName(), DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'userId' });
      if (!db.objectStoreNames.contains('materials'))
        db.createObjectStore('materials', { keyPath: 'materialCode' });
      if (!db.objectStoreNames.contains('inventory'))
        db.createObjectStore('inventory', { keyPath: 'serial' });
      if (!db.objectStoreNames.contains('movements'))
        db.createObjectStore('movements', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('audit')) db.createObjectStore('audit', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('accessLog'))
        db.createObjectStore('accessLog', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('roles')) db.createObjectStore('roles', { keyPath: 'roleId' });
      if (!db.objectStoreNames.contains('permissionMatrixHistory'))
        db.createObjectStore('permissionMatrixHistory', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('materialSubmissions'))
        db.createObjectStore('materialSubmissions', { keyPath: 'submissionId' });
      if (!db.objectStoreNames.contains('materialRequests'))
        db.createObjectStore('materialRequests', { keyPath: 'requestId' });
      if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('attachments')) {
        const s = db.createObjectStore('attachments', { keyPath: 'id' });
        s.createIndex('recordId', 'recordId');
      }
    },
  });
  return _db;
}

export async function resetDbConnection(): Promise<void> {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export async function deleteDatabase(name: string): Promise<void> {
  if (_db && _dbName === name) {
    await resetDbConnection();
  }
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error ?? new Error(`deleteDatabase(${name}) failed`));
    req.onblocked = () => resolve();
  });
}

/**
 * Run fn against a named IndexedDB. Always restores the previous database name
 * (production by default) and drops the in-memory connection + matrix cache,
 * even if fn throws. Self-validation MUST use withDatabase(OQ_DB_NAME, ...).
 */
export async function withDatabase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const { setMatrixCacheForTests } = await import('./permissions');
  const previous = _dbName;
  _dbName = name;
  await resetDbConnection();
  setMatrixCacheForTests(null);
  try {
    return await fn();
  } finally {
    _dbName = previous;
    await resetDbConnection();
    setMatrixCacheForTests(null);
  }
}

export type AttachmentBackupRow = Omit<AttachmentRecord, 'blob'> & { dataBase64: string };

export type BackupPayload = {
  appVersion: string;
  exportedAtUtc: string;
  users: UserRecord[];
  materials: Material[];
  inventory: InventoryRecord[];
  movements: Movement[];
  audit: AuditEntry[];
  accessLog: AccessLogEntry[];
  roles: RoleRecord[];
  permissionMatrix: PermissionMatrixDocument | null;
  permissionMatrixHistory: PermissionMatrixHistory[];
  serialCounter: SerialCounter | null;
  receiptBatchCounter: SerialCounter | null;
  requestCounter: SerialCounter | null;
  submissionCounter: SerialCounter | null;
  materialSubmissions: MaterialSubmission[];
  materialRequests: MaterialRequest[];
  inbox: InboxMessage[];
  attachments?: AttachmentBackupRow[];
  seeded: boolean;
};
