import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { FLASH_EVENT } from '../lib/scanFeedback';
import type { Capability, Session } from '../types';
import { DOC_ID, DOC_VERSION, VALIDATION_BANNER, APP_VERSION, PRESENTATION_ROLE_ID } from '../types';
import { ScanBox } from './ScanBox';
import { ThemeToggle } from './ThemeToggle';
import { logout } from '../lib/auth';
import { toDisplayLocal } from '../lib/dates';
import { useCaps } from '../hooks/useCap';
import { unreadInboxCount } from '../lib/inbox';
import { viewAsOptions } from '../lib/viewAs';

const PRIMARY = new Set(['/', '/register', '/inbox', '/receive', '/qa', '/audit', '/access']);

const NAV: { to: string; label: string; cap: Capability }[] = [
  { to: '/', label: 'Dashboard', cap: 'viewDashboard' },
  { to: '/requests', label: 'Request material', cap: 'submitRequest' },
  { to: '/submit-material', label: 'Submit material', cap: 'submitMaterial' },
  { to: '/register', label: 'Register', cap: 'viewRegister' },
  { to: '/inbox', label: 'Inbox', cap: 'viewInbox' },
  { to: '/receive', label: 'Receipt', cap: 'receive' },
  { to: '/qa', label: 'QA Disp.', cap: 'qaDisposition' },
  { to: '/samples', label: 'Samples', cap: 'samplePull' },
  { to: '/transfer', label: 'Transfer', cap: 'transfer' },
  { to: '/issue', label: 'Issue', cap: 'issue' },
  { to: '/return', label: 'Return', cap: 'returnToStock' },
  { to: '/hold', label: 'Hold', cap: 'hold' },
  { to: '/count', label: 'Cycle Count', cap: 'cycleCount' },
  { to: '/destroy', label: 'Destroy', cap: 'destroy' },
  { to: '/reprint', label: 'Labels', cap: 'reprintLabel' },
  { to: '/scan', label: 'Scan', cap: 'scanLookup' },
  { to: '/materials', label: 'Materials', cap: 'adminMaterials' },
  { to: '/access', label: 'Access', cap: 'adminUsers' },
  { to: '/audit', label: 'Audit', cap: 'viewAudit' },
];

export function Layout({
  session,
  effective,
  viewAs,
  onViewAs,
  onLogout,
}: {
  session: Session;
  effective: Session;
  viewAs: string;
  onViewAs: (roleId: string) => void;
  onLogout: () => void;
}) {
  const nav = useNavigate();
  const caps = useCaps(effective);
  const canViewAs = session.role === PRESENTATION_ROLE_ID;
  const loc = useLocation();
  const moreRef = useRef<HTMLDetailsElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [flash, setFlash] = useState<{ kind: 'ok' | 'err'; message: string } | null>(null);
  useEffect(() => {
    function onFlash(e: Event) {
      const d = (e as CustomEvent<{ kind: 'ok' | 'err'; message: string }>).detail;
      setFlash({ kind: d.kind, message: d.message });
      window.setTimeout(() => setFlash(null), 700);
    }
    window.addEventListener(FLASH_EVENT, onFlash);
    return () => window.removeEventListener(FLASH_EVENT, onFlash);
  }, []);
  useEffect(() => {
    let live = true;
    function load() {
      void unreadInboxCount(session.userId).then((n) => {
        if (live) setUnread(n);
      });
    }
    load();
    const t = window.setInterval(load, 8000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [session.userId]);
  useEffect(() => {
    setMoreOpen(false);
  }, [loc.pathname]);
  useEffect(() => {
    if (!moreOpen) return;
    function onDown(e: PointerEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setMoreOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);
  async function doLogout() {
    await logout(session);
    onLogout();
    nav('/login');
  }
  const link = (to: string, label: string, badge?: number) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')} end={to === '/'}>
      {label}
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </NavLink>
  );
  const show = (item: (typeof NAV)[number]) => {
    if (!caps) return false;
    if (item.to === '/access') return caps.has('adminUsers') || caps.has('editPermissionMatrix');
    if (item.to === '/requests') return caps.has('submitRequest') || caps.has('fulfillRequest');
    return caps.has(item.cap);
  };
  const visible = NAV.filter(show);
  const primary = visible.filter((i) => PRIMARY.has(i.to));
  const more = visible.filter((i) => !PRIMARY.has(i.to));
  return (
    <div>
      <div className="banner">
        VALIDATION STATUS: {VALIDATION_BANNER} | {DOC_ID} v{DOC_VERSION}
      </div>
      <header className="header no-print">
        <div className="brand">WH-INV</div>
        <nav className="nav">
          {primary.map((item) => (
            <span key={item.to}>{link(item.to, item.label, item.to === '/inbox' ? unread : 0)}</span>
          ))}
          {more.length > 0 && (
            <details
              ref={moreRef}
              className="nav-more"
              open={moreOpen}
              onToggle={(e) => setMoreOpen((e.target as HTMLDetailsElement).open)}
              onMouseLeave={() => setMoreOpen(false)}
            >
              <summary>More</summary>
              <div className="nav-more-menu" onClick={() => setMoreOpen(false)}>
                {more.map((item) => (
                  <span key={item.to}>{link(item.to, item.label, item.to === '/inbox' ? unread : 0)}</span>
                ))}
              </div>
            </details>
          )}
        </nav>
        <div className="userbox">
          <ThemeToggle />
          <div className="who">
            {session.fullName} ({session.userId})
            <br />
            {effective.roleName || effective.role} · {toDisplayLocal(session.lastActivityUtc)}
          </div>
          <button className="btn btn-sec" type="button" onClick={doLogout}>
            Log out
          </button>
        </div>
      </header>
      {canViewAs && (
        <div className="present-bar no-print">
          <span className="present-kicker">Presentation</span>
          <label className="present-as">
            View as
            <select
              value={viewAs}
              onChange={(e) => onViewAs(e.target.value)}
              aria-label="Simulate access level"
            >
              {viewAsOptions().map((o) => (
                <option key={o.roleId} value={o.roleId}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <span className="present-hint">Nav, buttons, and pages follow this access level.</span>
        </div>
      )}
      <div className="workstrip no-print">
        {(caps?.has('submitRequest') || caps?.has('fulfillRequest')) && (
          <NavLink to="/requests" className="workstrip-btn">
            Request material
          </NavLink>
        )}
        {caps?.has('submitMaterial') && (
          <NavLink to="/submit-material" className="workstrip-btn">
            Submit material
          </NavLink>
        )}
        {caps?.has('fulfillRequest') && (
          <NavLink to="/requests?view=open" className="workstrip-btn workstrip-sec">
            Warehouse queue
          </NavLink>
        )}
      </div>
      <ScanBox />
      {flash && (
        <div className={`scan-flash scan-flash-${flash.kind}`} role="status">
          {flash.message}
        </div>
      )}
      <main className="page" key={effective.role}>
        <Outlet />
      </main>
      <footer className="footer no-print">
        {DOC_ID} version {DOC_VERSION} · App {APP_VERSION} · {VALIDATION_BANNER} · Controlled
        document — do not photocopy as the system of record. Session: one tab (sessionStorage); idle
        15 min.
      </footer>
    </div>
  );
}
