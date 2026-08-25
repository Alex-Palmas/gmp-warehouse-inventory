import { useEffect, useState } from 'react';
import type { MaterialSubmission, Session } from '../types';
import { ITEM_TYPES, PHARMACOPEIAS, STORAGE_CONDITIONS, UOMS } from '../types';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import {
  approveMaterialSubmission,
  listSubmissions,
  rejectMaterialSubmission,
  submitMaterial,
} from '../lib/submissions';
import { hasCapability } from '../lib/permissions';

export function SubmitMaterial({ session }: { session: Session }) {
  const allowed = useCap(session, 'submitMaterial');
  const [rows, setRows] = useState<MaterialSubmission[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [canReview, setCanReview] = useState(false);
  const [form, setForm] = useState({
    materialCode: '',
    materialName: '',
    itemType: 'Raw Material' as const,
    gradeSpec: '',
    pharmacopeia: 'USP' as const,
    defaultUom: 'kg' as const,
    defaultStorage: 'CRT 15–25 °C' as const,
    samplingRequiredDefault: true,
    manufacturerHint: '',
    supplierHint: '',
    justification: '',
  });
  const [codeById, setCodeById] = useState<Record<string, string>>({});
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  useEffect(() => {
    void listSubmissions().then(setRows);
    void Promise.all([hasCapability(session, 'qaDisposition'), hasCapability(session, 'adminMaterials')]).then(
      ([a, b]) => setCanReview(a || b || session.role === 'supervisor'),
    );
  }, [session]);

  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="submitMaterial" />;

  return (
    <div>
      <h1>Submit new material</h1>
      <p className="help">
        Proposals start as Submitted. QA or a supervisor Approves (writes Material Master) or Rejects with a
        reason. Goods receipt only lists active approved materials.
      </p>
      <form
        className="card grid"
        onSubmit={async (e) => {
          e.preventDefault();
          setErr('');
          try {
            const rec = await submitMaterial(session, form);
            setRows((rs) => [rec, ...rs]);
            setMsg(`Submitted ${rec.submissionId}`);
          } catch (ex) {
            setErr(ex instanceof Error ? ex.message : 'Failed');
          }
        }}
      >
        <div className="grid grid-2">
          <label>
            Material code (optional until approval)
            <input value={form.materialCode} onChange={(e) => setForm({ ...form, materialCode: e.target.value })} />
          </label>
          <label>
            Name
            <input value={form.materialName} onChange={(e) => setForm({ ...form, materialName: e.target.value })} required />
          </label>
        </div>
        <div className="grid grid-3">
          <label>
            Type
            <select value={form.itemType} onChange={(e) => setForm({ ...form, itemType: e.target.value as typeof form.itemType })}>
              {ITEM_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Grade / spec
            <input value={form.gradeSpec} onChange={(e) => setForm({ ...form, gradeSpec: e.target.value })} />
          </label>
          <label>
            Pharmacopeia
            <select value={form.pharmacopeia} onChange={(e) => setForm({ ...form, pharmacopeia: e.target.value as typeof form.pharmacopeia })}>
              {PHARMACOPEIAS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Default UOM
            <select value={form.defaultUom} onChange={(e) => setForm({ ...form, defaultUom: e.target.value as typeof form.defaultUom })}>
              {UOMS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Default storage
            <select value={form.defaultStorage} onChange={(e) => setForm({ ...form, defaultStorage: e.target.value as typeof form.defaultStorage })}>
              {STORAGE_CONDITIONS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={form.samplingRequiredDefault}
              onChange={(e) => setForm({ ...form, samplingRequiredDefault: e.target.checked })}
            />
            Sampling required
          </label>
        </div>
        <div className="grid grid-2">
          <label>
            Manufacturer hint
            <input value={form.manufacturerHint} onChange={(e) => setForm({ ...form, manufacturerHint: e.target.value })} />
          </label>
          <label>
            Supplier hint
            <input value={form.supplierHint} onChange={(e) => setForm({ ...form, supplierHint: e.target.value })} />
          </label>
        </div>
        <label>
          Justification
          <textarea value={form.justification} onChange={(e) => setForm({ ...form, justification: e.target.value })} required />
        </label>
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        <button className="btn" type="submit">
          Submit for approval
        </button>
      </form>
      <h2>Submissions</h2>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Code</th>
            <th>Name</th>
            <th>Status</th>
            <th>By</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.submissionId}>
              <td className="mono">{s.submissionId}</td>
              <td className="mono">{s.materialCode}</td>
              <td>
                {s.materialName}
                <div className="help">{s.justification}</div>
              </td>
              <td>{s.status}</td>
              <td>{s.submittedBy}</td>
              <td>
                {canReview && s.status === 'Submitted' && (
                  <div className="row">
                    <input
                      placeholder="Code"
                      value={codeById[s.submissionId] ?? s.materialCode}
                      onChange={(e) => setCodeById({ ...codeById, [s.submissionId]: e.target.value })}
                    />
                    <input
                      placeholder="Reason"
                      value={reasonById[s.submissionId] ?? ''}
                      onChange={(e) => setReasonById({ ...reasonById, [s.submissionId]: e.target.value })}
                    />
                    <button
                      className="btn btn-ok"
                      type="button"
                      onClick={() =>
                        void approveMaterialSubmission(
                          session,
                          s.submissionId,
                          codeById[s.submissionId] ?? s.materialCode,
                          reasonById[s.submissionId] ?? 'Approved',
                        )
                          .then(({ submission }) => {
                            setRows((rs) => rs.map((x) => (x.submissionId === submission.submissionId ? submission : x)));
                            setMsg(`Approved ${submission.materialCode}`);
                          })
                          .catch((ex) => setErr(ex instanceof Error ? ex.message : 'Failed'))
                      }
                    >
                      Approve
                    </button>
                    <button
                      className="btn btn-danger"
                      type="button"
                      onClick={() =>
                        void rejectMaterialSubmission(session, s.submissionId, reasonById[s.submissionId] || '')
                          .then((next) => {
                            setRows((rs) => rs.map((x) => (x.submissionId === next.submissionId ? next : x)));
                            setMsg(`Rejected ${next.submissionId}`);
                          })
                          .catch((ex) => setErr(ex instanceof Error ? ex.message : 'Failed'))
                      }
                    >
                      Reject
                    </button>
                  </div>
                )}
                {s.status === 'Rejected' && <div className="help">{s.rejectReason}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
