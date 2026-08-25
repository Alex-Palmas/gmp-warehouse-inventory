import type { InventoryRecord, Material, UserRecord } from '../types';
import { getDb } from './db';
import { hashPasswordSha256Salt } from './crypto';
import { nowUtcIso } from './dates';
import { DEFAULT_ROLES, buildDefaultMatrixDocument, hydrateMatrixDocument, resolveRoleId, setMatrixCacheForTests } from './permissions';

const DEMO_SALT = 'gmp-demo-salt-v1';

/** Demo passwords exist only to seed the local app. Documented in README. Production MUST change. */
const DEMO_USERS: { userId: string; fullName: string; role: string; password: string }[] = [
  { userId: 'sysadmin', fullName: 'Casey SysAdmin', role: 'sysadmin', password: 'Sysadmin123!' },
  { userId: 'admin', fullName: 'Alex Supervisor', role: 'supervisor', password: 'Admin123!' },
  { userId: 'qa', fullName: 'Jordan QA', role: 'qa', password: 'Qa123!' },
  { userId: 'qc', fullName: 'Morgan QC', role: 'qc', password: 'Qc123!' },
  { userId: 'wh', fullName: 'Sam Operator', role: 'operator', password: 'Wh123!' },
  { userId: 'ro', fullName: 'Riley ReadOnly', role: 'readonly', password: 'Ro123!' },
  { userId: 'lab', fullName: 'Lee Lab Requester', role: 'requester', password: 'LabUser123!x' },
];

const MATERIALS: Omit<Material, 'createdBy' | 'createdOnUtc' | 'modifiedBy' | 'modifiedOnUtc'>[] = [
  {
    materialCode: 'RM-001',
    materialName: 'Lactose Monohydrate',
    itemType: 'Excipient',
    gradeSpec: 'NF / Ph. Eur. 200 mesh',
    pharmacopeia: 'USP',
    defaultUom: 'kg',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'RM-002',
    materialName: 'Microcrystalline Cellulose',
    itemType: 'Excipient',
    gradeSpec: 'PH-102',
    pharmacopeia: 'USP',
    defaultUom: 'kg',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'RM-003',
    materialName: 'Magnesium Stearate',
    itemType: 'Excipient',
    gradeSpec: 'Vegetable grade',
    pharmacopeia: 'NF',
    defaultUom: 'kg',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'API-001',
    materialName: 'Ibuprofen',
    itemType: 'API',
    gradeSpec: 'USP micronized',
    pharmacopeia: 'USP',
    defaultUom: 'kg',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'API-002',
    materialName: 'Acetaminophen',
    itemType: 'API',
    gradeSpec: 'USP compactable',
    pharmacopeia: 'USP',
    defaultUom: 'kg',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'PKG-001',
    materialName: 'HDPE Bottle 100 mL',
    itemType: 'Packaging Component',
    gradeSpec: 'Pharma grade, 38-400 neck',
    pharmacopeia: 'In-house',
    defaultUom: 'each',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: false,
    active: true,
  },
  {
    materialCode: 'PKG-002',
    materialName: 'Child-Resistant Cap 38 mm',
    itemType: 'Packaging Component',
    gradeSpec: 'CRC, induction liner',
    pharmacopeia: 'In-house',
    defaultUom: 'each',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: false,
    active: true,
  },
  {
    materialCode: 'INT-001',
    materialName: 'Granulation Blend A',
    itemType: 'Intermediate',
    gradeSpec: 'In-process spec IPS-A-01',
    pharmacopeia: 'In-house',
    defaultUom: 'kg',
    defaultStorage: 'Controlled humidity',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'FP-001',
    materialName: 'Ibuprofen Tablet 200 mg',
    itemType: 'Finished Product',
    gradeSpec: 'NDA-spec, 200 mg',
    pharmacopeia: 'USP',
    defaultUom: 'bottle',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: true,
    active: true,
  },
  {
    materialCode: 'CON-001',
    materialName: 'Nitrile Gloves L',
    itemType: 'Consumable',
    gradeSpec: 'Powder-free exam',
    pharmacopeia: 'In-house',
    defaultUom: 'pack',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: false,
    active: true,
  },
  {
    materialCode: 'RS-001',
    materialName: 'Ibuprofen Reference Standard',
    itemType: 'Reference Standard',
    gradeSpec: 'USP RS',
    pharmacopeia: 'USP',
    defaultUom: 'mg',
    defaultStorage: '2–8 °C',
    samplingRequiredDefault: false,
    active: true,
  },
  {
    materialCode: 'SAM-001',
    materialName: 'Retain Sample Vial 20 mL',
    itemType: 'Retain Sample',
    gradeSpec: 'Amber glass',
    pharmacopeia: 'In-house',
    defaultUom: 'vial',
    defaultStorage: 'CRT 15–25 °C',
    samplingRequiredDefault: false,
    active: true,
  },
];

