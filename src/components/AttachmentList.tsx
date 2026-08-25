import { useEffect, useState } from 'react';
import type { AttachmentCategory, AttachmentRecord, InventoryRecord, Session } from '../types';
import { ATTACHMENT_CATEGORIES } from '../types';
import {
  ATTACH_ACCEPT,
  addAttachments,
  canAttach,
  listForSerial,
  openAttachment,
} from '../lib/attachments';
import { hasCapability } from '../lib/permissions';
import { toDisplayLocal } from '../lib/dates';

export function AttachmentList({ session, record }: { session: Session; record: InventoryRecord }) {
  const [rows, setRows] = useState<AttachmentRecord[]>([]);
  const [mayAttach, setMayAttach] = useState(false);
  const [mayBatch, setMayBatch] = useState(false);
  const [cat, setCat] = useState<AttachmentCategory>('CoA');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function reload() {
    setRows(await listForSerial(record));
  }

  useEffect(() => {
    void reload();
    void canAttach(session).then(setMayAttach);
    void hasCapability(session, 'receive').then(setMayBatch);
  }, [session, record.serial, record.receiptBatchId]);

  const inherited = rows.filter((a) => a.scope === 'receiptBatch');
  const own = rows.filter((a) => a.scope === 'serial');

  async function addFiles(files: FileList | null, scope: 'serial' | 'receiptBatch', recordId: string) {
    if (!files?.length) return;
    setErr('');
    setBusy(true);
    try {
      await addAttachments(
        session,
        Array.from(files).map((file) => ({ scope, recordId, file, category: cat })),
      );
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Attach failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="attach-list">
      <h2>Certificates / attachments</h2>
      {inherited.length === 0 && own.length === 0 && <p className="help">No files attached.</p>}
      {inherited.length > 0 && (
        <div>
          <h3 className="help">Receipt batch (inherited)</h3>
          {inherited.map((a) => (
            <AttachRow key={a.id} att={a} inherited />
          ))}
        </div>
      )}
      {own.length > 0 && (
        <div>
          <h3 className="help">This serial</h3>
          {own.map((a) => (
            <AttachRow key={a.id} att={a} inherited={false} />
          ))}
        </div>
      )}
      {mayAttach && (
        <div className="row" style={{ marginTop: 8 }}>
          <label>
            Category
            <select value={cat} onChange={(e) => setCat(e.target.value as AttachmentCategory)} disabled={busy}>
              {ATTACHMENT_CATEGORIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label>
            Add to this serial
            <input
              type="file"
              multiple
              accept={ATTACH_ACCEPT}
              disabled={busy}
              onChange={(e) => {
                void addFiles(e.target.files, 'serial', record.serial);
                e.target.value = '';
              }}
            />
          </label>
          {mayBatch && record.receiptBatchId && (
            <label>
              Add to entire receipt batch
              <input
                type="file"
                multiple
                accept={ATTACH_ACCEPT}
                disabled={busy}
                onChange={(e) => {
                  void addFiles(e.target.files, 'receiptBatch', record.receiptBatchId);
                  e.target.value = '';
                }}
              />
            </label>
          )}
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function AttachRow({ att, inherited }: { att: AttachmentRecord; inherited: boolean }) {
  return (
    <div className={`attach-row${inherited ? ' attach-inherited' : ''}`}>
      <span className="attach-cat">{att.category}</span>
      <span className="mono">{att.fileName}</span>
      <span className="help">
        {(att.sizeBytes / 1024).toFixed(1)} KB · {att.uploadedBy} · {toDisplayLocal(att.uploadedOnUtc)}
        {inherited ? ' · lot / receipt' : ''}
      </span>
      <button type="button" className="btn btn-sec" onClick={() => openAttachment(att)}>
        Download
      </button>
    </div>
  );
}
