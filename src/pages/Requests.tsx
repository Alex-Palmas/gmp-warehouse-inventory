import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { InventoryRecord, Material, MaterialRequest, RequestPriority, Session } from '../types';
import { REQUEST_PRIORITIES, UOMS } from '../types';
import { useCap, useCaps } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import { listMaterials } from '../lib/materials';
import { listInventory } from '../lib/inventory';
import {
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

export function Requests({ session }: { session: Session }) {
  const caps = useCaps(session);
  const canSubmit = useCap(session, 'submitRequest');
  const canFulfill = useCap(session, 'fulfillRequest');
  const [tab, setTab] = useState<'submit' | 'queue' | 'mine'>('queue');
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
    if (canSubmit && canFulfill === false) setTab('submit');
  }, [sp, canSubmit, canFulfill]);

  if (canSubmit === null || canFulfill === null) return <CapChecking />;
  if (!canSubmit && !canFulfill) return <CapDenied cap="submitRequest or fulfillRequest" />;

  const open = reqs.filter((r) => ['Submitted', 'Picking', 'Partially Issued'].includes(r.status));
  const mine = reqs.filter((r) => r.requestedBy === session.userId);
  const active = reqs.find((r) => r.requestId === activeId);

  return (
    <div>
      <h1>Material requests</h1>
      <p className="help">
        Authorized requisition (EU GMP). Warehouse picks Released FEFO serials by scan, then confirms issue.
        Requester confirms received to close chain of custody. Direct Issue remains for supervisor emergency.
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        {canSubmit && (
          <button className={`btn ${tab === 'submit' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('submit')}>
            Submit request
          </button>
        )}
        {canFulfill && (
          <button className={`btn ${tab === 'queue' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('queue')}>
            Warehouse queue ({open.length})
          </button>
        )}
        {canSubmit && (
          <button className={`btn ${tab === 'mine' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('mine')}>
            My requests ({mine.length})
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
            setMsg(`Submitted ${r.requestId}${r.stockWarning ? ' — ' + r.stockWarning : ''}`);
            await reload();
            setTab(canFulfill ? 'queue' : 'mine');
          }}
          onError={setErr}
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
        />
      )}
      {tab === 'mine' && (
        <Mine
          session={session}
          mine={mine}
          onReload={reload}
          onError={setErr}
          onMsg={setMsg}
          canFulfill={Boolean(caps?.has('fulfillRequest'))}
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
  const [dest, setDest] = useState('Lab');
  const [purpose, setPurpose] = useState('Lab / production use');
  const [priority, setPriority] = useState<RequestPriority>('Routine');
  const [comments, setComments] = useState('');
  const [more, setMore] = useState(false);
  const [hi, setHi] = useState(0);
  const asOf = todayIsoDateInTz();
  const avail = code ? availableReleasedQty(inv, code, asOf) : 0;
  const mat = mats.find((m) => m.materialCode === code);
  const matches = mats.filter((m) => {
    if (!m.active) return false;
    if (!q.trim()) return !code;
    const s = q.toLowerCase();
    return (
      m.materialCode.toLowerCase().includes(s) ||
      m.materialName.toLowerCase().includes(s)
    );
  }).slice(0, 8);

  function choose(m: Material) {
    setCode(m.materialCode);
    setQ(`${m.materialCode} ${m.materialName}`);
    setUom(m.defaultUom);
  }

  async function doSubmit() {
    onError('');
    try {
      const rec = await submitRequest(session, {
        materialCode: code,
        qtyRequested: qty,
        uom: (uom as MaterialRequest['uom']) || 'kg',
        neededBy,
        destination: dest || 'Lab',
        purpose: purpose || 'Lab / production use',
        priority,
        comments,
      });
      onDone(rec);
    } catch (ex) {
      onError(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  return (
    <form
      className="card grid"
      onSubmit={(e) => {
        e.preventDefault();
        void doSubmit();
      }}
    >
      <p className="kbd-hint">Keyboard-first: type material, Tab to qty, needed-by, Enter submits. Extra fields under More.</p>
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
          Released FEFO available: {avail} {uom}. {avail < qty ? 'Insufficient stock — you may still submit (no full reserve).' : 'FEFO containers will be reserved.'}
        </p>
      )}
      <div className="grid grid-3">
        <label>
          Qty
          <input type="number" min="0" step="0.0001" value={qty} onChange={(e) => setQty(Number(e.target.value))} required />
        </label>
        <label>
          Needed by
          <input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
        </label>
        <label>
          UOM
          <select value={uom} onChange={(e) => setUom(e.target.value)}>
            {UOMS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </label>
      </div>
      <button className="btn btn-sec" type="button" onClick={() => setMore((m) => !m)}>
        {more ? 'Hide details' : 'More details (destination, purpose, priority)'}
      </button>
      {more && (
        <>
          <label>
            Destination
            <input value={dest} onChange={(e) => setDest(e.target.value)} placeholder="Lab / suite / batch area" />
          </label>
          <label>
            Purpose / batch
            <input value={purpose} onChange={(e) => setPurpose(e.target.value)} />
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
        </>
      )}
      <button className="btn" type="submit" disabled={!mat}>
        Submit request (Enter)
      </button>
    </form>
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
}) {
  const [scanQty, setScanQty] = useState(1);
  const [override, setOverride] = useState('');
  const [rejectReason, setRejectReason] = useState('');
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
        <h2>Open requests</h2>
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
                  <div className="help">{r.purpose}</div>
                </td>
                <td>
                  {r.qtyIssued}/{r.qtyRequested} {r.uom}
                </td>
                <td>{r.priority}</td>
                <td>{r.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card grid">
        {!active && <p className="help">Select a request, then scan serials in the SCAN bar to pick.</p>}
        {active && (
          <>
            <h2 className="mono">{active.requestId}</h2>
            <p>
              {active.materialCode} {active.materialName} · {active.qtyRequested} {active.uom} → {active.destination}
            </p>
            <p className="help">
              Needed {active.neededBy} · {active.purpose} · requested by {active.requestedBy}
            </p>
            {active.stockWarning && <p className="err">{active.stockWarning}</p>}
            <h3>Walk path (sorted by location)</h3>
            <p className="help">Reserved FEFO containers first; operator walks site → building → room → rack → shelf → bin once.</p>
            <button
              className="btn btn-sec no-print"
              type="button"
              onClick={() => window.print()}
            >
              Print pick ticket
            </button>
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
                        <div><span className="badge-reserved">Reserved</span></div>
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
                            active.qtyRequested -
                            active.qtyIssued -
                            active.pickedSerials.reduce((s, x) => s + x.qty, 0);
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
            <p className="help">SCAN bar on this page adds the serial to this open request.</p>
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
                    <td>{(() => { const r = inv.find((x) => x.serial === p.serial); return r ? locationToString(r.location) : ''; })()}</td>
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
            <button
              className="btn"
              type="button"
              disabled={!active.pickedSerials.length}
              onClick={() => {
                onError('');
                void confirmFulfillment(session, active.requestId, override)
                  .then(async (r) => {
                    onMsg(`${r.requestId} is ${r.status}`);
                    await onReload();
                  })
                  .catch((ex) => onError(ex instanceof Error ? ex.message : 'Confirm failed'));
              }}
            >
              Confirm issue
            </button>
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
            <div className="pick-ticket">
              <h1>Pick ticket {active.requestId}</h1>
              <p>
                {active.materialCode} {active.materialName} · {active.qtyRequested} {active.uom} → {active.destination}
              </p>
              <p>Purpose {active.purpose} · needed {active.neededBy}</p>
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
  onReload,
  onError,
  onMsg,
}: {
  session: Session;
  mine: MaterialRequest[];
  onReload: () => Promise<void>;
  onError: (s: string) => void;
  onMsg: (s: string) => void;
  canFulfill: boolean;
}) {
  const [cancelReason, setCancelReason] = useState('');
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
                <div className="help">{r.purpose}</div>
              </td>
              <td>
                {r.qtyIssued}/{r.qtyRequested} {r.uom}
              </td>
              <td>{r.status}</td>
              <td>
                {r.status === 'Submitted' && (
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
                {(r.status === 'Issued' || r.status === 'Partially Issued') && (
                  <button
                    className="btn btn-ok"
                    type="button"
                    onClick={() =>
                      void confirmReceived(session, r.requestId)
                        .then(async () => {
                          onMsg(`Closed ${r.requestId}`);
                          await onReload();
                        })
                        .catch((ex) => onError(ex instanceof Error ? ex.message : 'Failed'))
                    }
                  >
                    Confirm received
                  </button>
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
    </div>
  );
}
