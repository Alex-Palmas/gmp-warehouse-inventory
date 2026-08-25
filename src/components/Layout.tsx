import { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { FLASH_EVENT } from '../lib/scanFeedback';
import type { Capability, Session } from '../types';
import { DOC_ID, DOC_VERSION, VALIDATION_BANNER, APP_VERSION } from '../types';
import { ScanBox } from './ScanBox';
import { logout } from '../lib/auth';
import { toDisplayLocal } from '../lib/dates';
import { useCaps } from '../hooks/useCap';
import { unreadInboxCount } from '../lib/inbox';

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

export function Layout({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const nav = useNavigate();
  const caps = useCaps(session);
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
  return (
    <div>
      <div className="banner">
        VALIDATION STATUS: {VALIDATION_BANNER} | {DOC_ID} v{DOC_VERSION}
      </div>
      <header className="header no-print">
        <div className="brand">WH-INV</div>
        <nav className="nav">
          {NAV.filter(show).map((item) => (
            <span key={item.to}>{link(item.to, item.label, item.to === '/inbox' ? unread : 0)}</span>
          ))}
        </nav>
        <div className="userbox">
          <div>
            {session.fullName} ({session.userId})
          </div>
          <div>
            {session.roleName || session.role} · {toDisplayLocal(session.lastActivityUtc)}
          </div>
          <button className="btn btn-sec" type="button" onClick={doLogout}>
            Log out
          </button>
        </div>
      </header>
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
      <main className="page">
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
