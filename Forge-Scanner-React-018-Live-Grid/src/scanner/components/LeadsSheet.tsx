import { useMemo, useState, type ReactNode } from 'react';
import type { ScannerLead } from '../types/scanner';
import { displayList, displayValue, money, shortDocLabel } from '../lib/format';
import { potentialApproval, roundDisplayAmount } from '../lib/displayRules';
import { useResizableColumns } from '../hooks/useResizableColumns';
import { useColumnOrder } from '../hooks/useColumnOrder';

interface Props {
  leads: ScannerLead[];
  onExport: () => void;
}

const NUM_WIDTH = 42;

const DEFAULT_WIDTHS: Record<string, number> = {
  company: 220,
  owner: 140,
  revenue: 110,
  approval: 110,
  phone: 150,
  email: 200,
  address: 220,
  appDate: 100,
  statements: 260,
  bank: 150,
  bsd: 100,
  mca: 200,
  score: 110
};

const COLUMN_LABELS: Record<string, string> = {
  company: 'Company',
  owner: 'Owner',
  revenue: 'Revenue',
  approval: 'Approval',
  phone: 'Phone',
  email: 'Email',
  address: 'Address',
  appDate: 'App date',
  statements: 'Statements',
  bank: 'Bank',
  bsd: 'BSD',
  mca: 'MCA',
  score: 'Score'
};

const DEFAULT_ORDER = ['company', 'owner', 'revenue', 'approval', 'phone', 'email', 'address', 'appDate', 'statements', 'bank', 'bsd', 'mca', 'score'];
const NUMERIC_COLUMNS = new Set(['revenue', 'approval']);

function Diff({ value, title }: { value: string; title: string }) {
  if (!value) return null;
  return <span className="differs-badge" title={title}>⚠ <span className="differs-value">{value}</span></span>;
}

/** One bullet per statement: month label, unrounded deposits, unrounded ending balance. */
function statementText(lead: ScannerLead) {
  const rows = lead.statements
    .filter((d) => d.processingStatus === 'complete' || d.processingStatus === 'needs_review')
    .slice(0, 6);
  if (!rows.length) return displayValue(null, lead.application ?? lead.docs[0]);
  return rows
    .map((doc) => {
      const deposits = doc.deposits?.trueRevenue ?? doc.deposits?.totalDeposits;
      const ending = doc.balances?.ending;
      return `${shortDocLabel(doc)} ${displayValue(deposits == null ? null : money(deposits), doc)} • ${displayValue(ending == null ? null : money(ending), doc)}`;
    })
    .join(' · ');
}

function bankText(lead: ScannerLead) {
  const banks = [...new Set(lead.statements.map((d) => d.bankAccount?.bank).filter(Boolean))] as string[];
  return displayList(banks, lead.statements).join(' • ');
}

function mcaText(lead: ScannerLead) {
  const positions = lead.statements.flatMap((d) => (d.mcaPositions as any[]) ?? []);
  const byFunder = new Map<string, number>();
  for (const p of positions) {
    const name = String(p.funder || 'Unknown lender');
    byFunder.set(name, (byFunder.get(name) ?? 0) + (Number(p.estimatedMonthlyBurden) || 0));
  }
  const entries = [...byFunder.entries()];
  if (!entries.length) return displayValue(null, lead.statements.length ? lead.statements : lead.application);
  return entries.map(([name, total]) => `${name} ${money(total)}/mo`).join(' · ');
}

/** Any statement that failed to reconcile against the bank's own printed summary, next to the completeness score. */
function reconciliationBadge(lead: ScannerLead) {
  const checked = lead.statements.filter((d) => d.reconciliation?.reconciles != null);
  if (!checked.length) return null;
  const failing = checked.filter((d) => d.reconciliation?.reconciles === false).length;
  if (failing > 0) return <span className="recon-badge bad" title={`${failing} of ${checked.length} statement(s) do not reconcile against the bank's own printed summary`}>⚠ {checked.length - failing}/{checked.length}</span>;
  return <span className="recon-badge good" title="Every statement reconciles against the bank's own printed summary">✓ {checked.length}/{checked.length}</span>;
}

