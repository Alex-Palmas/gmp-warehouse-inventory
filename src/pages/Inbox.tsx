import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { InboxMessage, Session } from '../types';
import { useCap } from '../hooks/useCap';
import { CapChecking, CapDenied } from '../components/CapGuard';
import { listInbox, markAllInboxRead, markInboxRead } from '../lib/inbox';
import { toDisplayLocal } from '../lib/dates';

export function Inbox({ session }: { session: Session }) {
  const allowed = useCap(session, 'viewInbox');
  const [rows, setRows] = useState<InboxMessage[]>([]);
  useEffect(() => {
    void listInbox(session.userId).then(setRows);
  }, [session.userId]);
  if (allowed === null) return <CapChecking />;
  if (!allowed) return <CapDenied cap="viewInbox" />;

  function href(m: InboxMessage): string {
    if (m.kind === 'request_submitted') return '/requests?view=approve';
    if (m.kind === 'request_issued' || m.kind === 'request_ready' || m.kind === 'insufficient_stock' || m.kind.startsWith('request'))
      return '/requests';
    if (m.kind.startsWith('material')) return '/submit-material';
    return '/';
  }

  return (
    <div>
      <h1>Inbox</h1>
      <p className="help">Local notifications stored in IndexedDB (request submitted/issued, material approved/rejected, insufficient stock).</p>
      <button
        className="btn btn-sec"
        type="button"
        onClick={() =>
          void markAllInboxRead(session.userId).then(() =>
            setRows((rs) => rs.map((r) => ({ ...r, read: true }))),
          )
        }
      >
        Mark all read
      </button>
      <table style={{ marginTop: 8 }}>
        <thead>
          <tr>
            <th></th>
            <th>When</th>
            <th>Title</th>
            <th>Body</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id} className={m.read ? '' : 'highlight'}>
              <td>{m.read ? '' : '●'}</td>
              <td>{toDisplayLocal(m.createdOnUtc)}</td>
              <td>{m.title}</td>
              <td>{m.body}</td>
              <td>
                <Link
                  to={href(m)}
                  onClick={() => {
                    void markInboxRead(m.id, session.userId);
                    setRows((rs) => rs.map((x) => (x.id === m.id ? { ...x, read: true } : x)));
                  }}
                >
                  Open
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
