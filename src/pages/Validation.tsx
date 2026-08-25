import { useState } from 'react';
import type { ESign, Session } from '../types';
import { VALIDATION_BANNER } from '../types';
import { CapDenied, CapChecking } from '../components/CapGuard';
import { ESignModal } from '../components/ESignModal';
import { useCap } from '../hooks/useCap';
import { OQ_EVIDENCE_DISCLAIMER, runSelfValidation, type OqResult, type ValidationReport } from '../lib/selfValidation';
import { downloadValidationReport } from '../lib/validationReport';
import { OQ_DB_NAME } from '../lib/db';

export function ValidationPage({ session }: { session: Session }) {
  const canRun = useCap(session, 'runValidation');
  const [signOpen, setSignOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [stream, setStream] = useState<OqResult[]>([]);
  const [report, setReport] = useState<ValidationReport | null>(null);

  if (canRun === null) return <CapChecking />;
  if (!canRun) return <CapDenied cap="runValidation" />;

  async function run(esign: ESign) {
    setErr('');
    setBusy(true);
    setReport(null);
    setStream([]);
    try {
      const next = await runSelfValidation(
        session,
        (row) => {
          setStream((prev) => [...prev, row]);
        },
        esign,
      );
      setReport(next);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Self-validation failed');
    } finally {
      setBusy(false);
    }
  }

  const rows = report?.results ?? stream;
  const passed = report?.passed ?? rows.filter((r) => r.verdict === 'Pass').length;
  const failed = report?.failed ?? rows.filter((r) => r.verdict === 'Fail').length;
  const manual = report?.manual ?? rows.filter((r) => r.verdict === 'Manual').length;

  return (
    <div>
      <h1>OQ/PQ-style sandbox protocol with screenshot evidence</h1>
      <div className="card legend">
        <strong>{VALIDATION_BANNER}</strong>
        <p>
          {OQ_EVIDENCE_DISCLAIMER} The protocol runs in sandbox IndexedDB <span className="mono">{OQ_DB_NAME}</span>{' '}
          and will not modify the live inventory register. Production lots must not be used. An electronic
          signature is required to execute. Download PDF is the only evidence deliverable — this is not
          approved IQ/OQ/PQ and not a vendor Part 11 certificate.
        </p>
      </div>
      <div className="row oq-actions no-print" style={{ marginBottom: 12 }}>
        <button className="btn" type="button" disabled={busy} onClick={() => setSignOpen(true)}>
          {busy ? 'Running protocol…' : 'Run protocol'}
        </button>
        {report && (
          <>
            <button
              className="btn btn-sec"
              type="button"
              onClick={() => void downloadValidationReport(report)}
            >
              Download PDF
            </button>
            <button className="btn btn-sec" type="button" onClick={() => window.print()}>
              Print
            </button>
          </>
        )}
      </div>
      {err && <p className="err">{err}</p>}
      {busy && !rows.length && <p className="help">Executing sandbox OQ/PQ protocol…</p>}
      {rows.length > 0 && (
        <div className="oq-print">
          <div className="row" style={{ marginBottom: 10 }}>
            <span className="oq-chip oq-chip-Pass">Pass {passed}</span>
            <span className="oq-chip oq-chip-Fail">Fail {failed}</span>
            <span className="oq-chip oq-chip-Manual">Manual {manual}</span>
          </div>
          <div className="card" style={{ overflow: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>URS</th>
                  <th>Title</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Verdict</th>
                  <th>ms</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={`oq-${r.verdict.toLowerCase()}`}>
                    <td className="mono">{r.id}</td>
                    <td className="mono">{r.urs}</td>
                    <td>{r.title}</td>
                    <td>{r.expected}</td>
                    <td>{r.actual}</td>
                    <td>
                      <span className={`oq-chip oq-chip-${r.verdict}`}>{r.verdict}</span>
                    </td>
                    <td className="mono">{r.ms}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {signOpen && (
        <ESignModal
          session={session}
          title="Execute sandbox OQ/PQ protocol"
          meaningDefault={OQ_EVIDENCE_DISCLAIMER}
          requireReason
          onCancel={() => setSignOpen(false)}
          onSigned={(esign) => {
            setSignOpen(false);
            void run(esign);
          }}
        />
      )}
    </div>
  );
}
