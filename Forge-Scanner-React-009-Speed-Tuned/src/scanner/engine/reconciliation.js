/* ============================================================
   reconciliation.js — statement arithmetic validation.
   Spec ref: sections 14, 15, 24.
   opening + credits - debits = ending (within a cent tolerance).
   A mismatch must lower confidence and trigger review, never be
   silently ignored.

   Two things can be reconciled, and they are not the same thing:

     the statement — the bank's own printed summary figures, which sit
       on page one and hold whether or not every page was read;
     the transactions — the rows this scanner parsed, which only add up
       when the whole statement was read and every row was understood.

   The statement is the stronger evidence, so a proven balance equation
   decides the result and the transaction total is reported alongside it.
   ============================================================ */
(function (root) {
  'use strict';

  const TOLERANCE = 0.02; // 2 cents, to allow for rounding in generic parsing.

  /**
   * @param {{opening:number|null, ending:number|null, transactions:Array,
   *          equation?:object|null, transactionsComplete?:boolean}} input
   * @returns {{reconciles:boolean|null, expectedEnding:number|null, difference:number|null,
   *            totalCredits:number, totalDebits:number, source:string, reason:string}}
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

    const equation = input.equation || null;
    if (equation && equation.verified) {
      return {
        reconciles: true,
        expectedEnding: equation.ending,
        difference: 0,
        totalCredits,
        totalDebits,
        statementDeposits: equation.deposits,
        statementWithdrawals: equation.withdrawals,
        source: 'statement_balance_equation',
        reason: 'ok',
      };
    }

    // No proven equation: fall back to the rows this scanner parsed, which
    // only means anything when the whole statement was read.
    if (input.transactionsComplete === false) {
      return {
        reconciles: null,
        expectedEnding: null,
        difference: null,
        totalCredits,
        totalDebits,
        source: 'transactions',
        reason: 'statement_truncated',
      };
    }

    if (input.opening == null || input.ending == null) {
      return {
        reconciles: null,
        expectedEnding: null,
        difference: null,
        totalCredits,
        totalDebits,
        source: 'transactions',
        reason: 'missing_opening_or_ending_balance',
      };
    }

    const expectedEnding = round2(input.opening + totalCredits - totalDebits);
    const difference = round2(expectedEnding - input.ending);
    const reconciles = Math.abs(difference) <= TOLERANCE;

    return {
      reconciles,
      expectedEnding,
      difference,
      totalCredits,
      totalDebits,
      source: 'transactions',
      reason: reconciles ? 'ok' : 'mismatch',
    };
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
