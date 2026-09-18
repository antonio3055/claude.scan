// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   depositAnalysis.js — deposit metrics + true-revenue logic.
   Spec ref: sections 7, 8.
   True revenue = gross qualifying credits minus internal transfers,
   reversals/returns, and financing/advance proceeds — every exclusion
   is kept and shown, never silently subtracted.
   ============================================================ */
(function (root) {
  'use strict';

  const TRANSFER_PATTERNS = /\btransfer\b|\bxfer\b|online transfer|internal transfer|between accounts/i;
  const REVERSAL_PATTERNS = /reversal|returned deposit|return item|chargeback|redeposit/i;
  // Financing/advance proceeds: an MCA/lender name landing as a *credit* is proceeds, not revenue.
  // The actual lender-name match happens in mcaDetector; this module just flags the shape.
  const FINANCING_PROCEEDS_HINT = /advance|funding|capital deposit|loan proceeds/i;

  /**
   * @param {Array} transactions
   * @param {{mcaAliasNames?: string[]}} opts
   * @returns {object}
   */
  function analyzeDeposits(transactions, opts) {
    opts = opts || {};
    const mcaNames = opts.mcaAliasNames || [];
    const credits = transactions.filter((t) => t.direction === 'credit' && t.amount != null);

    const excludedTransfers = [];
    const excludedReversals = [];
    const excludedFinancingProceeds = [];
    const trueRevenueTxns = [];

    for (const t of credits) {
      const desc = t.description || '';
      if (TRANSFER_PATTERNS.test(desc)) {
        excludedTransfers.push(t);
        continue;
      }
      if (REVERSAL_PATTERNS.test(desc)) {
        excludedReversals.push(t);
        continue;
      }
      const mcaHit = mcaNames.find((n) => desc.toLowerCase().includes(n.toLowerCase()));
      if (mcaHit && FINANCING_PROCEEDS_HINT.test(desc)) {
        excludedFinancingProceeds.push(t);
        continue;
      }
      trueRevenueTxns.push(t);
    }

    const sum = (arr) => round2(arr.reduce((s, t) => s + t.amount, 0));

    const grossDeposits = sum(credits);
    const trueRevenue = sum(trueRevenueTxns);

    return {
      grossDeposits,
      trueRevenue,
      depositCount: credits.length,
      averageDeposit: credits.length ? round2(grossDeposits / credits.length) : 0,
      largestDeposit: credits.length ? Math.max(...credits.map((t) => t.amount)) : 0,
      smallestDeposit: credits.length ? Math.min(...credits.map((t) => t.amount)) : 0,
      excluded: {
        transfers: { count: excludedTransfers.length, amount: sum(excludedTransfers), txnIds: excludedTransfers.map((t) => t.id) },
        reversalsReturns: { count: excludedReversals.length, amount: sum(excludedReversals), txnIds: excludedReversals.map((t) => t.id) },
        financingProceeds: { count: excludedFinancingProceeds.length, amount: sum(excludedFinancingProceeds), txnIds: excludedFinancingProceeds.map((t) => t.id) },
      },
      amountRemovedFromGross: round2(grossDeposits - trueRevenue),
      trueRevenueTxnIds: trueRevenueTxns.map((t) => t.id),
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const api = { analyzeDeposits };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.depositAnalysis = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