export function LeadsSheet({ leads, onExport }: Props) {
  const [sortMode, setSortMode] = useState<'revenue' | 'company'>('revenue');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showColumns, setShowColumns] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const cols = useResizableColumns(DEFAULT_WIDTHS);
  const reorder = useColumnOrder(DEFAULT_ORDER);

  const visible = useMemo(() => {
    let rows = leads.filter((lead) => lead.companyName !== 'Unassociated');
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      rows = rows.filter((lead) => lead.companyName.toLowerCase().includes(q) || (lead.ownerName ?? '').toLowerCase().includes(q));
    }
    if (statusFilter !== 'all') rows = rows.filter((lead) => lead.status === statusFilter);
    rows = [...rows];
    if (sortMode === 'revenue') rows.sort((a, b) => b.revenue - a.revenue);
    else rows.sort((a, b) => a.companyName.localeCompare(b.companyName));
    return rows;
  }, [leads, query, statusFilter, sortMode]);

  const activeColumns = reorder.order.filter((key) => !hidden.has(key));
  // Every column track gets its own fixed pixel size, so widening one only
  // pushes the ones after it along the row -- it never changes what any
  // other column's own width is.
  const gridTemplateColumns = [`${NUM_WIDTH}px`, ...activeColumns.map((key) => `${cols.widths[key] ?? 140}px`)].join(' ');

  return (
    <section className="leads-sheet">
      <header className="leads-sheet-head">
        <div><h2>Results</h2><span>{visible.length} of {leads.length} companies · fills in live as scans finish</span></div>
        <div className="leads-sheet-toolbar">
          <input className="sheet-filter-input" type="search" placeholder="Filter by company or owner" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="all">All statuses</option>
            <option value="complete">Complete</option>
            <option value="needs_review">Needs review</option>
            <option value="failed">Failed</option>
            <option value="queued">Queued</option>
          </select>
          <button type="button" onClick={() => setSortMode((m) => (m === 'revenue' ? 'company' : 'revenue'))} title="Toggle sort order">
            Sort: {sortMode === 'revenue' ? 'Revenue ↓' : 'Company A–Z'}
          </button>
          <button type="button" onClick={() => setShowColumns((v) => !v)}>Columns</button>
          <button type="button" className="primary-btn" onClick={onExport}>Export XLSX</button>
        </div>
      </header>

      {showColumns && (
        <div className="columns-popover">
          {DEFAULT_ORDER.map((key) => (
            <label key={key}>
              <input type="checkbox" checked={!hidden.has(key)} onChange={(e) => setHidden((prev) => {
                const next = new Set(prev);
                if (e.target.checked) next.delete(key); else next.add(key);
                return next;
              })} />
              {COLUMN_LABELS[key]}
            </label>
          ))}
        </div>
      )}

      <div className="sheet-scroll" onPointerMove={cols.onPointerMove} onPointerUp={cols.onPointerUp}>
        <div className="sheet-row sheet-head-row" style={{ gridTemplateColumns }}>
          <div className="sheet-cell sheet-num-cell">#</div>
          {activeColumns.map((key) => (
            <div
              className={`sheet-cell sheet-th ${reorder.draggingKey === key ? 'dragging' : ''}`}
              key={key}
              draggable
              onDragStart={reorder.onDragStart(key)}
              onDragOver={reorder.onDragOver(key)}
              onDragEnd={reorder.onDragEnd}
              title="Drag to reorder"
            >
              {COLUMN_LABELS[key]}
              <span className="col-resize-handle" draggable={false} onPointerDown={cols.startResize(key)} />
            </div>
          ))}
        </div>

        {visible.length === 0 && <div className="sheet-empty">No leads yet. Upload documents and press Start.</div>}

        {visible.map((lead, index) => {
          const app = lead.application?.application;
          const info = lead.companyInfo;
          const altNames = [...new Set([...info.statementNames, ...info.statementDbas])].filter(Boolean);
          const statements = statementText(lead);
          const bank = bankText(lead);
          const mca = mcaText(lead);
          const cells: Record<string, ReactNode> = {
            company: (
              <>
                <strong>{lead.companyName}</strong>
                {(info.nameDiffers || info.dbaDiffers) && <Diff value={altNames.join(', ')} title="The bank statements print a different name/DBA than the application" />}
                {lead.duplicateCount > 0 && <span className="dup-badge" title={`${lead.duplicateCount} duplicate file(s) excluded from these numbers`}>⧉ {lead.duplicateCount}</span>}
              </>
            ),
            owner: displayValue(app?.fullName, lead.application),
            revenue: money(roundDisplayAmount(lead.revenue)),
            approval: money(potentialApproval(lead.revenue)),
            phone: displayList(app?.phones, lead.application).join(' • '),
            email: displayList(app?.emails, lead.application).join(' • '),
            address: (
              <>
                {displayValue(info.applicationAddress ?? info.statementAddresses[0], [lead.application, ...lead.statements])}
                {info.addressDiffers && <Diff value={info.statementAddresses.join(', ')} title="The bank statements print a different address than the application" />}
              </>
            ),
            appDate: displayValue(app?.appDate, lead.application),
            statements,
            bank,
            bsd: displayValue(app?.businessStartDate, lead.application),
            mca,
            score: <span className="score-cell"><span className={`score-pill ${lead.extractionScore < 70 ? 'warn' : ''}`} title={lead.extractionScore < 70 ? 'Below 70: some expected fields were not found -- worth a manual look' : 'Extraction completeness score out of 100'}>{lead.extractionScore}</span>{reconciliationBadge(lead)}</span>
          };
          const titles: Record<string, string | undefined> = {
            phone: cells.phone as string,
            email: cells.email as string,
            statements,
            bank,
            mca,
            address: [info.applicationAddress ?? info.statementAddresses[0], ...(info.addressDiffers ? [`(statements: ${info.statementAddresses.join(', ')})`] : [])].filter(Boolean).join(' ')
          };
          return (
            <div className={`sheet-row row-status-${lead.status}`} style={{ gridTemplateColumns }} key={lead.id}>
              <div className="sheet-cell sheet-num-cell">{index + 1}</div>
              {activeColumns.map((key) => (
                <div className={`sheet-cell${NUMERIC_COLUMNS.has(key) ? ' num' : ''}`} key={key} title={titles[key]}>{cells[key]}</div>
              ))}
            </div>
          );
        })}
      </div>
    </section>
  );
}
