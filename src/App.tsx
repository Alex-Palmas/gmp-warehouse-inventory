import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import type { Capability, Session } from './types';
import { loadSession, touchSession, logout } from './lib/auth';
import { ensureSeeded } from './lib/seed';
import { hasCapability } from './lib/permissions';
import { Layout } from './components/Layout';
import { applyViewAs, loadViewAs, saveViewAs } from './lib/viewAs';
import { CapChecking, CapDenied } from './components/CapGuard';
import { Login } from './pages/Login';
import { ChangePassword } from './pages/ChangePassword';
import { Dashboard } from './pages/Dashboard';
import { GoodsReceipt } from './pages/GoodsReceipt';
import { QADisposition } from './pages/QADisposition';
import { LocationTransfer } from './pages/LocationTransfer';
import { IssueDispense } from './pages/IssueDispense';
import { ReturnToStock } from './pages/ReturnToStock';
import { Hold } from './pages/Hold';
import { CycleCount } from './pages/CycleCount';
import { Destruction } from './pages/Destruction';
import { LabelReprint } from './pages/LabelReprint';
import { ScanLookup } from './pages/ScanLookup';
import { MaterialMaster } from './pages/MaterialMaster';
import { AccessControl } from './pages/AccessControl';
import { InventoryRegister } from './pages/InventoryRegister';
import { AuditTrail } from './pages/AuditTrail';
import { RecordDetail } from './pages/RecordDetail';
import { Requests } from './pages/Requests';
import { SubmitMaterial } from './pages/SubmitMaterial';
import { Inbox } from './pages/Inbox';
import { Samples } from './pages/Samples';

function Guard({
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
  return (
    <Layout session={session} effective={effective} viewAs={viewAs} onViewAs={onViewAs} onLogout={onLogout} />
  );
}

function CapRoute({
  session,
  cap,
  children,
}: {
  session: Session;
  cap: Capability;
  children: React.ReactNode;
}) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    void hasCapability(session, cap).then(setOk);
  }, [session, cap]);
  if (ok === null) return <CapChecking />;
  if (!ok) return <CapDenied cap={cap} />;
  return <>{children}</>;
}

function AccessRoute({ session }: { session: Session }) {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    void Promise.all([hasCapability(session, 'adminUsers'), hasCapability(session, 'editPermissionMatrix')]).then(
      ([a, b]) => setOk(a || b),
    );
  }, [session]);
  if (ok === null) return <CapChecking />;
  if (!ok) return <CapDenied cap="adminUsers or editPermissionMatrix" />;
  return <AccessControl session={session} />;
}

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [viewAs, setViewAs] = useState(loadViewAs);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();
  const effective = useMemo(
    () => (session ? applyViewAs(session, viewAs) : null),
    [session, viewAs],
  );

  function changeViewAs(roleId: string) {
    saveViewAs(roleId);
    setViewAs(roleId);
  }

  useEffect(() => {
    ensureSeeded()
      .then(() => {
        setSession(loadSession());
        setReady(true);
      })
      .catch((e) => {
        console.error(e);
        setReady(true);
      });
  }, []);

  useEffect(() => {
    if (!session) return;
    const onAct = () => {
      const cur = loadSession();
      if (!cur) return;
      touchSession(cur);
    };
    window.addEventListener('click', onAct);
    window.addEventListener('keydown', onAct);
    const t = window.setInterval(() => {
      const s = loadSession();
      if (!s) {
        void logout(session).finally(() => {
          setSession(null);
          nav('/login');
        });
      }
    }, 15_000);
    return () => {
      window.removeEventListener('click', onAct);
      window.removeEventListener('keydown', onAct);
      clearInterval(t);
    };
  }, [session, nav]);

  if (!ready) return <div className="page">Loading local database…</div>;
  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login onLogin={setSession} />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  if (session.mustChangePassword) {
    return (
      <Routes>
        <Route path="/change-password" element={<ChangePassword session={session} onChanged={setSession} />} />
        <Route path="*" element={<Navigate to="/change-password" replace />} />
      </Routes>
    );
  }

  if (!effective) return <div className="page">Loading session…</div>;

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/change-password" element={<ChangePassword session={session} onChanged={setSession} />} />
      <Route
        path="/"
        element={
          <Guard
            session={session}
            effective={effective}
            viewAs={viewAs}
            onViewAs={changeViewAs}
            onLogout={() => setSession(null)}
          />
        }
      >
        <Route
          index
          element={
            <CapRoute session={effective} cap="viewDashboard">
              <Dashboard session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="register"
          element={
            <CapRoute session={effective} cap="viewRegister">
              <InventoryRegister />
            </CapRoute>
          }
        />
        <Route path="record/:serial" element={<RecordDetail />} />
        <Route
          path="receive"
          element={
            <CapRoute session={effective} cap="receive">
              <GoodsReceipt session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="qa"
          element={
            <CapRoute session={effective} cap="qaDisposition">
              <QADisposition session={effective} />
            </CapRoute>
          }
        />
        <Route path="requests" element={<Requests session={effective} />} />
        <Route
          path="submit-material"
          element={
            <CapRoute session={effective} cap="submitMaterial">
              <SubmitMaterial session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="inbox"
          element={
            <CapRoute session={effective} cap="viewInbox">
              <Inbox session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="samples"
          element={
            <CapRoute session={effective} cap="samplePull">
              <Samples session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="transfer"
          element={
            <CapRoute session={effective} cap="transfer">
              <LocationTransfer session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="issue"
          element={
            <CapRoute session={effective} cap="issue">
              <IssueDispense session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="return"
          element={
            <CapRoute session={effective} cap="returnToStock">
              <ReturnToStock session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="hold"
          element={
            <CapRoute session={effective} cap="hold">
              <Hold session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="count"
          element={
            <CapRoute session={effective} cap="cycleCount">
              <CycleCount session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="destroy"
          element={
            <CapRoute session={effective} cap="destroy">
              <Destruction session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="reprint"
          element={
            <CapRoute session={effective} cap="reprintLabel">
              <LabelReprint session={effective} />
            </CapRoute>
          }
        />
        <Route
          path="scan"
          element={
            <CapRoute session={effective} cap="scanLookup">
              <ScanLookup />
            </CapRoute>
          }
        />
        <Route
          path="materials"
          element={
            <CapRoute session={effective} cap="adminMaterials">
              <MaterialMaster session={effective} />
            </CapRoute>
          }
        />
        <Route path="access" element={<AccessRoute session={effective} />} />
        <Route path="users" element={<Navigate to="/access" replace />} />
        <Route
          path="audit"
          element={
            <CapRoute session={effective} cap="viewAudit">
              <AuditTrail session={effective} />
            </CapRoute>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
