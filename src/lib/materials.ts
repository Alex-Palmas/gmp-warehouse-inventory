import type { Material, Session } from '../types';
import { getDb } from './db';
import { appendAudit } from './audit';
import { nowUtcIso } from './dates';
import { hasCapability } from './permissions';

export async function listMaterials(): Promise<Material[]> {
  const db = await getDb();
  const all = (await db.getAll('materials')) as Material[];
  all.sort((a, b) => a.materialCode.localeCompare(b.materialCode));
  return all;
}

export async function getMaterial(code: string): Promise<Material | undefined> {
  const db = await getDb();
  return (await db.get('materials', code)) as Material | undefined;
}

export async function saveMaterial(
  session: Session,
  rec: Material,
  isNew: boolean,
  reason: string,
): Promise<Material> {
  const viaMaster = await hasCapability(session, 'adminMaterials');
  const viaApprove = isNew && (await hasCapability(session, 'approveMaterial'));
  if (!viaMaster && !viaApprove) {
    throw new Error('Material master capability required');
  }
  if (!rec.materialCode.trim() || !rec.materialName.trim()) throw new Error('Code and name required');
  const db = await getDb();
  rec.modifiedBy = session.userId;
  rec.modifiedOnUtc = nowUtcIso();
  if (isNew) {
    const existing = await db.get('materials', rec.materialCode);
    if (existing) throw new Error('Material code already exists');
    rec.createdBy = session.userId;
    rec.createdOnUtc = rec.modifiedOnUtc;
    await db.add('materials', rec);
    await appendAudit(session, {
      action: 'MATERIAL_CREATE',
      recordId: rec.materialCode,
      field: 'materialName',
      newValue: rec.materialName,
      reasonForChange: reason || 'Material created',
    });
  } else {
    if (!reason.trim()) throw new Error('Reason for change is required');
    const old = (await db.get('materials', rec.materialCode)) as Material | undefined;
    if (!old) throw new Error('Material not found');
    await db.put('materials', rec);
    await appendAudit(session, {
      action: 'MATERIAL_UPDATE',
      recordId: rec.materialCode,
      field: 'record',
      oldValue: old.materialName,
      newValue: rec.materialName,
      reasonForChange: reason,
    });
  }
  return rec;
}
