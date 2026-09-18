export type ScanStatus =
  | 'queued'
  | 'validating'
  | 'extracting'
  | 'ocr'
  | 'complete'
  | 'needs_review'
  | 'failed'
  | 'stopped';

export type ScanMode = 'regular' | 'ocr';

export interface ScanSettings {
  mode: ScanMode;
  regularPages: number;
  ocrPages: number;
  maxFiles: number;
  maxFileBytes: number;
  duplicateHandling: 'flag' | 'skip';
}

export interface StageLogEntry {
  stage: string;
  at: string;
}

export interface ScannerDocument {
  fileId: string;
  filename: string;
  fileSize: number;
  uploadedAt: string;
  processingStatus: ScanStatus;
  processingError?: string;
  processingErrorMessage?: string;
  /** Scan attempts spent on this file. One automatic retry means at most 2. */
  attempts?: number;
  /** Structural problems found in the PDF before PDF.js was asked to open it. */
  pdfStructureWarnings?: string[];
  completedAt?: string;
  stageLog: StageLogEntry[];
  fileHash?: string;
  duplicateOfFileId?: string | null;
  pageCount?: number;
  scannedPageCount?: number;
  usedOcr?: boolean;
  /** OCR ran because the PDF had no text layer, not because OCR mode was on. */
  /** The holder exactly as the statement prints it, name, DBA and address. */
  statementIdentity?: {
    name?: string | null;
    dba?: string | null;
    evidence?: string;
    address?: string | null;
    street?: string | null;
    town?: string | null;
    state?: string | null;
    postcode?: string | null;
  };
  /** The regular scan found no usable text layer: this file needs OCR. */
  needsOcr?: boolean;
  /** Set when the file has been sent for OCR by hand; cleared once it has run. */
  forceOcr?: boolean;
  truncated?: boolean;
  docType?: string;
  companyNameGuess?: string | null;
  isMtd?: boolean;
  statementPeriod?: { start?: string | null; end?: string | null } | null;
  confidence?: { level?: string; reasons?: string[]; points?: number; maxPoints?: number };
  application?: {
    legalName?: string | null;
    dba?: string | null;
    fullName?: string | null;
    address?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    dob?: string | null;
    businessStartDate?: string | null;
    ssn?: string | null;
    ein?: string | null;
    phones?: string[];
    emails?: string[];
    statedRevenue?: number | null;
  };
  bankAccount?: { bank?: string | null; accountNumber?: string | null; accountNumberMasked?: string | null };
  balances?: { opening?: number | null; ending?: number | null; withdrawals?: number | null };
  statementSummary?: { deposits?: number | null; ending?: number | null; beginning?: number | null; withdrawals?: number | null; confidence?: number; evidence?: string };
  deposits?: { trueRevenue?: number | null; totalDeposits?: number | null };
  dailyCashFlow?: unknown;
  expenses?: unknown;
  nsf?: unknown;
  mcaPositions?: Array<Record<string, unknown>>;
  stacking?: unknown;
  reconciliation?: {
    reconciles?: boolean | null;
    difference?: number | null;
    /** Which arithmetic decided it: the bank's printed summary, or the parsed rows. */
    source?: 'statement_balance_equation' | 'transactions';
    reason?: string;
  };
  reviewItems?: Array<Record<string, unknown>>;
  transactions?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ScannerLead {
  id: string;
  companyName: string;
  ownerName?: string | null;
  revenue: number;
  extractionScore: number;
  status: ScanStatus;
  docs: ScannerDocument[];
  application?: ScannerDocument;
  statements: ScannerDocument[];
  mtdDocs: ScannerDocument[];
  issues: string[];
  /**
   * What each source says the business is called and where it is. A company
   * often trades under a name that is not the one on its incorporation, and
   * banks often hold an older address, so both are kept and the differences
   * are marked rather than one overwriting the other.
   */
  companyInfo: {
    /** From the application, where there is one. */
    legalName: string | null;
    applicationDba: string | null;
    applicationAddress: string | null;
    /** From the statements, in the words the bank printed. */
    statementNames: string[];
    statementDbas: string[];
    statementAddresses: string[];
    /** True when the statements say something the application does not. */
    nameDiffers: boolean;
    dbaDiffers: boolean;
    addressDiffers: boolean;
  };
}

export interface Rep {
  id: string;
  name: string;
}

export interface LeadAssignment {
  leadId: string;
  repId: string;
  repName: string;
}
