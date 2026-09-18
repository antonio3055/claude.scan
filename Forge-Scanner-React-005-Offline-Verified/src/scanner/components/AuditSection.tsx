import { auditSummary } from '../lib/leads';
import type { ScannerLead } from '../types/scanner';

export function AuditSection({ leads }: { leads: ScannerLead[] }) {
  const audit = auditSummary(leads);
  const total = Object.values(audit).reduce((a, b) => a + b, 0);
  return (
    <details className="audit-section">
      <summary><span>Audit</span><b>{total}</b></summary>
      <div className="audit-grid">
        <div><span>Needs review</span><b>{audit.needsReview}</b></div>
        <div><span>Low score</span><b>{audit.lowScore}</b></div>
        <div><span>Missing company</span><b>{audit.missingCompany}</b></div>
        <div><span>Duplicates</span><b>{audit.duplicateIssues}</b></div>
        <div><span>Failed</span><b>{audit.failed}</b></div>
      </div>
    </details>
  );
}
