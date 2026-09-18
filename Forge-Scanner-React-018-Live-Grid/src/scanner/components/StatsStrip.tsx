import type { ScannerLead, ScannerDocument } from '../types/scanner';
import { money } from '../lib/format';

const DONE_STATUSES = new Set(['complete', 'needs_review', 'failed', 'stopped']);

export function StatsStrip({ documents, leads, elapsed }: { documents: ScannerDocument[]; leads: ScannerLead[]; elapsed: string }) {
  const complete = leads.filter((l) => l.status === 'complete').length;
  const review = leads.filter((l) => l.status === 'needs_review').length;
  const failed = documents.filter((d) => d.processingStatus === 'failed').length;
  const totalRevenue = leads.reduce((sum, lead) => sum + lead.revenue, 0);
  const avgScore = leads.length ? Math.round(leads.reduce((s, l) => s + l.extractionScore, 0) / leads.length) : 0;
  const ready = leads.filter((l) => l.status === 'complete' && l.companyName !== 'Unassociated').length;
  const done = documents.filter((d) => DONE_STATUSES.has(d.processingStatus)).length;
  const progressPct = documents.length ? Math.round((done / documents.length) * 100) : 0;

  const stats = [
    ['Files', documents.length],
    ['Leads', leads.length],
    ['Complete', complete],
    ['Review', review],
    ['Failed', failed],
    ['Revenue', money(totalRevenue)],
    ['Avg score', leads.length ? `${avgScore}` : '—'],
    ['Ready', ready],
    ['Time', elapsed]
  ];

  return (
    <div className="scanner-stats-wrap">
      <div className="scanner-stats">{stats.map(([label, value]) => <div className="scanner-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {documents.length > 0 && (
        <div className="scanner-progress" title={`${done} / ${documents.length} settled`}>
          <div className="scanner-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      )}
    </div>
  );
}
