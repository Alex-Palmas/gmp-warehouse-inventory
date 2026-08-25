import { Fragment, useEffect, useMemo, useState } from 'react';
import type {
  Capability,
  MatrixRows,
  PermissionMatrixDocument,
  PermissionMatrixHistory,
  RoleRecord,
  Session,
  SodRules,
  UserRecord,
} from '../types';
import { CAPABILITY_GROUPS, CAPABILITY_LABELS, DEFAULT_SOD } from '../types';
import {
  cloneRows,
  createCustomRole,
  evaluateSod,
  getLiveMatrix,
  listMatrixHistory,
  listRoles,
  savePermissionMatrix,
  setRoleActive,
  validateMatrixSave,
} from '../lib/permissions';
import {
  createUser,
  isAccountLocked,
  listAccessLog,
  listUsers,
  unlockUser,
  updateUser,
} from '../lib/auth';
import { importBackup } from '../lib/backup';
import { downloadBlob, exportExcelWorkbook } from '../lib/excelExport';
import { ESignModal } from '../components/ESignModal';
import { CapDenied, CapChecking } from '../components/CapGuard';
import { useCap } from '../hooks/useCap';
import { todayIsoDateInTz, toDisplayLocal } from '../lib/dates';
import type { AccessLogEntry } from '../types';

type Tab = 'users' | 'matrix' | 'history' | 'accesslog';

