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

const DB_NAME = 'gmp-wh-inv';
const DB_VERSION = 4;

let _db: IDBPDatabase | null = null;

export async function getDb(): Promise<IDBPDatabase> {
  if (_db) return _db;
  _db = await openDB(DB_NAME, DB_VERSION, {
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
