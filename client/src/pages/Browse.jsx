import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAsync, useMeta, useDebounced } from '../lib/hooks.js';
import { EmptyState, ErrorState, Field, LoadingBlock, PageHeader, Pagination } from '../components/ui.jsx';
import ReportCard from '../components/ReportCard.jsx';
import { statusLabel } from '../lib/format.js';

const STATUSES = ['open', 'resolved', 'withdrawn', 'reported', 'under_review', 'stored', 'claim_pending', 'returned', 'archived'];
const KEYS = ['q', 'type', 'category_id', 'location_id', 'status', 'date_from', 'date_to', 'sort', 'page'];

export default function Browse() {
  const [params, setParams] = useSearchParams();
  const meta = useMeta();
  const current = Object.fromEntries(KEYS.map((k) => [k, params.get(k) || '']));
  const [text, setText] = useState(current.q);
  const debounced = useDebounced(text);
  useEffect(() => {
    if (debounced !== current.q) update({ q: debounced, page: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced]);

  function update(patch) {
    const next = { ...current, ...patch };
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) sp.set(k, v);
    setParams(sp, { replace: true });
  }

  const query = JSON.stringify(current);
  const { data, loading, error, reload } = useAsync(() => api.get('/api/reports', { ...current, page: current.page || 1 }), [query]);
  const hasFilters = KEYS.some((k) => k !== 'sort' && k !== 'page' && current[k]);
  const sel = (k) => (e) => update({ [k]: e.target.value, page: '' });

  return (
    <div className="stack">
      <PageHeader title="Browse reports" subtitle="Search lost and found items across campus. Private identifying details are never shown here." />
      <form className="card filters" role="search" onSubmit={(e) => e.preventDefault()} aria-label="Search and filter reports">
        <Field label="Keywords">{(p) => <input {...p} type="search" placeholder="e.g. black backpack" value={text} onChange={(e) => setText(e.target.value)} />}</Field>
        <Field label="Type">{(p) => <select {...p} value={current.type} onChange={sel('type')}><option value="">Lost and found</option><option value="lost">Lost</option><option value="found">Found</option></select>}</Field>
        <Field label="Category">{(p) => <select {...p} value={current.category_id} onChange={sel('category_id')}><option value="">All categories</option>{meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label="Location">{(p) => <select {...p} value={current.location_id} onChange={sel('location_id')}><option value="">All locations</option>{meta?.locations.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</Field>
        <Field label="Status">{(p) => <select {...p} value={current.status} onChange={sel('status')}><option value="">Active</option>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select>}</Field>
        <Field label="From date">{(p) => <input {...p} type="date" value={current.date_from} onChange={sel('date_from')} />}</Field>
        <Field label="To date" error={error?.fields?.date_to}>{(p) => <input {...p} type="date" value={current.date_to} onChange={sel('date_to')} />}</Field>
        <Field label="Sort by">{(p) => <select {...p} value={current.sort} onChange={sel('sort')}><option value="">Newest reports</option><option value="oldest">Oldest reports</option><option value="event_newest">Most recent date</option><option value="event_oldest">Earliest date</option><option value="title">Title A-Z</option></select>}</Field>
        {hasFilters && <button type="button" className="btn secondary" onClick={() => { setText(''); setParams({}, { replace: true }); }}>Clear filters</button>}
      </form>
      <div aria-live="polite">
        {loading && !data && <LoadingBlock label="Searching..." />}
        {error && <ErrorState error={error} onRetry={reload} />}
        {data && (
          <>
            <p className="muted small">{data.total} {data.total === 1 ? 'report' : 'reports'} found{loading ? ' (updating...)' : ''}</p>
            {data.items.length === 0 ? (
              <EmptyState title="No reports match your search">{hasFilters ? 'Try removing a filter or using fewer keywords.' : 'No reports have been submitted yet. Be the first to create one.'}</EmptyState>
            ) : (
              <div className="report-list">{data.items.map((r) => <ReportCard key={`${r.type}-${r.id}`} report={r} />)}</div>
            )}
            <Pagination page={data.page} totalPages={data.total_pages} onPage={(p) => update({ page: p > 1 ? String(p) : '' })} />
          </>
        )}
      </div>
    </div>
  );
}
