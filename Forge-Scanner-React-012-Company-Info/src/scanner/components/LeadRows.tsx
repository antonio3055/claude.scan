import { extractionScore, money, shortDocLabel } from '../lib/format';
import type { ScannerLead } from '../types/scanner';

export function LeadRows({ leads, selectedId, onSelect }: { leads: ScannerLead[]; selectedId: string | null; onSelect: (id: string) => void }) {
  if (!leads.length) return <div className="empty-copy">No extracted leads yet.</div>;

  return <div className="lead-rows">{leads.map((lead, index) => (
    <button className={`scanner-lead-row ${selectedId === lead.id ? 'selected' : ''}`} key={lead.id} onClick={() => onSelect(lead.id)}>
      <span className={`extract-score ${lead.extractionScore < 70 ? 'warn' : ''}`}>{lead.extractionScore || '—'}</span>
      <span className="lead-number">{index + 1}</span>
      <span className="lead-main">
        <strong>{lead.companyName}</strong>
        <small>{lead.ownerName || 'Owner not found'}</small>
        <span className="doc-chips">{lead.docs.slice(0, 6).map((doc) => <i key={doc.fileId} title={doc.processingStatus}>{shortDocLabel(doc)}</i>)}</span>
      </span>
      <span className="lead-right">
        <strong>{money(lead.revenue)}</strong>
        <small className={`status-${lead.status}`}>{lead.status.replace('_', ' ')}</small>
      </span>
    </button>
  ))}</div>;
}
