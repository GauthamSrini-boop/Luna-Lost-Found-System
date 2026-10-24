import { Link } from 'react-router-dom';
import { Badge } from './ui.jsx';
import { formatDate } from '../lib/format.js';

export default function ReportCard({ report }) {
  const r = report;
  return (
    <Link to={`/reports/${r.type}/${r.id}`} className="card report-card" aria-label={`${r.type} report: ${r.title}`}>
      {r.photo_url ? <img className="thumb" src={r.photo_url} alt="" loading="lazy" /> : <div className="thumb" aria-hidden="true">No photo</div>}
      <div className="row spread"><span className={`type-tag ${r.type}`}>{r.type}</span><Badge status={r.status} /></div>
      <h3>{r.title}</h3>
      <p className="muted small" style={{ margin: 0 }}>{r.description}</p>
      <div className="meta"><span>{r.category}</span><span>{r.location}</span><span>{r.type === 'lost' ? 'Last seen' : 'Found'} {formatDate(r.event_date)}</span></div>
      {r.is_mine && <span className="small" style={{ color: 'var(--teal)' }}>Your report</span>}
    </Link>
  );
}
