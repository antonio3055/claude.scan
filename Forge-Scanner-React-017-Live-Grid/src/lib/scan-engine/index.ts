/**
 * Ported verbatim from Forge-Scanner-React-016-Full-Document/src/scanner/engine.
 * Each module below is a plain-JS IIFE that attaches itself to
 * globalThis.ScannerEngine -- side-importing them once here makes the whole
 * verified extraction/reconciliation engine available through
 * getScannerEngine(), unchanged from the source build this was ported from.
 */
import './engine/coreUtils.js';
import './engine/textQuality.js';
import './engine/bankRecognizer.js';
import './engine/holderAddress.js';
import './engine/companyName.js';
import './engine/balanceEquation.js';
import './engine/summaryExtractor.js';
import './engine/accountNumber.js';
import './engine/statementDate.js';
import './engine/transactionParser.js';
import './engine/reconciliation.js';
import './engine/depositAnalysis.js';
import './engine/expenseAnalysis.js';
import './engine/nsfDetector.js';
import './engine/mcaDetector.js';
import './engine/cashFlow.js';
import './engine/confidenceEngine.js';
import './engine/applicationExtractor.js';
import './engine/companyAggregator.js';
import './engine/reviewWorkflow.js';
import './engine/pipeline.js';

type EngineApi = {
  pipeline: {
    processDocument(input: Record<string, unknown>): Record<string, unknown>;
  };
  balanceEquation: {
    hasPrintedAmounts(text: string): boolean;
  };
  textQuality: {
    classifyDocument(text: string): string;
  };
};

declare global {
  // eslint-disable-next-line no-var
  var ScannerEngine: EngineApi | undefined;
}

export function getScannerEngine(): EngineApi {
  const engine = globalThis.ScannerEngine;
  if (!engine) throw new Error('Scanner extraction engine did not initialize.');
  return engine;
}
