import './coreUtils.js';
import './textQuality.js';
import './bankRecognizer.js';
import './holderAddress.js';
import './companyName.js';
import './balanceEquation.js';
import './summaryExtractor.js';
import './accountNumber.js';
import './statementDate.js';
import './transactionParser.js';
import './reconciliation.js';
import './depositAnalysis.js';
import './expenseAnalysis.js';
import './nsfDetector.js';
import './mcaDetector.js';
import './cashFlow.js';
import './confidenceEngine.js';
import './applicationExtractor.js';
import './companyAggregator.js';
import './reviewWorkflow.js';
import './pipeline.js';

type EngineApi = {
  coreUtils: Record<string, unknown>;
  summaryExtractor: Record<string, unknown>;
  balanceEquation: {
    solveBalanceEquation(text: string): Record<string, unknown> | null;
    hasPrintedAmounts(text: string): boolean;
  };
  textQuality: {
    assessTextQuality(text: string): { trusted: boolean; reason: string; charCount: number; signalsFound: string[] };
    classifyDocument(text: string): string;
  };
  pipeline: {
    processDocument(input: Record<string, unknown>): Record<string, unknown>;
    recalculateAfterCorrection(doc: Record<string, unknown>): Record<string, unknown>;
  };
  companyAggregator: {
    aggregateByCompany(docs: Array<Record<string, unknown>>): Array<Record<string, unknown>>;
  };
  holderAddress: {
    extractHolderAddress(
      text: string,
      options?: { name?: string | null }
    ): { street: string | null; town: string | null; state: string | null; postcode: string | null; full: string | null };
    sameAddress(a: string | null | undefined, b: string | null | undefined): boolean;
  };
  companyName: {
    extractCompanyName(text: string, options?: { bank?: string | null }): {
      legalName: string | null;
      dba: string | null;
      evidence: string;
    };
    companyKey(name: string | null | undefined): string;
    stripNoisePrefix(name: string): string;
  };
};

declare global {
  // The extraction files intentionally expose one shared engine object.
  // This preserves the verified scanner logic without duplicating implementations.
  // eslint-disable-next-line no-var
  var ScannerEngine: EngineApi | undefined;
}

export function getScannerEngine(): EngineApi {
  const engine = globalThis.ScannerEngine;
  if (!engine) throw new Error('Scanner extraction engine did not initialize.');
  return engine;
}