function loc(bin: string) {
  return { site: 'MAIN', building: 'WH-1', room: 'RM-W01', rack: 'R' + bin[0], shelf: 'S1', bin };
}

async function seedAccessControl(): Promise<void> {
  const db = await getDb();
  for (const r of DEFAULT_ROLES) {
    const existing = await db.get('roles', r.roleId);
    if (!existing) await db.put('roles', r);
  }
  if (!(await db.get('meta', 'permissionMatrix'))) {
    await db.put('meta', buildDefaultMatrixDocument(), 'permissionMatrix');
  } else {
    const existing = await db.get('meta', 'permissionMatrix');
    if (existing) {
      const hydrated = hydrateMatrixDocument(existing);
      await db.put('meta', hydrated, 'permissionMatrix');
    }
  }
  setMatrixCacheForTests(null);
  const utc = '2026-01-15T16:00:00.000Z';
  const users = (await db.getAll('users')) as UserRecord[];
  for (const u of users) {
    let dirty = false;
    const next: UserRecord = { ...u };
    const mapped = resolveRoleId(u.role);
    if (mapped !== u.role) {
      next.role = mapped;
      dirty = true;
    }
    if (!next.algorithm) {
      next.algorithm = 'sha256-salt';
      dirty = true;
    }
    if (next.failedAttempts === undefined) {
      next.failedAttempts = 0;
      dirty = true;
    }
    if (!next.passwordHistory) {
      next.passwordHistory = [];
      dirty = true;
    }
    if (dirty) await db.put('users', next);
  }
  for (const u of DEMO_USERS) {
    if (await db.get('users', u.userId)) continue;
    const rec: UserRecord = {
      userId: u.userId,
      fullName: u.fullName,
      role: u.role,
      salt: DEMO_SALT,
      passwordHash: await hashPasswordSha256Salt(u.password, DEMO_SALT),
      algorithm: 'sha256-salt',
      active: true,
      mustChangePassword: true,
      createdOnUtc: utc,
      failedAttempts: 0,
      passwordHistory: [],
    };
    await db.put('users', rec);
  }
}

export async function migrateInventoryRecords(): Promise<void> {
  const db = await getDb();
  if (!db.objectStoreNames.contains('inventory')) return;
  const all = (await db.getAll('inventory')) as InventoryRecord[];
  for (const r of all) {
    let dirty = false;
    const next: InventoryRecord = { ...r };
    if (!next.receiptBatchId) {
      next.receiptBatchId = next.serial;
      dirty = true;
    }
    if (!next.containerIndex) {
      next.containerIndex = 1;
      dirty = true;
    }
    if (!next.recordKind) {
      next.recordKind = 'container';
      dirty = true;
    }
    if (next.qtyPerContainer == null) {
      next.qtyPerContainer = next.qtyReceived || next.currentQty;
      dirty = true;
    }
    if (dirty) await db.put('inventory', next);
  }
}

