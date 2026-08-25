/**
 * Append-only CoA / certificate attachments. File bytes live in IndexedDB, not on inventory rows.
 * There is intentionally NO update or delete API.
 */
import {
  ATTACHMENT_CATEGORIES,
  type AttachmentCategory,
  type AttachmentRecord,
  type AttachmentScope,
  type InventoryRecord,
  type Session,
} from '../types';
import { appendAudit } from './audit';
import { nowUtcIso } from './dates';
import { getDb } from './db';
import { newId } from './ids';
import { hasCapability } from './permissions';

export const MAX_BYTES = 10 * 1024 * 1024;

export const ALLOWED_MIME = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
] as const;

export const ATTACH_ACCEPT =
  '.pdf,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/jpeg,image/png,image/webp,image/gif';

const ALLOWED_MIME_SET = new Set<string>(ALLOWED_MIME);

const EXT_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

export type AddAttachmentInput = {
  scope: AttachmentScope;
  recordId: string;
  file: File;
  category: AttachmentCategory;
};

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function bytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return bytesToHex(new Uint8Array(digest));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function mimeFromFileName(fileName: string): string | undefined {
  const lower = fileName.toLowerCase();
  for (const [ext, mime] of Object.entries(EXT_MIME)) {
    if (lower.endsWith(ext)) return mime;
  }
  return undefined;
}

export function isAllowedAttachment(file: Pick<File, 'type' | 'name'>): boolean {
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIME_SET.has(mime)) return true;
  if (!mime && mimeFromFileName(file.name)) return true;
  return false;
}

function inferMime(file: Pick<File, 'type' | 'name'>): string {
  const mime = (file.type || '').toLowerCase();
  if (ALLOWED_MIME_SET.has(mime)) return mime;
  return mimeFromFileName(file.name) || mime || 'application/octet-stream';
}

/** Read bytes from a Blob, File, ArrayBuffer, or typed array (jsdom File has no arrayBuffer). */
export async function readBlobBytes(input: Blob | ArrayBuffer | ArrayBufferView): Promise<Uint8Array> {
  if (input instanceof ArrayBuffer) return new Uint8Array(input.slice(0));
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength));
  }
  const blob = input as Blob;
  if (blob && typeof blob.arrayBuffer === 'function') {
    return new Uint8Array(await blob.arrayBuffer());
  }
  if (typeof FileReader !== 'undefined' && blob) {
    return new Promise<Uint8Array>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer));
      fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
      fr.readAsArrayBuffer(blob);
    });
  }
  throw new Error('Could not read file bytes');
}

