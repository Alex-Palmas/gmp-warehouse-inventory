import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type {
  ESign,
  InventoryRecord,
  Material,
  MaterialClassification,
  MaterialRequest,
  RequestPriority,
  Session,
  ToLocation,
} from '../types';
import { CLASSIFICATIONS, DOC_ID, REQUEST_PRIORITIES, TO_LOCATIONS, UOMS } from '../types';
import { useCap, useCaps } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import { ESignModal } from '../components/ESignModal';
import { StatusBadge } from '../components/StatusBadge';
import { listMaterials } from '../lib/materials';
import { listInventory } from '../lib/inventory';
import {
  approveRequestQa,
  approveRequestSupervisor,
  cancelRequest,
  confirmFulfillment,
  confirmReceived,
  listRequests,
  pickSerialForRequest,
  proposeFefoForRequest,
  rejectRequest,
  removePick,
  submitRequest,
} from '../lib/requests';
import { availableReleasedQty } from '../lib/fefo';
import { todayIsoDateInTz } from '../lib/dates';
import { SCAN_EVENT } from '../components/ScanBox';
import { parseScanPayload } from '../lib/serial';
import { locationCode, locationSortKey } from '../lib/locations';
import { locationToString } from '../lib/dates';
import { scanErr, scanOk } from '../lib/scanFeedback';
import { isLocationCode } from '../lib/locations';

type Tab = 'submit' | 'approve' | 'queue' | 'mine';

