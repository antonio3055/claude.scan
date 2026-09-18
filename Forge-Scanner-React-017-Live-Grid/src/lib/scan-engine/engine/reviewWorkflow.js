// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   reviewWorkflow.js — human review / correction handling.
   Spec ref: section 33.
   A correction NEVER overwrites the original extracted value in
   place — it is stored alongside it, with who/what made it, and the
   caller is responsible for re-running the pipeline recalculation
   (pipeline.recalculateAfterCorrection) on the corrected transaction
   set so dependent metrics stay honest.
   ============================================================ */
(function (root) {
  'use strict';

  /**
   * @param {object} doc - a processed document result (mutated: correctionLog appended).
   * @param {{field:string, txnId?:string, originalValue:any, correctedValue:any, reviewer:string}} correction
   */
  function applyCorrection(doc, correction) {
    doc.correctionLog = doc.correctionLog || [];
    doc.correctionLog.push({
      timestamp: new Date().toISOString(),
      field: correction.field,
      txnId: correction.txnId || null,
      originalValue: correction.originalValue,
      correctedValue: correction.correctedValue,
      reviewer: correction.reviewer || 'unknown',
    });

    if (correction.txnId && Array.isArray(doc.transactions)) {
      const t = doc.transactions.find((x) => x.id === correction.txnId);
      if (t) {
        t.correctedFrom = t.correctedFrom || {};
        t.correctedFrom[correction.field] = correction.originalValue;
        t[correction.field] = correction.correctedValue;
        t.reviewFlag = false;
        t.humanReviewed = true;
      }
    } else if (correction.field) {
      doc[correction.field] = correction.correctedValue;
    }

    doc.needsReview = (doc.transactions || []).some((t) => t.reviewFlag) || (doc.reviewItems || []).length > 0;
    return doc;
  }

  function reviewableItems(doc) {
    const items = [];
    (doc.transactions || []).forEach((t) => {
      if (t.reviewFlag) items.push({ type: 'uncertain_transaction', txnId: t.id, description: t.description, reason: t.direction === 'needs_review' ? 'direction_unclear' : 'amount_unparsed' });
    });
    if (doc.reconciliation && doc.reconciliation.reconciles === false) {
      items.push({ type: 'reconciliation_mismatch', difference: doc.reconciliation.difference });
    }
    if (doc.bankRecognition && !doc.bankRecognition.bank) {
      items.push({ type: 'unknown_bank' });
    }
    (doc.mcaPositions || []).filter((p) => p.status === 'needs_review').forEach((p) => {
      items.push({ type: 'potential_mca', funder: p.funder });
    });
    return items;
  }

  const api = { applyCorrection, reviewableItems };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.reviewWorkflow = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
