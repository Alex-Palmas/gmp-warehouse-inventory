import type { ItemType, Material, MaterialSubmission, Pharmacopeia, Session, StorageCondition, Uom } from '../types';
import { getDb } from './db';
import { appendAudit } from './audit';
import { nowUtcIso } from './dates';
import { notifyCapability, notifyUser } from './inbox';
import { saveMaterial } from './materials';
import { assertCapability, hasCapability } from './permissions';
import { formatSubmissionId } from './serial';
import type { SerialCounter } from '../types';

async function nextSubmissionId(): Promise<string> {
  const db = await getDb();
  const year = new Date().getUTCFullYear();
  const c = ((await db.get('meta', 'submissionCounter')) as SerialCounter | undefined) ?? { year, lastN: 0 };
  const n = c.year === year ? c.lastN + 1 : 1;
  const id = formatSubmissionId(year, n);
  await db.put('meta', { year, lastN: n }, 'submissionCounter');
  return id;
}

export async function listSubmissions(): Promise<MaterialSubmission[]> {
  const db = await getDb();
  const all = (await db.getAll('materialSubmissions')) as MaterialSubmission[];
  all.sort((a, b) => b.submittedOnUtc.localeCompare(a.submittedOnUtc));
  return all;
}

export async function getSubmission(id: string): Promise<MaterialSubmission | undefined> {
  const db = await getDb();
  return (await db.get('materialSubmissions', id)) as MaterialSubmission | undefined;
}

export type SubmitMaterialInput = {
  materialCode?: string;
  materialName: string;
  itemType: ItemType;
  gradeSpec: string;
  pharmacopeia: Pharmacopeia;
  defaultUom: Uom;
  defaultStorage: StorageCondition;
  samplingRequiredDefault: boolean;
  manufacturerHint: string;
  supplierHint: string;
  justification: string;
};

export async function submitMaterial(session: Session, input: SubmitMaterialInput): Promise<MaterialSubmission> {
  await assertCapability(session, 'submitMaterial', 'Role cannot submit materials');
  if (!input.materialName.trim()) throw new Error('Material name is required');
  if (!input.justification.trim()) throw new Error('Justification is required');
  const code = (input.materialCode || '').trim().toUpperCase();
  const db = await getDb();
  if (code) {
    const existing = await db.get('materials', code);
    if (existing) throw new Error('Material code already exists on the Material Master');
  }
  const submissionId = await nextSubmissionId();
  const rec: MaterialSubmission = {
    submissionId,
    materialCode: code,
    materialName: input.materialName.trim(),
    itemType: input.itemType,
    gradeSpec: input.gradeSpec,
    pharmacopeia: input.pharmacopeia,
    defaultUom: input.defaultUom,
    defaultStorage: input.defaultStorage,
    samplingRequiredDefault: input.samplingRequiredDefault,
    manufacturerHint: input.manufacturerHint,
    supplierHint: input.supplierHint,
    justification: input.justification.trim(),
    status: 'Submitted',
    submittedBy: session.userId,
    submittedOnUtc: nowUtcIso(),
  };
  await db.add('materialSubmissions', rec);
  await appendAudit(session, {
    action: 'MATERIAL_SUBMIT',
    recordId: submissionId,
    field: 'status',
    oldValue: '',
    newValue: 'Submitted',
    reasonForChange: rec.justification,
  });
  await notifyCapability(
    'adminMaterials',
    `Material submission ${submissionId}`,
    `${session.fullName} proposed ${rec.materialName} (${code || 'code TBD'}).`,
    'request_submitted',
    submissionId,
    session.userId,
  );
  return rec;
}

export async function approveMaterialSubmission(
  session: Session,
  submissionId: string,
  assignedCode: string,
  reason: string,
): Promise<{ submission: MaterialSubmission; material: Material }> {
  const canQa = await hasCapability(session, 'qaDisposition');
  const canSup = session.role === 'supervisor' || (await hasCapability(session, 'adminMaterials'));
  if (!canQa && !canSup) throw new Error('Only QA or a supervisor may approve material submissions');
  const rec = await getSubmission(submissionId);
  if (!rec) throw new Error('Submission not found');
  if (rec.status !== 'Submitted') throw new Error(`Cannot approve a ${rec.status} submission`);
  const code = (assignedCode || rec.materialCode).trim().toUpperCase();
  if (!code) throw new Error('Material code is required for approval');
  const utc = nowUtcIso();
  const material: Material = {
    materialCode: code,
    materialName: rec.materialName,
    itemType: rec.itemType,
    gradeSpec: rec.gradeSpec,
    pharmacopeia: rec.pharmacopeia,
    defaultUom: rec.defaultUom,
    defaultStorage: rec.defaultStorage,
    samplingRequiredDefault: rec.samplingRequiredDefault,
    active: true,
    createdBy: session.userId,
    createdOnUtc: utc,
    modifiedBy: session.userId,
    modifiedOnUtc: utc,
  };
  await saveMaterial(session, material, true, reason || `Approved submission ${submissionId}`);
  rec.status = 'Approved';
  rec.materialCode = code;
  rec.reviewedBy = session.userId;
  rec.reviewedOnUtc = utc;
  const db = await getDb();
  await db.put('materialSubmissions', rec);
  await appendAudit(session, {
    action: 'MATERIAL_APPROVE',
    recordId: submissionId,
    field: 'status',
    oldValue: 'Submitted',
    newValue: 'Approved',
    reasonForChange: reason || `Wrote Material Master ${code}`,
  });
  await notifyUser(
    rec.submittedBy,
    `Material ${code} approved`,
    `${rec.materialName} is now on the Material Master and available for goods receipt.`,
    'material_approved',
    submissionId,
  );
  return { submission: rec, material };
}

export async function rejectMaterialSubmission(
  session: Session,
  submissionId: string,
  reason: string,
): Promise<MaterialSubmission> {
  const canQa = await hasCapability(session, 'qaDisposition');
  const canSup = session.role === 'supervisor' || (await hasCapability(session, 'adminMaterials'));
  if (!canQa && !canSup) throw new Error('Only QA or a supervisor may reject material submissions');
  if (!reason.trim()) throw new Error('Reject reason is required');
  const rec = await getSubmission(submissionId);
  if (!rec) throw new Error('Submission not found');
  if (rec.status !== 'Submitted') throw new Error(`Cannot reject a ${rec.status} submission`);
  rec.status = 'Rejected';
  rec.rejectReason = reason.trim();
  rec.reviewedBy = session.userId;
  rec.reviewedOnUtc = nowUtcIso();
  const db = await getDb();
  await db.put('materialSubmissions', rec);
  await appendAudit(session, {
    action: 'MATERIAL_REJECT',
    recordId: submissionId,
    field: 'status',
    oldValue: 'Submitted',
    newValue: 'Rejected',
    reasonForChange: reason,
  });
  await notifyUser(
    rec.submittedBy,
    `Material submission ${submissionId} rejected`,
    reason,
    'material_rejected',
    submissionId,
  );
  return rec;
}