export function Requests({ session }: { session: Session }) {
  const caps = useCaps(session);
  const canSubmit = useCap(session, 'submitRequest');
  const canFulfill = useCap(session, 'fulfillRequest');
  const canCancel = useCap(session, 'cancelRequest');
  const canRejectReq = useCap(session, 'rejectRequest');
  const canConfirmReceipt = useCap(session, 'confirmRequestReceipt');
  const canApprove = useCap(session, 'approveRequest');
  const canQa = useCap(session, 'qaDisposition');
  const [tab, setTab] = useState<Tab>('queue');
  const [reqs, setReqs] = useState<MaterialRequest[]>([]);
  const [mats, setMats] = useState<Material[]>([]);
  const [inv, setInv] = useState<InventoryRecord[]>([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [activeId, setActiveId] = useState('');
  const [sp] = useSearchParams();

  async function reload() {
    const [r, m, i] = await Promise.all([listRequests(), listMaterials(), listInventory()]);
    setReqs(r);
    setMats(m);
    setInv(i);
  }
  useEffect(() => {
    void reload();
  }, []);

  useEffect(() => {
    const v = sp.get('view');
    if (v === 'open' && canFulfill) {
      setTab('queue');
      return;
    }
    if (v === 'mine' && canSubmit) {
      setTab('mine');
      return;
    }
    if (v === 'submit' && canSubmit) {
      setTab('submit');
      return;
    }
    if (v === 'approve' && (canApprove || canQa)) {
      setTab('approve');
      return;
    }
    if ((canApprove || canQa) && canFulfill === false) {
      setTab('approve');
      return;
    }
    if (canSubmit && canFulfill === false) setTab('submit');
  }, [sp, canSubmit, canFulfill, canApprove, canQa]);

  if (canSubmit === null || canFulfill === null || canApprove === null || canQa === null) return <CapChecking />;
  if (!canSubmit && !canFulfill && !canApprove && !canQa) {
    return <CapDenied cap="submitRequest, approveRequest, or fulfillRequest" />;
  }

  const open = reqs.filter((r) => ['Approved', 'Picking', 'Partially Issued'].includes(r.status));
  const pendingSup = reqs.filter((r) => r.status === 'Pending Supervisor');
  const pendingQa = reqs.filter((r) => r.status === 'Pending QA');
  const mine = reqs.filter((r) => r.requestedBy === session.userId);
  const active = reqs.find((r) => r.requestId === activeId);
  const pendingMine =
    (canApprove ? pendingSup.length : 0) + (canQa ? pendingQa.length : 0);

  return (
    <div>
      <h1>Material Transfer</h1>
      <p className="help">
        Electronic Material Transfer (DOC-WH-INV-001). Requestor e-signs Section A; supervisor (and QA when cell bank
        or quarantined) approve before warehouse pick. FEFO reserve happens on Approved. Receiver e-signs quantity
        received to close chain of custody.
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        {canSubmit && (
          <button className={`btn ${tab === 'submit' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('submit')}>
            Submit
          </button>
        )}
        {(canApprove || canQa) && (
          <button className={`btn ${tab === 'approve' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('approve')}>
            Pending my approval ({pendingMine})
          </button>
        )}
        {canFulfill && (
          <button className={`btn ${tab === 'queue' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('queue')}>
            Warehouse queue ({open.length})
          </button>
        )}
        {canSubmit && (
          <button className={`btn ${tab === 'mine' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('mine')}>
            My transfers ({mine.length})
          </button>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      {tab === 'submit' && canSubmit && (
        <SubmitForm
          session={session}
          mats={mats}
          inv={inv}
          onDone={async (r) => {
            setMsg(`Submitted ${r.requestId} — pending supervisor${r.stockWarning ? ' — ' + r.stockWarning : ''}`);
            await reload();
            setTab(canApprove || canQa ? 'approve' : 'mine');
          }}
          onError={setErr}
        />
      )}
      {tab === 'approve' && (canApprove || canQa) && (
        <ApprovalQueue
          session={session}
          pendingSup={canApprove ? pendingSup : []}
          pendingQa={canQa ? pendingQa : []}
          inv={inv}
          canSupervisor={Boolean(canApprove)}
          canQaApprove={Boolean(canQa)}
          onReload={reload}
          onError={setErr}
          onMsg={setMsg}
        />
      )}
      {tab === 'queue' && canFulfill && (
        <Queue
          session={session}
          open={open}
          inv={inv}
          active={active}
          activeId={activeId}
          setActiveId={setActiveId}
          onReload={reload}
          onError={setErr}
          onMsg={setMsg}
          canReject={Boolean(canRejectReq)}
        />
      )}
      {tab === 'mine' && (
        <Mine
          session={session}
          mine={mine}
          inv={inv}
          onReload={reload}
          onError={setErr}
          onMsg={setMsg}
          canFulfill={Boolean(caps?.has('fulfillRequest'))}
          canCancel={Boolean(canCancel)}
          canConfirmReceipt={Boolean(canConfirmReceipt)}
        />
      )}
    </div>
  );
}

function SubmitForm({
  session,
  mats,
  inv,
  onDone,
  onError,
}: {
  session: Session;
  mats: Material[];
  inv: InventoryRecord[];
  onDone: (r: MaterialRequest) => void;
  onError: (s: string) => void;
}) {
  const [q, setQ] = useState('');
  const [code, setCode] = useState('');
  const [qty, setQty] = useState(1);
  const [uom, setUom] = useState<string>('kg');
  const [neededBy, setNeededBy] = useState(todayIsoDateInTz());
  const [toLocation, setToLocation] = useState<ToLocation>('LVM');
  const [destinationOther, setDestinationOther] = useState('');
  const [classification, setClassification] = useState<MaterialClassification[]>(['GMP']);
  const [intendedUse, setIntendedUse] = useState('');
  const [priority, setPriority] = useState<RequestPriority>('Routine');
  const [comments, setComments] = useState('');
  const [cellBank, setCellBank] = useState(false);
  const [hi, setHi] = useState(0);
  const [sign, setSign] = useState(false);
  const asOf = todayIsoDateInTz();
  const avail = code ? availableReleasedQty(inv, code, asOf) : 0;
  const mat = mats.find((m) => m.materialCode === code);
  const matches = mats
    .filter((m) => {
      if (!m.active) return false;
      if (!q.trim()) return !code;
      const s = q.toLowerCase();
      return m.materialCode.toLowerCase().includes(s) || m.materialName.toLowerCase().includes(s);
    })
    .slice(0, 8);

  function choose(m: Material) {
    setCode(m.materialCode);
    setQ(`${m.materialCode} ${m.materialName}`);
    setUom(m.defaultUom);
  }

  function toggleClass(c: MaterialClassification) {
    setClassification((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]));
  }

  function validate(): string {
    if (!mat) return 'Material is required';
    if (!(qty > 0)) return 'Requested quantity must be > 0';
    if (toLocation === 'Other' && !destinationOther.trim()) return 'Specify Other destination';
    if (classification.length < 1) return 'Select GMP and/or High Quality';
    if (!intendedUse.trim()) return 'Intended use is required';
    return '';
  }

  return (
    <form
      className="card grid"
      onSubmit={(e) => {
        e.preventDefault();
        const v = validate();
        if (v) {
          onError(v);
          return;
        }
        onError('');
        setSign(true);
      }}
    >
      <h2>Section A — Requestor</h2>
      <p className="kbd-hint">Keyboard-first: type material, Tab through qty / location / intended use. Submit opens e-sign.</p>
      <div className="typeahead">
        <label>
          Material
          <input
            autoFocus
            value={q}
            placeholder="Type code or name"
            onChange={(e) => {
              setQ(e.target.value);
              setCode('');
              setHi(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHi((i) => Math.min(i + 1, Math.max(0, matches.length - 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHi((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && !code && matches[hi]) {
                e.preventDefault();
                choose(matches[hi]);
              }
            }}
            required
          />
        </label>
        {!code && q && (
          <ul>
            {matches.map((m, i) => (
              <li
                key={m.materialCode}
                className={i === hi ? 'active' : ''}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(m);
                }}
              >
                <span className="mono">{m.materialCode}</span> {m.materialName}
              </li>
            ))}
          </ul>
        )}
      </div>
      {code && (
        <p className={avail < qty ? 'err' : 'help'}>
          Released FEFO available: {avail} {uom}. Stock is reserved only after supervisor/QA approval.
          {avail < qty ? ' Insufficient stock — you may still submit.' : ''}
        </p>
      )}
      <div className="grid grid-3">
        <label>
          Qty requested
          <input type="number" min="0" step="0.0001" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
        </label>
        <label>
          UOM
          <select value={uom} onChange={(e) => setUom(e.target.value)}>
            {UOMS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
        <label>
          Needed by
          <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
      </div>
      <fieldset className="mtf-section">
        <legend>To location</legend>
        <div className="check-row">
          {TO_LOCATIONS.map((loc) => (
            <label key={loc}>
              <input
                type="radio"
                name="toLocation"
                checked={toLocation === loc}
                onChange={() => setToLocation(loc)}
              />
              {loc}
            </label>
          ))}
        </div>
        {toLocation === 'Other' && (
          <label>
            Other location
            <input value={destinationOther} onChange={(e) => setDestinationOther(e.target.value)} required />
          </label>
        )}
      </fieldset>
      <fieldset className="mtf-section">
        <legend>Classification (at least one)</legend>
        <div className="check-row">
          {CLASSIFICATIONS.map((c) => (
            <label key={c}>
              <input type="checkbox" checked={classification.includes(c)} onChange={() => toggleClass(c)} />
              {c}
            </label>
          ))}
        </div>
      </fieldset>
      <label>
        Intended use (client code / SOP / protocol / MBR lot)
        <input value={intendedUse} onChange={(e) => setIntendedUse(e.target.value)} required />
      </label>
      <label>
        <input type="checkbox" checked={cellBank} onChange={(e) => setCellBank(e.target.checked)} /> Cell bank or
        quarantined material (QA approval required)
      </label>
      <label>
        Priority
        <select value={priority} onChange={(e) => setPriority(e.target.value as RequestPriority)}>
          {REQUEST_PRIORITIES.map((x) => (
            <option key={x}>{x}</option>
          ))}
        </select>
      </label>
      <label>
        Comments
        <textarea value={comments} onChange={(e) => setComments(e.target.value)} />
      </label>
      <button className="btn" type="submit" disabled={!mat}>
        Submit Material Transfer (e-sign)
      </button>
      {sign && (
        <ESignModal
          session={session}
          title="Requestor e-sign"
          meaningDefault="I request this material transfer."
          onCancel={() => setSign(false)}
          onSigned={(esign) => {
            setSign(false);
            void submitRequest(session, {
              materialCode: code,
              qtyRequested: qty,
              uom: (uom as MaterialRequest['uom']) || 'kg',
              neededBy,
              toLocation,
              destinationOther,
              classification,
              intendedUse,
              cellBankOrQuarantine: cellBank,
              priority,
              comments,
              requestorEsign: esign,
            })
              .then(onDone)
              .catch((ex) => onError(ex instanceof Error ? ex.message : 'Failed'));
          }}
        />
      )}
    </form>
  );
}

function ApprovalQueue({
  session,
  pendingSup,
  pendingQa,
  inv,
  canSupervisor,
  canQaApprove,
  onReload,
  onError,
  onMsg,
}: {
  session: Session;
  pendingSup: MaterialRequest[];
  pendingQa: MaterialRequest[];
  inv: InventoryRecord[];
  canSupervisor: boolean;
  canQaApprove: boolean;
  onReload: () => Promise<void>;
  onError: (s: string) => void;
  onMsg: (s: string) => void;
}) {
  const [signId, setSignId] = useState('');
  const [signKind, setSignKind] = useState<'supervisor' | 'qa'>('supervisor');
  const rows = [
    ...(canSupervisor ? pendingSup.map((r) => ({ r, kind: 'supervisor' as const })) : []),
    ...(canQaApprove ? pendingQa.map((r) => ({ r, kind: 'qa' as const })) : []),
  ];
  const signing = rows.find((x) => x.r.requestId === signId);

  return (
    <div className="card">
      <h2>Pending my approval</h2>
      {!rows.length && <p className="help">No transfers waiting for your signature.</p>}
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Material</th>
            <th>To</th>
            <th>Qty</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ r, kind }) => (
            <tr key={r.requestId + kind}>
              <td className="mono">{r.requestId}</td>
              <td>
                {r.materialCode} {r.materialName}
                <div className="help">{r.intendedUse || r.purpose}</div>
              </td>
              <td>{r.destination}</td>
              <td>
                {r.qtyRequested} {r.uom}
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setSignKind(kind);
                    setSignId(r.requestId);
                  }}
                >
                  Approve (e-sign)
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {signing && <MtfPrintCard req={signing.r} inv={inv} />}
      {signId && (
        <ESignModal
          session={session}
          title={signKind === 'qa' ? 'QA approval e-sign' : 'Supervisor approval e-sign'}
          meaningDefault={
            signKind === 'qa'
              ? 'I approve this material transfer of cell bank or quarantined material.'
              : 'I approve this material transfer.'
          }
          onCancel={() => setSignId('')}
          onSigned={(esign) => {
            const id = signId;
            const kind = signKind;
            setSignId('');
            const run =
              kind === 'qa' ? approveRequestQa(session, id, esign) : approveRequestSupervisor(session, id, esign);
            void run
              .then(async (r) => {
                onMsg(`${r.requestId} is ${r.status}`);
                await onReload();
              })
              .catch((ex) => onError(ex instanceof Error ? ex.message : 'Approve failed'));
          }}
        />
      )}
    </div>
  );
}

function Queue({
  session,
  open,
  inv,
  active,
  activeId,
  setActiveId,
  onReload,
  onError,
  onMsg,
  canReject,
}: {
  session: Session;
  open: MaterialRequest[];
  inv: InventoryRecord[];
  active: MaterialRequest | undefined;
  activeId: string;
  setActiveId: (s: string) => void;
  onReload: () => Promise<void>;
  onError: (s: string) => void;
  onMsg: (s: string) => void;
  canReject: boolean;
}) {
  const [scanQty, setScanQty] = useState(1);
  const [override, setOverride] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [mmComments, setMmComments] = useState('');
  const [mmNa, setMmNa] = useState(false);
  const [signMm, setSignMm] = useState(false);
  const asOf = todayIsoDateInTz();
  const proposal = useMemo(() => {
    const rows = active ? proposeFefoForRequest(active, inv, asOf) : [];
    return rows.slice().sort((a, b) => {
      const ia = inv.find((r) => r.serial === a.serial);
      const ib = inv.find((r) => r.serial === b.serial);
      return locationSortKey(ia?.location).localeCompare(locationSortKey(ib?.location));
    });
  }, [active, inv, asOf]);
  const pickedSorted = useMemo(() => {
    if (!active) return [];
    return active.pickedSerials.slice().sort((a, b) => {
      const ia = inv.find((r) => r.serial === a.serial);
      const ib = inv.find((r) => r.serial === b.serial);
      return locationSortKey(ia?.location).localeCompare(locationSortKey(ib?.location));
    });
  }, [active, inv]);
  const reservedSorted = useMemo(() => {
    if (!active) return [];
    return (active.reservedSerials || []).slice().sort((a, b) => {
      const ia = inv.find((r) => r.serial === a.serial);
      const ib = inv.find((r) => r.serial === b.serial);
      return locationSortKey(ia?.location).localeCompare(locationSortKey(ib?.location));
    });
  }, [active, inv]);
  const walkList = pickedSorted.length ? pickedSorted : reservedSorted;

  useEffect(() => {
    function onScan(e: Event) {
      const serial = parseScanPayload((e as CustomEvent<{ serial: string }>).detail?.serial ?? '');
      if (!serial || !activeId) return;
      if (isLocationCode(serial)) return;
      onError('');
      void pickSerialForRequest(session, activeId, serial, scanQty)
        .then(async () => {
          scanOk(`Picked ${serial}`);
          onMsg(`Picked ${serial}`);
          await onReload();
        })
        .catch((ex) => {
          const m = ex instanceof Error ? ex.message : 'Pick failed';
          scanErr(m);
          onError(m);
        });
    }
    window.addEventListener(SCAN_EVENT, onScan);
    return () => window.removeEventListener(SCAN_EVENT, onScan);
  }, [activeId, scanQty, session, onReload, onError, onMsg]);

  return (
    <div className="grid grid-2">
      <div className="card">
        <h2>Approved transfers (warehouse)</h2>
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Material</th>
              <th>Qty</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {open.map((r) => (
              <tr key={r.requestId} className={r.requestId === activeId ? 'highlight' : ''} onClick={() => setActiveId(r.requestId)}>
                <td className="mono">{r.requestId}</td>
                <td>
                  {r.materialCode}
                  <div className="help">{r.intendedUse || r.purpose}</div>
                </td>
                <td>
                  {r.qtyIssued}/{r.qtyRequested} {r.uom}
                </td>
                <td>{r.priority}</td>
                <td>
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card grid">
        {!active && <p className="help">Select an approved transfer, then scan serials in the SCAN bar to pick.</p>}
        {active && (
          <>
            <h2 className="mono">{active.requestId}</h2>
            <p>
              {active.materialCode} {active.materialName} · {active.qtyRequested} {active.uom} → {active.destination}
            </p>
            <p className="help">
              Needed {active.neededBy} · {active.intendedUse || active.purpose} · requested by {active.requestedBy}
              {active.cellBankOrQuarantine ? ' · cell bank / quarantine (QA signed)' : ''}
            </p>
            {active.stockWarning && <p className="err">{active.stockWarning}</p>}
            <div className="row no-print">
              <button className="btn btn-sec" type="button" onClick={() => window.print()}>
                Print Material Transfer
              </button>
            </div>
            <MtfPrintCard req={active} inv={inv} />
            <h3>Walk path (sorted by location)</h3>
            <p className="help">Reserved FEFO containers first; operator walks site → building → room → rack → shelf → bin once.</p>
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Location</th>
                  <th>Exp</th>
                  <th>Qty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {proposal.map((p) => {
                  const rec = inv.find((r) => r.serial === p.serial);
                  return (
                    <tr key={p.serial}>
                      <td className="mono">
                        <Link to={`/record/${p.serial}`}>{p.serial}</Link>
                        {rec?.reservedForRequestId === active.requestId && (
                          <div>
                            <span className="badge-reserved">Reserved</span>
                          </div>
                        )}
                      </td>
                      <td>
                        {rec ? locationToString(rec.location) : ''}
                        <div className="help mono">{rec ? locationCode(rec.location) : ''}</div>
                      </td>
                      <td>{p.expiryDate}</td>
                      <td>{p.currentQty}</td>
                      <td>
                        <button
                          className="btn btn-sec"
                          type="button"
                          onClick={() => {
                            const need =
                              active.qtyRequested - active.qtyIssued - active.pickedSerials.reduce((s, x) => s + x.qty, 0);
                            const q = Math.min(p.currentQty, Math.max(need, 0) || p.currentQty);
                            void pickSerialForRequest(session, active.requestId, p.serial, q)
                              .then(async () => {
                                onMsg(`Picked ${p.serial}`);
                                await onReload();
                              })
                              .catch((ex) => onError(ex instanceof Error ? ex.message : 'Pick failed'));
                          }}
                        >
                          Pick
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <label>
              Qty per scan
              <input type="number" min="0" step="0.0001" value={scanQty} onChange={(e) => setScanQty(Number(e.target.value))} />
            </label>
            <p className="help">SCAN bar on this page adds the serial to this open transfer.</p>
            <h3>Picked (not yet issued, walk order)</h3>
            <table>
              <thead>
                <tr>
                  <th>Serial</th>
                  <th>Location</th>
                  <th>Qty</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {pickedSorted.map((p) => (
                  <tr key={p.serial}>
                    <td className="mono">{p.serial}</td>
                    <td>
                      {(() => {
                        const r = inv.find((x) => x.serial === p.serial);
                        return r ? locationToString(r.location) : '';
                      })()}
                    </td>
                    <td>{p.qty}</td>
                    <td>
                      <button
                        className="btn btn-sec"
                        type="button"
                        onClick={() =>
                          void removePick(session, active.requestId, p.serial)
                            .then(onReload)
                            .catch((ex) => onError(ex instanceof Error ? ex.message : 'Failed'))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <label>
              FEFO override reason (if not picking earliest)
              <textarea value={override} onChange={(e) => setOverride(e.target.value)} />
            </label>
            <fieldset className="mtf-section">
              <legend>Section B — Materials Management comments</legend>
              <label>
                Comments
                <textarea
                  value={mmComments}
                  onChange={(e) => {
                    setMmComments(e.target.value);
                    if (e.target.value.trim()) setMmNa(false);
                  }}
                  disabled={mmNa}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={mmNa}
                  onChange={(e) => {
                    setMmNa(e.target.checked);
                    if (e.target.checked) setMmComments('');
                  }}
                />{' '}
                N/A
              </label>
            </fieldset>
            <button
              className="btn"
              type="button"
              disabled={!active.pickedSerials.length}
              onClick={() => {
                onError('');
                setSignMm(true);
              }}
            >
              Confirm issue (MM e-sign)
            </button>
            {signMm && (
              <ESignModal
                session={session}
                title="Materials Management e-sign"
                meaningDefault="I confirm the quantity issued for this material transfer."
                onCancel={() => setSignMm(false)}
                onSigned={(esign) => {
                  setSignMm(false);
                  void confirmFulfillment(session, active.requestId, override, esign, {
                    comments: mmComments,
                    commentsNa: mmNa,
                  })
                    .then(async (r) => {
                      onMsg(`${r.requestId} is ${r.status}`);
                      await onReload();
                    })
                    .catch((ex) => onError(ex instanceof Error ? ex.message : 'Confirm failed'));
                }}
              />
            )}
            {canReject && (
              <>
                <label>
                  Warehouse reject reason
                  <textarea value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
                </label>
                <button
                  className="btn btn-danger"
                  type="button"
                  onClick={() => {
                    onError('');
                    void rejectRequest(session, active.requestId, rejectReason)
                      .then(async (r) => {
                        onMsg(`${r.requestId} rejected`);
                        setActiveId('');
                        await onReload();
                      })
                      .catch((ex) => onError(ex instanceof Error ? ex.message : 'Reject failed'));
                  }}
                >
                  Reject request
                </button>
              </>
            )}
            <div className="pick-ticket">
              <h1>Pick ticket {active.requestId}</h1>
              <p>
                {active.materialCode} {active.materialName} · {active.qtyRequested} {active.uom} → {active.destination}
              </p>
              <p>Intended use {active.intendedUse || active.purpose} · needed {active.neededBy}</p>
              <table>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Serial</th>
                    <th>Location</th>
                    <th>Code</th>
                    <th>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {walkList.map((p, i) => {
                    const r = inv.find((x) => x.serial === p.serial);
                    return (
                      <tr key={p.serial}>
                        <td>{i + 1}</td>
                        <td className="mono">{p.serial}</td>
                        <td>{r ? locationToString(r.location) : ''}</td>
                        <td className="mono">{r ? locationCode(r.location) : ''}</td>
                        <td>
                          {p.qty} {active.uom}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Mine({
  session,
  mine,
  inv,
  onReload,
  onError,
  onMsg,
  canCancel,
  canConfirmReceipt,
}: {
  session: Session;
  mine: MaterialRequest[];
  inv: InventoryRecord[];
  onReload: () => Promise<void>;
  onError: (s: string) => void;
  onMsg: (s: string) => void;
  canFulfill: boolean;
  canCancel: boolean;
  canConfirmReceipt: boolean;
}) {
  const [cancelReason, setCancelReason] = useState('');
  const [signId, setSignId] = useState('');
  const [qtyRecv, setQtyRecv] = useState<Record<string, number>>({});
  const signing = mine.find((r) => r.requestId === signId);

  return (
    <div className="card">
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Material</th>
            <th>Qty</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {mine.map((r) => (
            <tr key={r.requestId}>
              <td className="mono">{r.requestId}</td>
              <td>
                {r.materialCode} {r.materialName}
                <div className="help">{r.intendedUse || r.purpose}</div>
              </td>
              <td>
                {r.qtyIssued}/{r.qtyRequested} {r.uom}
              </td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td>
                {['Pending Supervisor', 'Pending QA', 'Submitted'].includes(r.status) && canCancel && (
                  <button
                    className="btn btn-sec"
                    type="button"
                    onClick={() => {
                      const reason = cancelReason || 'Cancelled by requester';
                      void cancelRequest(session, r.requestId, reason)
                        .then(async () => {
                          onMsg(`Cancelled ${r.requestId}`);
                          await onReload();
                        })
                        .catch((ex) => onError(ex instanceof Error ? ex.message : 'Failed'));
                    }}
                  >
                    Cancel
                  </button>
                )}
                {(r.status === 'Issued' || r.status === 'Partially Issued') && canConfirmReceipt && (
                  <div className="row">
                    <label>
                      Qty received
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={qtyRecv[r.requestId] ?? r.qtyIssued}
                        onChange={(e) => setQtyRecv((m) => ({ ...m, [r.requestId]: Number(e.target.value) }))}
                      />
                    </label>
                    <button
                      className="btn btn-ok"
                      type="button"
                      onClick={() => setSignId(r.requestId)}
                    >
                      Confirm received
                    </button>
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <label>
        Cancel reason
        <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
      </label>
      {signing && <MtfPrintCard req={signing} inv={inv} />}
      {signId && signing && (
        <ESignModal
          session={session}
          title="Receiver e-sign"
          meaningDefault="I confirm receipt of this material transfer."
          onCancel={() => setSignId('')}
          onSigned={(esign) => {
            const id = signId;
            const qty = qtyRecv[id] ?? signing.qtyIssued;
            setSignId('');
            void confirmReceived(session, id, esign, qty)
              .then(async () => {
                onMsg(`Closed ${id}`);
                await onReload();
              })
              .catch((ex) => onError(ex instanceof Error ? ex.message : 'Failed'));
          }}
        />
      )}
    </div>
  );
}

function esignLine(e?: ESign): string {
  if (!e) return '—';
  return `${e.printedName} (${e.userId}) ${e.signedAtUtc}`;
}

function MtfPrintCard({ req, inv }: { req: MaterialRequest; inv: InventoryRecord[] }) {
  const picked = req.pickedSerials.length
    ? req.pickedSerials
    : req.reservedSerials || [];
  const lotsFromInv = [...new Set(picked.map((p) => inv.find((r) => r.serial === p.serial)?.internalLot || inv.find((r) => r.serial === p.serial)?.manufacturerLot || '').filter(Boolean))];
  return (
    <div className="mtf-print">
      <header>
        <h1>
          {DOC_ID} Material Transfer {req.requestId}
        </h1>
        <p className="help">Status: {req.status}</p>
      </header>
      <section>
        <h2>Section A — Requestor</h2>
        <p>
          <strong>Material:</strong> {req.materialCode} {req.materialName} · {req.qtyRequested} {req.uom}
        </p>
        <p>
          <strong>To location:</strong> {req.toLocation || req.destination}
          {req.toLocation === 'Other' && req.destinationOther ? ` (${req.destinationOther})` : ''}
        </p>
        <p>
          <strong>Classification:</strong> {(req.classification || []).join(', ') || '—'}
        </p>
        <p>
          <strong>Intended use:</strong> {req.intendedUse || req.purpose}
        </p>
        <p>
          <strong>Needed by:</strong> {req.neededBy} · <strong>Cell bank / quarantine:</strong>{' '}
          {req.cellBankOrQuarantine ? 'Yes' : 'No'}
        </p>
        <p>
          <strong>Requestor:</strong> {esignLine(req.requestorEsign)}
        </p>
        <p>
          <strong>Supervisor:</strong> {esignLine(req.supervisorEsign)}
        </p>
        <p>
          <strong>QA:</strong> {esignLine(req.qaEsign)}
        </p>
      </section>
      <section>
        <h2>Section B — Materials Management / source</h2>
        <p>
          <strong>Qty issued:</strong> {req.qtyIssued} {req.uom}
        </p>
        <p>
          <strong>Lot:</strong> {req.sourceLot || lotsFromInv.join(', ') || '—'}
        </p>
        <p>
          <strong>Expiry:</strong> {req.sourceExpiry || '—'}
        </p>
        <p>
          <strong>Source location:</strong> {req.sourceLocation || '—'}
        </p>
        <p>
          <strong>Comments:</strong> {req.mmCommentsNa ? 'N/A' : req.mmComments || '—'}
        </p>
        <p>
          <strong>MM e-sign:</strong> {esignLine(req.mmEsign)}
        </p>
      </section>
      <section>
        <h2>Section C — Receiver</h2>
        <p>
          <strong>Qty received:</strong> {req.qtyReceived ?? '—'} {req.uom}
        </p>
        <p>
          <strong>Receiver:</strong> {esignLine(req.receiverEsign)}
        </p>
      </section>
    </div>
  );
}
