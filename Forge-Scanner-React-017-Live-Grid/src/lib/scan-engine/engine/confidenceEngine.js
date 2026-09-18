// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   confidenceEngine.js — document + field level confidence.
   Spec ref: section 25.
   Every input here must come from a real signal already computed
   elsewhere (bank recognition, text quality, reconciliation, parse
   review-flags). No score is invented independent of those signals.
   ============================================================ */
(function (root) {
  'use strict';

  /**
   * @param {{
   *   bankRecognized: boolean,
   *   textTrusted: boolean,
   *   usedOcr: boolean,
   *   reconciles: boolean|null,
   *   reviewFlaggedTxnRatio: number,   // 0..1
   * }} signals
   * @returns {{level:'high'|'medium'|'low'|'needs_review'|'failed', reasons:string[]}}
   */
  function scoreDocument(signals) {
    const reasons = [];
    let points = 0;
    const maxPoints = 4;

    if (signals.bankRecognized) points += 1; else reasons.push('bank_not_recognized');
    if (signals.textTrusted) points += 1; else reasons.push('low_text_quality');
    if (!signals.usedOcr) points += 1; else reasons.push('required_ocr_fallback');
    if (signals.reconciles === true) points += 1;
    else if (signals.reconciles === false) reasons.push('reconciliation_mismatch');
    else reasons.push('reconciliation_not_possible');

    if (signals.reviewFlaggedTxnRatio > 0.35) reasons.push('high_unparsed_line_ratio');

    let level;
    if (signals.reconciles === false) level = 'needs_review'; // a hard mismatch always forces review
    else if (points === maxPoints && signals.reviewFlaggedTxnRatio <= 0.1) level = 'high';
    else if (points >= 2) level = 'medium';
    else level = 'low';

    return { level, reasons, points, maxPoints };
  }

  function scoreField(fieldSource) {
    // fieldSource: 'document_text_numeric_range' etc. from the recovery modules.
    if (!fieldSource) return 'missing';
    if (String(fieldSource).startsWith('document_text')) return 'high';
    if (String(fieldSource).startsWith('filename')) return 'low';
    return 'medium';
  }

  const api = { scoreDocument, scoreField };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.confidenceEngine = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
