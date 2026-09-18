import type { ScannerLead, ScannerDocument } from '../types/scanner';
import { money } from '../lib/format';

export function StatsStrip({ documents, leads }: { documents: ScannerDocument[]; leads: ScannerLead[] }) {
  const complete = leads.filter((l) => l.status === 'complete').length;
  const review = leads.filter((l) => l.status === 'needs_review').length;
  const failed = documents.filter((d) => d.processingStatus === 'failed').length;
  const totalRevenue = leads.reduce((sum, lead) => sum + lead.revenue, 0);
  const avgScore = leads.length ? Math.round(leads.reduce((s, l) => s + l.extractionScore, 0) / leads.length) : 0;
  const ready = leads.filter((l) => l.status === 'complete' && l.companyName !== 'Unassociated').length;

  const stats = [
    ['Files', documents.length],
    ['Leads', leads.length],
    ['Complete', complete],
    ['Review', review],
    ['Failed', failed],
    ['Revenue', money(totalRevenue)],
    ['Avg score', leads.length ? `${avgScore}` : '—'],
    ['Ready', ready]
  ];

  return <div className="scanner-stats">{stats.map(([label, value]) => <div className="scanner-stat" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>;
}
