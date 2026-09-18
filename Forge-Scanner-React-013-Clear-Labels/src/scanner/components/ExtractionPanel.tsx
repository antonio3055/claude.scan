import { money, shortDocLabel } from '../lib/format';
import { potentialApproval, roundDisplayAmount } from '../lib/displayRules';
import { buildSalesPitch } from '../lib/pitch';
import type { ScannerLead } from '../types/scanner';
import { AlertIcon, FileIcon } from './ScannerIcons';

function value(v: unknown) {
  return v == null || v === '' ? '—' : String(v);
}

/** Every distinct value the statements carried, not just the first. */
function listValue(values: string[] | undefined) {
  if (!values?.length) return '—';
  return values.join(' · ');
}

const NO_COMPANY_INFO = {
  legalName: null,
  applicationDba: null,
  applicationAddress: null,
  statementNames: [] as string[],
  statementDbas: [] as string[],
  statementAddresses: [] as string[],
  nameDiffers: false,
  dbaDiffers: false,
  addressDiffers: false
};

export function ExtractionPanel({ lead }: { lead: ScannerLead | null }) {
  if (!lead) {
    return <section className="scanner-panel extraction-panel"><header className="scanner-panel-head"><div><h2>Extraction</h2><span>Lead details</span></div></header><div className="panel-empty"><FileIcon/><b>No lead selected</b><span>Upload documents or choose a lead.</span></div></section>;
  }

  const app = lead.application?.application;
  const info = lead.companyInfo ?? NO_COMPANY_INFO;
  const latest = lead.statements[0] ?? lead.mtdDocs[0];
  const mca = (latest?.mcaPositions as any[]) ?? [];
  const expenses = latest?.expenses as any;
  const pressure = expenses?.largestRecurringExpense ?? expenses?.largestSingleDebit;
  const approval = potentialApproval(lead.revenue);
  const rawDeposits = latest?.deposits?.trueRevenue ?? latest?.deposits?.totalDeposits;
  const rawBalance = latest?.balances?.ending;
  const deposits = rawDeposits == null ? null : roundDisplayAmount(Number(rawDeposits));
  const balance = rawBalance == null ? null : roundDisplayAmount(Number(rawBalance));

  return (
    <section className="scanner-panel extraction-panel">
      <header className="scanner-panel-head">
        <div><h2>{lead.companyName}</h2><span>{lead.ownerName || 'Owner not found'}</span></div>
        <span className={`score-pill ${lead.extractionScore < 70 ? 'warn' : ''}`}>{lead.extractionScore}</span>
      </header>

      <div className="extraction-scroll">
        <div className="financial-strip">
          <div title="Average monthly revenue"><span>Revenue</span><b>{money(roundDisplayAmount(lead.revenue))}</b></div>
          <div title="Latest statement deposits"><span>Deposits</span><b>{money(deposits)}</b></div>
          <div title="Latest ending balance"><span>Balance</span><b>{money(balance)}</b></div>
          <div title="Potential approval"><span>Approval</span><b>{money(approval)}</b></div>
        </div>

        <div className="paired-info">
          <section><h3>Company</h3>
            <dl>
              <div><dt>Legal name</dt><dd>{value(app?.legalName)}</dd></div>
              <div><dt>Trading name (DBA)</dt><dd>{value(app?.dba)}</dd></div>
              <div><dt>EIN</dt><dd>{value(app?.ein)}</dd></div>
              <div><dt>Address</dt><dd>{value(app?.address)}</dd></div>
            </dl>
          </section>
          <section><h3>On the statements</h3>
            <dl>
              <div>
                <dt>Name{info.nameDiffers ? <em className="differs" title="Different from the application"> differs</em> : null}</dt>
                <dd>{listValue(info.statementNames)}</dd>
              </div>
              <div>
                <dt>Trading name (DBA){info.dbaDiffers ? <em className="differs" title="Different from the application"> differs</em> : null}</dt>
                <dd>{listValue(info.statementDbas)}</dd>
              </div>
              <div>
                <dt>Address{info.addressDiffers ? <em className="differs" title="Different from the application"> differs</em> : null}</dt>
                <dd>{listValue(info.statementAddresses)}</dd>
              </div>
            </dl>
          </section>
          <section><h3>Contact</h3>
            <dl>
              <div><dt>Owner</dt><dd>{value(app?.fullName)}</dd></div>
              <div><dt>Date of birth</dt><dd>{value(app?.dob)}</dd></div>
              <div><dt>Mobile</dt><dd>{value(app?.phones?.[0])}</dd></div>
              <div><dt>Mobile 2</dt><dd>{value(app?.phones?.[1])}</dd></div>
              <div><dt>Mobile 3</dt><dd>{value(app?.phones?.[2])}</dd></div>
              <div><dt>Email</dt><dd>{value(app?.emails?.[0])}</dd></div>
            </dl>
          </section>
        </div>

        <section className="detail-section"><h3>Documents</h3>
          <div className="doc-summary-list">{lead.docs.map((doc) => <div key={doc.fileId}><span className="doc-label">{shortDocLabel(doc)}</span><span>{doc.bankAccount?.bank || doc.docType?.replace('_',' ') || 'Document'}</span><b>{doc.processingStatus.replace('_',' ')}</b></div>)}</div>
        </section>

        <section className="detail-section"><h3>Bank statements</h3>
          {lead.statements.length || lead.mtdDocs.length ? <div className="statement-list">{[...lead.statements.slice(0,3), ...lead.mtdDocs.slice(0,1)].map((doc) => (
            <div key={doc.fileId}>
              <span>{shortDocLabel(doc)}</span>
              <span>{doc.bankAccount?.bank || 'Bank not found'}</span>
              <span>{doc.bankAccount?.accountNumberMasked || 'Account not found'}</span>
              <b>{money((doc.deposits?.trueRevenue ?? doc.deposits?.totalDeposits) == null ? null : roundDisplayAmount(Number(doc.deposits?.trueRevenue ?? doc.deposits?.totalDeposits)))}</b>
              <b>{money(doc.balances?.ending == null ? null : roundDisplayAmount(Number(doc.balances.ending)))}</b>
            </div>
          ))}</div> : <p className="muted-copy">No completed bank statement extraction yet.</p>}
        </section>

        <section className="detail-section"><h3>MCA / Cash flow</h3>
          {mca.length ? <div className="mca-list">{mca.map((item, index) => <div key={`${item.funder}-${index}`}><b>{value(item.funder)}</b><span>{money(Number(item.estimatedPaymentAmount))} · {value(item.cadence)}</span><span>{money(Number(item.estimatedMonthlyBurden))}/mo</span></div>)}</div> : <p className="muted-copy">No MCA detected from the scanned pages.</p>}
          {pressure && <div className="pressure-box"><AlertIcon/><div><b>Largest pressure</b><span>{value(pressure.counterparty ?? pressure.description)} · {money(Number(pressure.totalAmount ?? pressure.amount ?? 0))}</span></div></div>}
        </section>

        <section className="detail-section"><h3>Sales pitch</h3><p className="sales-pitch">{buildSalesPitch(lead)}</p></section>

        <section className="detail-section"><h3>Extraction audit</h3>
          <div className="audit-lines">
            <div><span>Extraction score</span><b>{lead.extractionScore}/100</b></div>
            <div><span>Review flags</span><b>{lead.issues.length}</b></div>
            <div><span>Source documents</span><b>{lead.docs.length}</b></div>
            <div><span>OCR documents</span><b>{lead.docs.filter((d) => d.usedOcr).length}</b></div>
          </div>
        </section>
      </div>
    </section>
  );
}