export async function ensureSeeded(): Promise<void> {
  const db = await getDb();
  await seedAccessControl();
  await migrateInventoryRecords();
  if (await db.get('meta', 'seeded')) return;
  const utc = '2026-01-15T16:00:00.000Z';
  for (const u of DEMO_USERS) {
    if (await db.get('users', u.userId)) continue;
    const rec: UserRecord = {
      userId: u.userId,
      fullName: u.fullName,
      role: u.role,
      salt: DEMO_SALT,
      passwordHash: await hashPasswordSha256Salt(u.password, DEMO_SALT),
      algorithm: 'sha256-salt',
      active: true,
      mustChangePassword: true,
      createdOnUtc: utc,
      failedAttempts: 0,
      passwordHistory: [],
    };
    await db.put('users', rec);
  }
  for (const m of MATERIALS) {
    const rec: Material = {
      ...m,
      createdBy: 'admin',
      createdOnUtc: utc,
      modifiedBy: 'admin',
      modifiedOnUtc: utc,
    };
    await db.put('materials', rec);
  }

  const rows: InventoryRecord[] = [
    inv('WH-2026-000001', 'API-001', 'Ibuprofen', 'API', 'Released', 25, 'kg', '2028-06-30', 'MFR-IBU-4412', 'Q1'),
    inv('WH-2026-000002', 'API-001', 'Ibuprofen', 'API', 'Released', 25, 'kg', '2027-03-15', 'MFR-IBU-3988', 'Q1'),
    inv('WH-2026-000003', 'API-001', 'Ibuprofen', 'API', 'Quarantine', 25, 'kg', '2029-01-10', 'MFR-IBU-5100', 'Q2'),
    inv('WH-2026-000004', 'RM-001', 'Lactose Monohydrate', 'Excipient', 'Quarantine', 50, 'kg', '2028-11-01', 'LAC-9921', 'Q3'),
    inv('WH-2026-000005', 'RM-002', 'Microcrystalline Cellulose', 'Excipient', 'Released', 40, 'kg', '2027-08-20', 'MCC-2201', 'Q4'),
    inv('WH-2026-000006', 'RM-003', 'Magnesium Stearate', 'Excipient', 'Quarantine', 10, 'kg', '2027-12-01', 'MGS-1104', 'Q5'),
    inv('WH-2026-000007', 'API-002', 'Acetaminophen', 'API', 'ExpiredLot', 30, 'kg', '2025-12-31', 'APAP-771', 'Q6'),
    inv('WH-2026-000008', 'PKG-001', 'HDPE Bottle 100 mL', 'Packaging Component', 'Released', 5000, 'each', '2029-05-01', 'BTL-330', 'Q7'),
    inv('WH-2026-000009', 'PKG-002', 'Child-Resistant Cap 38 mm', 'Packaging Component', 'Quarantine', 5000, 'each', '2029-05-01', 'CAP-330', 'Q8'),
    inv('WH-2026-000010', 'INT-001', 'Granulation Blend A', 'Intermediate', 'Restricted', 80, 'kg', '2026-12-15', 'INTA-09', 'Q9'),
    inv('WH-2026-000011', 'FP-001', 'Ibuprofen Tablet 200 mg', 'Finished Product', 'Quarantine', 200, 'bottle', '2028-02-28', 'LOT-FP-1001', 'QA'),
    inv('WH-2026-000012', 'RS-001', 'Ibuprofen Reference Standard', 'Reference Standard', 'Released', 100, 'mg', '2026-10-01', 'USP-RS-IBU', 'QB'),
    inv('WH-2026-000013', 'CON-001', 'Nitrile Gloves L', 'Consumable', 'Released', 40, 'pack', '2028-01-01', 'GLV-55', 'QC'),
    inv('WH-2026-000014', 'API-001', 'Ibuprofen', 'API', 'Issued', 0, 'kg', '2027-01-20', 'MFR-IBU-3001', 'QD'),
  ];
  for (const r of rows) await db.put('inventory', r);

  // Multi-vial receipt: 6 unique serials, one receiptBatchId (21 CFR 211.80(d) each-container).
  const vialBatch = 'RCV-2026-000001';
  const vialUtc = '2026-03-01T17:00:00.000Z';
  for (let i = 0; i < 6; i++) {
    const serial = `WH-2026-${String(15 + i).padStart(6, '0')}`;
    const rec = inv(serial, 'RS-001', 'Ibuprofen Reference Standard', 'Reference Standard', 'Released', 10, 'mg', '2026-10-01', 'USP-RS-IBU', 'QB');
    rec.receiptBatchId = vialBatch;
    rec.containerIndex = i + 1;
    rec.numberOfContainers = 6;
    rec.containerType = 'Vial';
    rec.qtyPerContainer = 10;
    rec.qtyReceived = 10;
    rec.currentQty = 10;
    rec.recordKind = 'container';
    rec.storageCondition = '2–8 °C';
    rec.createdOnUtc = vialUtc;
    rec.modifiedOnUtc = vialUtc;
    rec.comments = 'Seed: per-container serialized vials (1 of 6)';
    await db.put('inventory', rec);
  }

  // Multi-drum receipt: 3 unique serials, shared receiptBatchId, Quarantine for batch QA release demo.
  const drumBatch = 'RCV-2026-000002';
  const drumUtc = '2026-03-02T17:00:00.000Z';
  for (let i = 0; i < 3; i++) {
    const serial = `WH-2026-${String(21 + i).padStart(6, '0')}`;
    const rec = inv(serial, 'RM-001', 'Lactose Monohydrate', 'Excipient', 'Quarantine', 25, 'kg', '2028-11-01', 'LAC-9930', 'Q3');
    rec.receiptBatchId = drumBatch;
    rec.containerIndex = i + 1;
    rec.numberOfContainers = 3;
    rec.containerType = 'Drum';
    rec.qtyPerContainer = 25;
    rec.qtyReceived = 25;
    rec.currentQty = 25;
    rec.recordKind = 'container';
    rec.createdOnUtc = drumUtc;
    rec.modifiedOnUtc = drumUtc;
    rec.comments = 'Seed: per-container serialized drums (1 of 3)';
    rec.qaDisposition = undefined;
    rec.qaEsign = undefined;
    rec.modifiedBy = 'admin';
    await db.put('inventory', rec);
  }

  // Sample child pulled from WH-2026-000005 (MCC drum).
  const parent = (await db.get('inventory', 'WH-2026-000005')) as InventoryRecord | undefined;
  if (parent) {
    parent.currentQty = 39.5;
    parent.linkedSampleIds = 'WH-2026-000024';
    await db.put('inventory', parent);
  }
  const sample = inv('WH-2026-000024', 'RM-002', 'Microcrystalline Cellulose', 'Sample', 'Released', 0.5, 'kg', '2027-08-20', 'MCC-2201', 'Q4');
  sample.receiptBatchId = 'RCV-2026-000003';
  sample.containerIndex = 1;
  sample.numberOfContainers = 1;
  sample.containerType = 'Bottle';
  sample.qtyPerContainer = 0.5;
  sample.qtyReceived = 0.5;
  sample.currentQty = 0.5;
  sample.recordKind = 'sample';
  sample.parentSerial = 'WH-2026-000005';
  sample.itemType = 'Sample';
  sample.comments = 'Seed: QC sample pulled from parent WH-2026-000005';
  sample.qaDisposition = 'Release';
  await db.put('inventory', sample);

  await db.put('meta', { year: 2026, lastN: 24 }, 'serialCounter');
  await db.put('meta', { year: 2026, lastN: 3 }, 'receiptBatchCounter');
  await db.put('meta', true, 'seeded');
}

