import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAsync } from '../lib/hooks.js';
import { EmptyState, ErrorState, LoadingBlock, PageHeader, Pagination } from '../components/ui.jsx';
import { errorMessage, timeAgo } from '../lib/format.js';

export default function Notifications() {
  const { refresh } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/notifications', { page }), [page]);
  async function markRead(id) { try { await api.post(`/api/notifications/${id}/read`); await refresh(); reload(); } catch (e) { toast.error(errorMessage(e)); } }
  async function markAll() { try { await api.post('/api/notifications/read-all'); await refresh(); toast.success('All notifications marked as read'); reload(); } catch (e) { toast.error(errorMessage(e)); } }
  return (
    <div className="stack">
      <PageHeader title="Notifications" subtitle={data ? `${data.unread} unread` : ''} actions={data?.unread > 0 && <button type="button" className="btn secondary" onClick={markAll}>Mark all as read</button>} />
      {loading && !data && <LoadingBlock label="Loading notifications..." />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {data && data.items.length === 0 && <EmptyState title="You are all caught up">Updates about your reports, matches and claims will appear here.</EmptyState>}
      {data?.items.map((n) => (
        <div key={n.id} className="card pad-sm row spread" style={n.is_read ? { opacity: 0.75 } : { borderColor: 'var(--violet-soft)' }}>
          <div>
            <p style={{ margin: 0 }}>{!n.is_read && <span className="visually-hidden">Unread: </span>}{n.message}</p>
            <span className="muted small">{timeAgo(n.created_at)}</span>
          </div>
          <div className="row">
            {n.link && <Link className="btn secondary sm" to={n.link} onClick={() => !n.is_read && markRead(n.id)}>Open</Link>}
            {!n.is_read && <button type="button" className="btn ghost sm" onClick={() => markRead(n.id)}>Mark read</button>}
          </div>
        </div>
      ))}
      {data && <Pagination page={data.page} totalPages={data.total_pages} onPage={setPage} />}
    </div>
  );
}
