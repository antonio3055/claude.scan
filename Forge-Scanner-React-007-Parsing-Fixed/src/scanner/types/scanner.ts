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
  ocrFallback?: boolean;
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
  reconciliation?: { reconciles?: boolean | null; difference?: number | null };
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
