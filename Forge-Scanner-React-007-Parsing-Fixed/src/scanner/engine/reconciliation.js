/* ============================================================
   reconciliation.js — statement arithmetic validation.
   Spec ref: sections 14, 15, 24.
   opening + credits - debits = ending (within a cent tolerance).
   A mismatch must lower confidence and trigger review, never be
   silently ignored.
   ============================================================ */
(function (root) {
  'use strict';

  const TOLERANCE = 0.02; // 2 cents, to allow for rounding in generic parsing.

  /**
   * @param {{opening:number|null, ending:number|null, transactions:Array}} input
   * @returns {{reconciles:boolean|null, expectedEnding:number|null, difference:number|null,
   *            totalCredits:number, totalDebits:number}}
   */
  function reconcile(input) {
    const txns = input.transactions || [];
    let totalCredits = 0;
    let totalDebits = 0;

    for (const t of txns) {
      if (t.amount == null || t.direction === 'needs_review') continue;
      if (t.direction === 'credit') totalCredits += t.amount;
      else if (t.direction === 'debit') totalDebits += t.amount;
    }
    totalCredits = round2(totalCredits);
    totalDebits = round2(totalDebits);

    if (input.opening == null || input.ending == null) {
      return {
        reconciles: null,
        expectedEnding: null,
        difference: null,
        totalCredits,
        totalDebits,
        reason: 'missing_opening_or_ending_balance',
      };
    }

    const expectedEnding = round2(input.opening + totalCredits - totalDebits);
    const difference = round2(expectedEnding - input.ending);
    const reconciles = Math.abs(difference) <= TOLERANCE;

    return { reconciles, expectedEnding, difference, totalCredits, totalDebits, reason: reconciles ? 'ok' : 'mismatch' };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const api = { reconcile, TOLERANCE };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.reconciliation = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
