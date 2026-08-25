import { useEffect, useState } from 'react';
import type { Material, Session } from '../types';
import { ITEM_TYPES, PHARMACOPEIAS, STORAGE_CONDITIONS, UOMS } from '../types';
import { listMaterials, saveMaterial } from '../lib/materials';
import { useCap } from '../hooks/useCap';
import { nowUtcIso } from '../lib/dates';

export function MaterialMaster({ session }: { session: Session }) {
  const [rows, setRows] = useState<Material[]>([]);
  const [edit, setEdit] = useState<Material | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const allowed = useCap(session, 'adminMaterials');
  useEffect(() => {
    void listMaterials().then(setRows);
  }, []);

  function startNew() {
    setIsNew(true);
    setEdit({
      materialCode: '',
      materialName: '',
      itemType: 'Raw Material',
      gradeSpec: '',
      pharmacopeia: 'USP',
      defaultUom: 'kg',
      defaultStorage: 'CRT 15–25 °C',
      samplingRequiredDefault: true,
      active: true,
      createdBy: session.userId,
      createdOnUtc: nowUtcIso(),
      modifiedBy: session.userId,
      modifiedOnUtc: nowUtcIso(),
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!edit) return;
    setErr('');
    try {
      const rec = await saveMaterial(session, edit, isNew, reason);
      setRows((rs) => {
        const rest = rs.filter((r) => r.materialCode !== rec.materialCode);
        return [...rest, rec].sort((a, b) => a.materialCode.localeCompare(b.materialCode));
      });
      setEdit(null);
      setReason('');
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <div>
      <h1>Material master</h1>
      {allowed && (
        <button className="btn" type="button" onClick={startNew}>
          New material
        </button>
      )}
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th>Code</th>
            <th>Name</th>
            <th>Type</th>
            <th>UOM</th>
            <th>Storage</th>
            <th>Active</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.materialCode}>
              <td className="mono">{m.materialCode}</td>
              <td>{m.materialName}</td>
              <td>{m.itemType}</td>
              <td>{m.defaultUom}</td>
              <td>{m.defaultStorage}</td>
              <td>{m.active ? 'Y' : 'N'}</td>
              <td>
                {allowed && (
                  <button className="btn btn-sec" type="button" onClick={() => { setIsNew(false); setEdit(m); }}>
                    Open
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {edit && allowed && (
        <form className="card grid" style={{ marginTop: 12 }} onSubmit={submit}>
          <h2>{isNew ? 'Create material' : `Edit ${edit.materialCode}`}</h2>
          <div className="grid grid-3">
            <label>
              Code
              <input value={edit.materialCode} disabled={!isNew} onChange={(e) => setEdit({ ...edit, materialCode: e.target.value })} required />
            </label>
            <label>
              Name
              <input value={edit.materialName} onChange={(e) => setEdit({ ...edit, materialName: e.target.value })} required />
            </label>
            <label>
              Type
              <select value={edit.itemType} onChange={(e) => setEdit({ ...edit, itemType: e.target.value as Material['itemType'] })}>
                {ITEM_TYPES.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Grade / spec
              <input value={edit.gradeSpec} onChange={(e) => setEdit({ ...edit, gradeSpec: e.target.value })} />
            </label>
            <label>
              Pharmacopeia
              <select value={edit.pharmacopeia} onChange={(e) => setEdit({ ...edit, pharmacopeia: e.target.value as Material['pharmacopeia'] })}>
                {PHARMACOPEIAS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Default UOM
              <select value={edit.defaultUom} onChange={(e) => setEdit({ ...edit, defaultUom: e.target.value as Material['defaultUom'] })}>
                {UOMS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label>
              Default storage
              <select value={edit.defaultStorage} onChange={(e) => setEdit({ ...edit, defaultStorage: e.target.value as Material['defaultStorage'] })}>
                {STORAGE_CONDITIONS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="row">
            <input type="checkbox" checked={edit.samplingRequiredDefault} onChange={(e) => setEdit({ ...edit, samplingRequiredDefault: e.target.checked })} /> Sampling required default
          </label>
          <label className="row">
            <input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> Active
          </label>
          <label>
            Reason for change
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} required={!isNew} />
          </label>
          {err && <p className="err">{err}</p>}
          <div className="row">
            <button className="btn" type="submit">
              Save
            </button>
            <button className="btn btn-sec" type="button" onClick={() => setEdit(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
