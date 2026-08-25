import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Capability, Session } from '../types';
import { DOC_ID, DOC_VERSION, VALIDATION_BANNER, APP_VERSION } from '../types';
import { ScanBox } from './ScanBox';
import { logout } from '../lib/auth';
import { toDisplayLocal } from '../lib/dates';
import { useCaps } from '../hooks/useCap';

const NAV: { to: string; label: string; cap: Capability }[] = [
  { to: '/', label: 'Dashboard', cap: 'viewDashboard' },
  { to: '/register', label: 'Register', cap: 'viewRegister' },
  { to: '/receive', label: 'Receipt', cap: 'receive' },
  { to: '/qa', label: 'QA Disp.', cap: 'qaDisposition' },
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
  async function doLogout() {
    await logout(session);
    onLogout();
    nav('/login');
  }
  const link = (to: string, label: string) => (
    <NavLink to={to} className={({ isActive }) => (isActive ? 'active' : '')} end={to === '/'}>
      {label}
    </NavLink>
  );
  const show = (item: (typeof NAV)[number]) => {
    if (!caps) return false;
    if (item.to === '/access') return caps.has('adminUsers') || caps.has('editPermissionMatrix');
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
            <span key={item.to}>{link(item.to, item.label)}</span>
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
      <ScanBox />
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