export function hydrateAttachment(row: unknown): AttachmentRecord {
  const r = row as AttachmentRecord;
  const raw = (row as { blob?: unknown }).blob;
  let blob: Blob;
  if (typeof Blob !== 'undefined' && raw instanceof Blob) {
    blob = raw;
  } else if (raw instanceof ArrayBuffer) {
    blob = new Blob([raw as BlobPart], { type: r.mimeType });
  } else if (raw && ArrayBuffer.isView(raw)) {
    const view = raw as ArrayBufferView;
    const copy = new Uint8Array(view.byteLength);
    copy.set(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
    blob = new Blob([copy as BlobPart], { type: r.mimeType });
  } else {
    blob = new Blob([], { type: r.mimeType });
  }
  return { ...r, blob };
}

export async function hashFile(file: Blob): Promise<string> {
  return sha256Hex(await readBlobBytes(file));
}

export async function assertAttachable(session: Session): Promise<void> {
  const ok =
    (await hasCapability(session, 'receive')) || (await hasCapability(session, 'qaDisposition'));
  if (!ok) throw new Error('Attach documents capability required');
}

export async function canAttach(session: Session): Promise<boolean> {
  return (await hasCapability(session, 'receive')) || (await hasCapability(session, 'qaDisposition'));
}

async function requireStore() {
  const db = await getDb();
  if (!db.objectStoreNames.contains('attachments')) {
    throw new Error('Attachments store not available — reload to upgrade the local database');
  }
  return db;
}

export async function addAttachment(session: Session, input: AddAttachmentInput): Promise<AttachmentRecord> {
  await assertAttachable(session);
  const recordId = (input.recordId || '').trim();
  if (!recordId) throw new Error('Record ID is required');
  if (input.scope !== 'serial' && input.scope !== 'receiptBatch') {
    throw new Error('Invalid attachment scope');
  }
  if (!(ATTACHMENT_CATEGORIES as readonly string[]).includes(input.category)) {
    throw new Error('Invalid attachment category');
  }
  const file = input.file;
  if (!file) throw new Error('File is required');
  if (file.size > MAX_BYTES) throw new Error('File exceeds 10 MB limit');
  if (!isAllowedAttachment(file)) throw new Error('Disallowed file type');
  const bytes = await readBlobBytes(file);
  const sha256 = await sha256Hex(bytes);
  const rec: AttachmentRecord = {
    id: newId('ATT'),
    scope: input.scope,
    recordId,
    fileName: file.name,
    mimeType: inferMime(file),
    sizeBytes: file.size,
    sha256,
    category: input.category,
    blob: new Blob([bytes as BlobPart], { type: inferMime(file) }),
    uploadedBy: session.userId,
    uploadedOnUtc: nowUtcIso(),
  };
  const db = await requireStore();
  await db.add('attachments', { ...rec, blob: new Uint8Array(bytes) });
  await appendAudit(session, {
    action: 'ATTACHMENT_ADD',
    recordId,
    field: 'fileName',
    newValue: `${input.category}|${file.name}|${sha256.slice(0, 16)}|${file.size}`,
  });
  return rec;
}

export async function addAttachments(session: Session, items: AddAttachmentInput[]): Promise<AttachmentRecord[]> {
  const out: AttachmentRecord[] = [];
  for (const item of items) {
    out.push(await addAttachment(session, item));
  }
  return out;
}

export async function listAttachments(recordId: string): Promise<AttachmentRecord[]> {
  const db = await getDb();
  if (!db.objectStoreNames.contains('attachments') || !recordId) return [];
  const rows = (await db.getAllFromIndex('attachments', 'recordId', recordId)) as unknown[];
  const out = rows.map(hydrateAttachment);
  out.sort((a, b) => a.uploadedOnUtc.localeCompare(b.uploadedOnUtc));
  return out;
}

export async function listAllAttachments(): Promise<AttachmentRecord[]> {
  const db = await getDb();
  if (!db.objectStoreNames.contains('attachments')) return [];
  const rows = (await db.getAll('attachments')) as unknown[];
  const out = rows.map(hydrateAttachment);
  out.sort((a, b) => a.uploadedOnUtc.localeCompare(b.uploadedOnUtc));
  return out;
}

export async function listForSerial(rec: InventoryRecord): Promise<AttachmentRecord[]> {
  const serialRows = await listAttachments(rec.serial);
  const batchId = rec.receiptBatchId;
  const batchRows = batchId && batchId !== rec.serial ? await listAttachments(batchId) : [];
  const seen = new Set<string>();
  const out: AttachmentRecord[] = [];
  for (const a of [...batchRows, ...serialRows]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

export async function getAttachment(id: string): Promise<AttachmentRecord | undefined> {
  const db = await getDb();
  if (!db.objectStoreNames.contains('attachments') || !id) return undefined;
  const row = await db.get('attachments', id);
  return row ? hydrateAttachment(row) : undefined;
}

export function openAttachment(att: AttachmentRecord): void {
  const url = URL.createObjectURL(att.blob);
  const viewable = att.mimeType === 'application/pdf' || att.mimeType.startsWith('image/');
  if (viewable) {
    const w = window.open(url, '_blank', 'noopener,noreferrer');
    if (!w) {
      const a = document.createElement('a');
      a.href = url;
      a.download = att.fileName;
      a.rel = 'noopener';
      a.click();
    }
  } else {
    const a = document.createElement('a');
    a.href = url;
    a.download = att.fileName;
    a.click();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  if (typeof FileReader !== 'undefined') {
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(String(fr.result ?? ''));
        fr.onerror = () => reject(fr.error ?? new Error('FileReader failed'));
        fr.readAsDataURL(blob);
      });
      const comma = dataUrl.indexOf(',');
      if (comma >= 0) return dataUrl.slice(comma + 1);
      if (dataUrl) return dataUrl;
    } catch {
      /* fall through to arrayBuffer */
    }
  }
  return bytesToBase64(await readBlobBytes(blob));
}
