import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import type { InventoryRecord, Material, Session } from '../types';
import {
  CONTAINER_TYPES,
  ITEM_TYPES,
  PHARMACOPEIAS,
  STORAGE_CONDITIONS,
  UOMS,
} from '../types';
import { listMaterials } from '../lib/materials';
import { receiveGoods } from '../lib/inventory';
import { LocationFields, emptyLocation } from '../components/fields';
import { todayIsoDateInTz } from '../lib/dates';

export function GoodsReceipt({ session }: { session: Session }) {
  const allowed = useCap(session, 'receive');
  const [mats, setMats] = useState<Material[]>([]);
  const [code, setCode] = useState('');
  const [form, setForm] = useState<Partial<InventoryRecord>>({
    qtyReceived: 0,
    numberOfContainers: 1,
    uom: 'kg',
    containerType: 'Drum',
    storageCondition: 'CRT 15–25 °C',
    itemType: 'Raw Material',
    pharmacopeia: 'USP',
    samplingRequired: true,
    receiptDate: todayIsoDateInTz(),
    location: emptyLocation(),
  });
  const [err, setErr] = useState('');
  const [printAfter, setPrintAfter] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    void listMaterials().then(setMats);
  }, []);

  function applyMat(c: string) {
    setCode(c);
    const m = mats.find((x) => x.materialCode === c);
    if (!m) return;
    setForm((f) => ({
      ...f,
      materialCode: m.materialCode,
      materialName: m.materialName,
      itemType: m.itemType,
      gradeSpec: m.gradeSpec,
      pharmacopeia: m.pharmacopeia,
      uom: m.defaultUom,
      storageCondition: m.defaultStorage,
      samplingRequired: m.samplingRequiredDefault,
    }));
  }

  const set = (k: keyof InventoryRecord, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      const rec = await receiveGoods(session, {
        materialCode: form.materialCode ?? '',
        materialName: form.materialName ?? '',
        itemType: form.itemType ?? 'Raw Material',
        gradeSpec: form.gradeSpec ?? '',
        pharmacopeia: form.pharmacopeia ?? 'USP',
        manufacturer: form.manufacturer ?? '',
        manufacturerLot: form.manufacturerLot ?? '',
        supplier: form.supplier ?? '',
        supplierLot: form.supplierLot ?? '',
        poDeliveryNote: form.poDeliveryNote ?? '',
        coaNumber: form.coaNumber ?? '',
        internalLot: form.internalLot ?? '',
        qtyReceived: Number(form.qtyReceived),
        uom: form.uom ?? 'kg',
        numberOfContainers: Number(form.numberOfContainers) || 1,
        containerType: form.containerType ?? 'Drum',
        dateOfManufacture: form.dateOfManufacture ?? '',
        receiptDate: form.receiptDate ?? todayIsoDateInTz(),
        expiryDate: form.expiryDate ?? '',
        retestDate: form.retestDate ?? '',
        location: form.location ?? emptyLocation(),
        storageCondition: form.storageCondition ?? 'CRT 15–25 °C',
        samplingRequired: Boolean(form.samplingRequired),
        linkedSampleIds: form.linkedSampleIds ?? '',
        comments: form.comments ?? '',
      });
      if (printAfter) nav(`/reprint?serial=${rec.serial}&autoprint=1`);
      else nav(`/record/${rec.serial}`);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Receive failed');
    }
  }

  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="receive" />;

  return (
    <div>
      <h1>Goods receipt</h1>
      <p className="help">Creates a unique serial WH-YYYY-NNNNNN. Status defaults to Quarantine. Serial is allocated only on successful submit.</p>
      <form onSubmit={submit} className="card grid">
        <label>
          Material
          <select value={code} onChange={(e) => applyMat(e.target.value)} required>
            <option value="">— select —</option>
            {mats.filter((m) => m.active).map((m) => (
              <option key={m.materialCode} value={m.materialCode}>
                {m.materialCode} {m.materialName}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-3">
          <label>
            Item type
            <select value={form.itemType} onChange={(e) => set('itemType', e.target.value)}>
              {ITEM_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            Grade / spec
            <input value={form.gradeSpec ?? ''} onChange={(e) => set('gradeSpec', e.target.value)} />
          </label>
          <label>
            Pharmacopeia
            <select value={form.pharmacopeia} onChange={(e) => set('pharmacopeia', e.target.value)}>
              {PHARMACOPEIAS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-3">
          <label>
            Manufacturer
            <input value={form.manufacturer ?? ''} onChange={(e) => set('manufacturer', e.target.value)} required />
          </label>
          <label>
            Manufacturer lot
            <input value={form.manufacturerLot ?? ''} onChange={(e) => set('manufacturerLot', e.target.value)} required />
          </label>
          <label>
            Supplier
            <input value={form.supplier ?? ''} onChange={(e) => set('supplier', e.target.value)} />
          </label>
          <label>
            Supplier lot
            <input value={form.supplierLot ?? ''} onChange={(e) => set('supplierLot', e.target.value)} />
          </label>
          <label>
            PO / delivery note
            <input value={form.poDeliveryNote ?? ''} onChange={(e) => set('poDeliveryNote', e.target.value)} />
          </label>
          <label>
            CoA number
            <input value={form.coaNumber ?? ''} onChange={(e) => set('coaNumber', e.target.value)} />
          </label>
          <label>
            Internal lot / batch
            <input value={form.internalLot ?? ''} onChange={(e) => set('internalLot', e.target.value)} required />
          </label>
        </div>
        <div className="grid grid-4">
          <label>
            Qty received
            <input type="number" step="0.0001" min="0" value={form.qtyReceived ?? 0} onChange={(e) => set('qtyReceived', Number(e.target.value))} required />
          </label>
          <label>
            UOM
            <select value={form.uom} onChange={(e) => set('uom', e.target.value)}>
              {UOMS.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
          <label>
            # containers
            <input type="number" min="1" value={form.numberOfContainers ?? 1} onChange={(e) => set('numberOfContainers', Number(e.target.value))} />
          </label>
          <label>
            Container type
            <select value={form.containerType} onChange={(e) => set('containerType', e.target.value)}>
              {CONTAINER_TYPES.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid grid-4">
          <label>
            Date of manufacture
            <input type="date" value={form.dateOfManufacture ?? ''} onChange={(e) => set('dateOfManufacture', e.target.value)} />
          </label>
          <label>
            Receipt date
            <input type="date" value={form.receiptDate ?? ''} onChange={(e) => set('receiptDate', e.target.value)} required />
          </label>
          <label>
            Expiry date
            <input type="date" value={form.expiryDate ?? ''} onChange={(e) => set('expiryDate', e.target.value)} required />
          </label>
          <label>
            Retest date
            <input type="date" value={form.retestDate ?? ''} onChange={(e) => set('retestDate', e.target.value)} />
          </label>
        </div>
        <label>
          Storage condition
          <select value={form.storageCondition} onChange={(e) => set('storageCondition', e.target.value)}>
            {STORAGE_CONDITIONS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <h2>Location</h2>
        <LocationFields value={form.location ?? emptyLocation()} onChange={(l) => set('location', l)} />
        <label>
          <span>
            <input type="checkbox" checked={Boolean(form.samplingRequired)} onChange={(e) => set('samplingRequired', e.target.checked)} /> Sampling required
          </span>
        </label>
        <label>
          Linked sample IDs
          <input value={form.linkedSampleIds ?? ''} onChange={(e) => set('linkedSampleIds', e.target.value)} />
        </label>
        <label>
          Comments
          <textarea value={form.comments ?? ''} onChange={(e) => set('comments', e.target.value)} />
        </label>
        <label className="row">
          <input type="checkbox" checked={printAfter} onChange={(e) => setPrintAfter(e.target.checked)} /> Print label after save
        </label>
        {err && <p className="err">{err}</p>}
        <button className="btn" type="submit">
          Receive into Quarantine
        </button>
      </form>
    </div>
  );
}