export function AccessControl({ session }: { session: Session }) {
  const canUsers = useCap(session, 'adminUsers');
  const canMatrix = useCap(session, 'editPermissionMatrix');
  const canBackup = useCap(session, 'backupRestore');
  const canExport = useCap(session, 'exportReports');
  const canAccessLog = useCap(session, 'viewAccessLog');
  const [tab, setTab] = useState<Tab>('users');

  if (canUsers === null || canMatrix === null) return <CapChecking />;
  if (!canUsers && !canMatrix) return <CapDenied cap="adminUsers or editPermissionMatrix" />;

  return (
    <div>
      <h1>User access control</h1>
      <div className="card legend">
        <strong>21 CFR Part 11 mapping</strong>
        <ul>
          <li>11.10(d) — access limited to authorized individuals (unique user IDs; deactivate not delete; lockout).</li>
          <li>11.10(g) — authority checks per operation via the live capability matrix (not role display names).</li>
          <li>11.10(e) — append-only audit trail of operator actions (UTC + local).</li>
        </ul>
        The matrix below is the editor. Unique user IDs are never reused. Saving the matrix requires an electronic signature.
      </div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className={`btn ${tab === 'users' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('users')}>
          Users
        </button>
        <button className={`btn ${tab === 'matrix' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('matrix')}>
          Permission matrix
        </button>
        <button className={`btn ${tab === 'history' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('history')}>
          Matrix history
        </button>
        {canAccessLog && (
          <button className={`btn ${tab === 'accesslog' ? '' : 'btn-sec'}`} type="button" onClick={() => setTab('accesslog')}>
            Access log
          </button>
        )}
      </div>
      {tab === 'users' && (
        <UsersPanel
          session={session}
          canUsers={Boolean(canUsers)}
          canBackup={Boolean(canBackup)}
          canExport={Boolean(canExport)}
        />
      )}
      {tab === 'matrix' && (
        <MatrixPanel session={session} canEdit={Boolean(canMatrix)} />
      )}
      {tab === 'history' && <HistoryPanel />}
      {tab === 'accesslog' && canAccessLog && <AccessLogPanel />}
    </div>
  );
}

function UsersPanel({
  session,
  canUsers,
  canBackup,
  canExport,
}: {
  session: Session;
  canUsers: boolean;
  canBackup: boolean;
  canExport: boolean;
}) {
  const [rows, setRows] = useState<UserRecord[]>([]);
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [matrix, setMatrix] = useState<PermissionMatrixDocument | null>(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [form, setForm] = useState({ userId: '', fullName: '', role: 'operator', password: '' });
  const [reason, setReason] = useState('Administrative change');
  const [effective, setEffective] = useState('');
  const canUnlock = useCap(session, 'unlockUser');
  const canResetPw = useCap(session, 'resetUserPassword');

  async function reload() {
    setRows(await listUsers());
    setRoles(await listRoles());
    setMatrix(await getLiveMatrix());
  }
  useEffect(() => {
    void reload();
  }, []);

  const roleName = (id: string) => roles.find((r) => r.roleId === id)?.name ?? id;
  const activeRoles = roles.filter((r) => r.active);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr('');
    try {
      await createUser(session, form);
      setMsg(`Created ${form.userId}`);
      setForm({ userId: '', fullName: '', role: 'operator', password: '' });
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  async function patch(
    u: UserRecord,
    p: Parameters<typeof updateUser>[2],
    why: string,
  ) {
    setErr('');
    try {
      await updateUser(session, u.userId, p, why);
      await reload();
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : 'Failed');
    }
  }

  const selected = rows.find((r) => r.userId === effective);
  const effectiveCaps = selected && matrix
    ? Object.entries(matrix.rows[selected.role] ?? {})
        .filter(([, v]) => v)
        .map(([k]) => k)
    : [];

  return (
    <div>
      {canUsers && (
        <form className="card grid grid-4" onSubmit={add} autoComplete="off">
          <label>
            User ID
            <input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} required autoComplete="off" />
          </label>
          <label>
            Full name
            <input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} required autoComplete="off" />
          </label>
          <label>
            Role
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {activeRoles.map((r) => (
                <option key={r.roleId} value={r.roleId}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Temporary password
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
          </label>
          <p className="help" style={{ gridColumn: '1 / -1' }}>
            Temp password must meet policy (12+ chars, upper/lower/digit/special). User must change it
            on first login. User IDs are unique forever, including deactivated accounts.
          </p>
          <button className="btn" type="submit">
            Create user
          </button>
        </form>
      )}
      <label>
        Reason for user changes
        <input value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      {err && <p className="err">{err}</p>}
      {msg && <p className="ok">{msg}</p>}
      <div className="row" style={{ margin: '8px 0' }}>
        {canExport && (
          <button
            className="btn btn-sec"
            type="button"
            onClick={async () => {
              const blob = await exportExcelWorkbook(session);
              downloadBlob(blob, `WH-INV-access-${todayIsoDateInTz()}.xlsx`);
            }}
          >
            Export user access list (Excel)
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <th>User ID</th>
            <th>Name</th>
            <th>Role</th>
            <th>Active</th>
            <th>Locked</th>
            <th>Last login</th>
            <th>Password changed</th>
            <th>Fails</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((u) => {
            const locked = isAccountLocked(u);
            return (
              <tr key={u.userId} className={!u.active ? 'inactive-row' : ''}>
                <td className="mono">{u.userId}</td>
                <td>{u.fullName}</td>
                <td>
                  {canUsers ? (
                    <select
                      value={u.role}
                      onChange={(e) => void patch(u, { role: e.target.value }, reason || 'Role assignment change')}
                    >
                      {activeRoles.map((r) => (
                        <option key={r.roleId} value={r.roleId}>
                          {r.name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    roleName(u.role)
                  )}
                </td>
                <td>{u.active ? 'Y' : 'N'}</td>
                <td>{locked ? 'Y' : 'N'}</td>
                <td>{u.lastLoginUtc ? toDisplayLocal(u.lastLoginUtc) : '—'}</td>
                <td>{u.passwordChangedUtc ? toDisplayLocal(u.passwordChangedUtc) : '—'}</td>
                <td>{u.failedAttempts ?? 0}</td>
                <td>
                  {canUsers && (
                    <div className="row">
                      <button className="btn btn-sec" type="button" onClick={() => void patch(u, { active: !u.active }, reason || (u.active ? 'Deactivate' : 'Activate'))}>
                        {u.active ? 'Deactivate' : 'Activate'}
                      </button>
                      {locked && canUnlock && (
                        <button
                          className="btn btn-sec"
                          type="button"
                          onClick={async () => {
                            try {
                              await unlockUser(session, u.userId, reason || 'Admin unlock');
                              await reload();
                            } catch (ex) {
                              setErr(ex instanceof Error ? ex.message : 'Unlock failed');
                            }
                          }}
                        >
                          Unlock
                        </button>
                      )}
                      {canResetPw && (
                      <button
                        className="btn btn-sec"
                        type="button"
                        onClick={() => {
                          const pw = window.prompt('Temporary password (policy applies; user must change on next login)');
                          if (!pw) return;
                          void patch(u, { newPassword: pw, mustChangePassword: true }, reason || 'Reset temporary password');
                        }}
                      >
                        Reset temp password
                      </button>
                      )}
                      <button
                        className="btn btn-sec"
                        type="button"
                        onClick={() => void patch(u, { mustChangePassword: true }, reason || 'Force password change')}
                      >
                        Force password change
                      </button>
                      <button className="btn btn-sec" type="button" onClick={() => setEffective(u.userId)}>
                        Effective access
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {selected && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>
            Effective access — {selected.fullName} ({selected.userId}) · {roleName(selected.role)}
          </h2>
          {effectiveCaps.length === 0 ? <p>No capabilities.</p> : (
            <ul>
              {effectiveCaps.map((c) => (
                <li key={c}>
                  <span className="mono">{c}</span> — {CAPABILITY_LABELS[c as Capability] ?? c}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {canBackup && (
        <div className="card" style={{ marginTop: 12 }}>
          <h2>Restore JSON backup</h2>
          <p className="help">Replaces ALL local stores including roles and the permission matrix. Audited. Not a validated migration tool.</p>
          <input
            type="file"
            accept="application/json"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              setErr('');
              try {
                const payload = JSON.parse(await f.text());
                await importBackup(session, payload);
                setMsg('Backup restored. Reload the page.');
              } catch (ex) {
                setErr(ex instanceof Error ? ex.message : 'Restore failed');
              }
            }}
          />
        </div>
      )}
    </div>
  );
}

function MatrixPanel({ session, canEdit }: { session: Session; canEdit: boolean }) {
  const canCreateRole = useCap(session, 'createRole');
  const [roles, setRoles] = useState<RoleRecord[]>([]);
  const [live, setLive] = useState<PermissionMatrixDocument | null>(null);
  const [rows, setRows] = useState<MatrixRows>({});
  const [sod, setSod] = useState<SodRules>({ ...DEFAULT_SOD });
  const [waiver, setWaiver] = useState('');
  const [ack, setAck] = useState(false);
  const [sign, setSign] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [newRole, setNewRole] = useState({ roleId: '', name: '', description: '' });

  async function reload() {
    const r = await listRoles();
    const m = await getLiveMatrix();
    setRoles(r);
    setLive(m);
    setRows(cloneRows(m.rows));
    setSod({ ...m.sod });
    setWaiver(m.sodWaiver ?? '');
  }
  useEffect(() => {
    void reload();
  }, []);

  const visibleRoles = roles.filter((r) => r.active || rows[r.roleId]);
  const violations = useMemo(() => evaluateSod(rows, sod), [rows, sod]);
  const validation = useMemo(
    () => validateMatrixSave(rows, sod, ack ? waiver : undefined),
    [rows, sod, ack, waiver],
  );

  function toggle(roleId: string, cap: Capability, on: boolean) {
    if (!canEdit) return;
    setRows((prev) => ({
      ...prev,
      [roleId]: { ...prev[roleId], [cap]: on },
    }));
  }

  if (!live) return <CapChecking />;

  return (
    <div>
      <p className="help">
        Matrix v{live.version} · last approved by {live.approvedBy} · {toDisplayLocal(live.approvedOnUtc)}.
        {canEdit ? ' Checkboxes are live; Save requires e-sign.' : ' Read-only (editPermissionMatrix required to save).'}
      </p>
      <div className="legend">
        <span>SoD defaults ON: QA disposition XOR receive · destroy requires eSign · matrix editor XOR QA disposition.</span>
      </div>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th className="sticky">Capability</th>
              {visibleRoles.map((r) => (
                <th key={r.roleId} title={r.description}>
                  {r.name}
                  <div className="help">
                    {r.roleId}
                    {r.system ? ' · system' : ''}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {CAPABILITY_GROUPS.map((g) => (
              <Fragment key={g.id}>
                <tr className="cap-group">
                  <td className="sticky" colSpan={visibleRoles.length + 1}>
                    {g.label}
                  </td>
                </tr>
                {g.caps.map((cap) => (
                  <tr key={cap}>
                    <td className="sticky">
                      <div>{CAPABILITY_LABELS[cap]}</div>
                      <div className="mono help">{cap}</div>
                    </td>
                    {visibleRoles.map((r) => (
                      <td key={r.roleId} style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          disabled={!canEdit}
                          checked={Boolean(rows[r.roleId]?.[cap])}
                          onChange={(e) => toggle(r.roleId, cap, e.target.checked)}
                          aria-label={`${r.name} ${cap}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card" style={{ marginTop: 12 }}>
        <h2>Segregation of duties</h2>
        <label className="row">
          <input type="checkbox" disabled={!canEdit} checked={sod.qaDispositionXorReceive} onChange={(e) => setSod({ ...sod, qaDispositionXorReceive: e.target.checked })} />
          qaDisposition XOR receive (same role)
        </label>
        <label className="row">
          <input type="checkbox" disabled={!canEdit} checked={sod.destroyRequiresESign} onChange={(e) => setSod({ ...sod, destroyRequiresESign: e.target.checked })} />
          destroy requires eSign
        </label>
        <label className="row">
          <input type="checkbox" disabled={!canEdit} checked={sod.editMatrixXorQaDisposition} onChange={(e) => setSod({ ...sod, editMatrixXorQaDisposition: e.target.checked })} />
          editPermissionMatrix XOR qaDisposition
        </label>
        <label className="row">
          <input type="checkbox" disabled={!canEdit} checked={sod.qaDispositionXorFulfill ?? true} onChange={(e) => setSod({ ...sod, qaDispositionXorFulfill: e.target.checked })} />
          qaDisposition XOR fulfillRequest (QA does not pick/issue against requests)
        </label>
        {violations.length > 0 && (
          <div>
            {violations.map((v) => (
              <p className="err" key={`${v.roleId}-${v.rule}`}>
                {v.message}
              </p>
            ))}
            <label>
              Documented SoD waiver (save still warned; default is BLOCK without this)
              <textarea value={waiver} disabled={!canEdit} onChange={(e) => setWaiver(e.target.value)} />
            </label>
            <label className="row">
              <input type="checkbox" disabled={!canEdit} checked={ack} onChange={(e) => setAck(e.target.checked)} />
              I acknowledge a documented SoD waiver for the violations above
            </label>
          </div>
        )}
        {validation.errors.filter((e) => !violations.some((v) => e === v.message)).map((e) => (
          <p className="err" key={e}>
            {e}
          </p>
        ))}
        {err && <p className="err">{err}</p>}
        {msg && <p className="ok">{msg}</p>}
        {canEdit && (
          <button className="btn" type="button" onClick={() => setSign(true)}>
            Save matrix (e-sign)
          </button>
        )}
      </div>
      {canEdit && canCreateRole && (
        <div className="card">
          <h2>Custom role</h2>
          <form
            className="grid grid-3"
            onSubmit={async (e) => {
              e.preventDefault();
              setErr('');
              try {
                await createCustomRole(session, newRole);
                setNewRole({ roleId: '', name: '', description: '' });
                await reload();
              } catch (ex) {
                setErr(ex instanceof Error ? ex.message : 'Failed');
              }
            }}
          >
            <label>
              Role ID
              <input value={newRole.roleId} onChange={(e) => setNewRole({ ...newRole, roleId: e.target.value })} required />
            </label>
            <label>
              Name
              <input value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} required />
            </label>
            <label>
              Description
              <input value={newRole.description} onChange={(e) => setNewRole({ ...newRole, description: e.target.value })} />
            </label>
            <button className="btn" type="submit">
              Add role
            </button>
          </form>
          <table style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>System</th>
                <th>Active</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => (
                <tr key={r.roleId}>
                  <td className="mono">{r.roleId}</td>
                  <td>{r.name}</td>
                  <td>{r.system ? 'Y' : 'N'}</td>
                  <td>{r.active ? 'Y' : 'N'}</td>
                  <td>
                    {!r.system && (
                      <button
                        className="btn btn-sec"
                        type="button"
                        onClick={() => void setRoleActive(session, r.roleId, !r.active, r.active ? 'Deactivate unused custom role' : 'Reactivate custom role').then(reload).catch((ex) => setErr(ex instanceof Error ? ex.message : 'Failed'))}
                      >
                        {r.active ? 'Deactivate' : 'Activate'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sign && (
        <ESignModal
          session={session}
          title="E-sign permission matrix"
          meaningDefault="I authorize this access control configuration"
          onCancel={() => setSign(false)}
          onSigned={async (esign, reason) => {
            setErr('');
            try {
              const next = await savePermissionMatrix(
                session,
                rows,
                sod,
                esign,
                reason,
                violations.length && ack ? waiver : undefined,
              );
              setLive(next);
              setMsg(`Matrix saved as version ${next.version}`);
              setSign(false);
            } catch (ex) {
              setErr(ex instanceof Error ? ex.message : 'Save failed');
            }
          }}
        />
      )}
    </div>
  );
}

function HistoryPanel() {
  const [rows, setRows] = useState<PermissionMatrixHistory[]>([]);
  useEffect(() => {
    void listMatrixHistory().then(setRows);
  }, []);
  return (
    <div>
      <h2>Permission matrix history (append-only)</h2>
      <table>
        <thead>
          <tr>
            <th>Version</th>
            <th>Saved</th>
            <th>By</th>
            <th>Reason</th>
            <th>Meaning</th>
            <th>Cells changed</th>
            <th>Waiver</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.id}>
              <td>{h.version}</td>
              <td>{toDisplayLocal(h.savedOnUtc)}</td>
              <td className="mono">{h.savedBy}</td>
              <td>{h.reasonForChange}</td>
              <td>{h.meaningOfSignature}</td>
              <td>{h.cellChanges.length}</td>
              <td>{h.sodWaiver ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccessLogPanel() {
  const [rows, setRows] = useState<AccessLogEntry[]>([]);
  useEffect(() => {
    void listAccessLog().then(setRows);
  }, []);
  return (
    <div>
      <h2>User access log</h2>
      <table>
        <thead>
          <tr>
            <th>UTC</th>
            <th>User</th>
            <th>Event</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td className="mono">{a.timestampUtc}</td>
              <td>
                {a.userName} ({a.userId})
              </td>
              <td>{a.event}</td>
              <td>{a.detail}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