function inv(
  serial: string,
  code: string,
  name: string,
  itemType: InventoryRecord['itemType'],
  statusFlag: string,
  qty: number,
  uom: InventoryRecord['uom'],
  expiry: string,
  mfrLot: string,
  bin: string,
): InventoryRecord {
  const expired = statusFlag === 'ExpiredLot';
  const status: InventoryRecord['status'] = expired ? 'Released' : (statusFlag as InventoryRecord['status']);
  const utc = '2026-02-01T17:00:00.000Z';
  const rec: InventoryRecord = {
    serial,
    barcode: serial,
    materialCode: code,
    materialName: name,
    itemType,
    gradeSpec: 'See material master',
    pharmacopeia: 'USP',
    manufacturer: 'Demo Manufacturer Inc.',
    manufacturerLot: mfrLot,
    supplier: 'Demo Supplier LLC',
    supplierLot: `SUP-${mfrLot}`,
    poDeliveryNote: `PO-2026-${serial.slice(-4)}`,
    coaNumber: `COA-${mfrLot}`,
    internalLot: `IL-${serial.slice(-6)}`,
    qtyReceived: qty === 0 ? 25 : qty,
    currentQty: qty,
    uom,
    numberOfContainers: 1,
    containerType: uom === 'each' || uom === 'bottle' ? 'Carton' : 'Drum',
    receiptBatchId: serial,
    containerIndex: 1,
    qtyPerContainer: qty === 0 ? 25 : qty,
    recordKind: 'container',
    dateOfManufacture: '2025-01-15',
    receiptDate: '2026-02-01',
    expiryDate: expiry,
    retestDate: '',
    location: loc(bin),
    storageCondition: code === 'RS-001' ? '2–8 °C' : 'CRT 15–25 °C',
    status,
    samplingRequired: itemType === 'API' || itemType === 'Excipient' || itemType === 'Raw Material',
    linkedSampleIds: '',
    comments: expired ? 'SEED: expired lot for OQ expiry-block test' : 'Seed data',
    createdBy: 'admin',
    createdOnUtc: utc,
    modifiedBy: status === 'Released' ? 'qa' : 'admin',
    modifiedOnUtc: utc,
  };
  if (status === 'Released' || status === 'Issued') {
    rec.qaDisposition = 'Release';
    rec.qaEsign = {
      userId: 'qa',
      printedName: 'Jordan QA',
      signedAtUtc: utc,
      meaningOfSignature: 'I attest this lot is released for GMP use per CoA and specification.',
    };
  }
  if (status === 'Restricted') {
    rec.qaDisposition = 'Restricted';
    rec.qaEsign = {
      userId: 'qa',
      printedName: 'Jordan QA',
      signedAtUtc: utc,
      meaningOfSignature: 'Restricted to engineering use only pending investigation.',
    };
  }
  if (status === 'Issued') {
    rec.qtyReceived = 25;
    rec.currentQty = 0;
  }
  return rec;
}

export { nowUtcIso };
