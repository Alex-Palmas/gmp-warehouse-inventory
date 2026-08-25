import { openDB, type IDBPDatabase } from 'idb';
import type {
  AccessLogEntry,
  AuditEntry,
  InventoryRecord,
  Material,
  Movement,
  PermissionMatrixDocument,
  PermissionMatrixHistory,
  RoleRecord,
  SerialCounter,
  UserRecord,
} from '../types';

const DB_NAME = 'gmp-wh-inv';
const DB_VERSION = 2;

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
  seeded: boolean;
};
