// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   nsfDetector.js — NSF / overdraft / returned-item detection.
   Spec ref: section 15.
   Never counts the same returned event twice (dedupes by date+amount).
   ============================================================ */
(function (root) {
  'use strict';

  const NSF_RE = /\bnsf\b|non.?sufficient funds|insufficient funds/i;
  const OVERDRAFT_RE = /overdraft|\bod fee\b|\bodp\b/i;
  const RETURNED_RE = /returned item|return.?ach|unauthorized return|check return|bounced/i;

  function detectNsfOverdraft(transactions) {
    const events = [];
    const seen = new Set();

    for (const t of transactions) {
      const desc = t.description || '';
      let kind = null;
      if (NSF_RE.test(desc)) kind = 'nsf';
      else if (OVERDRAFT_RE.test(desc)) kind = 'overdraft';
      else if (RETURNED_RE.test(desc)) kind = 'returned';
      if (!kind) continue;

      const key = `${kind}|${t.date}|${t.amount}`;
      if (seen.has(key)) continue;
      seen.add(key);

      events.push({ kind, date: t.date, amount: t.amount || 0, txnId: t.id, evidence: desc });
    }

    const byKind = (k) => events.filter((e) => e.kind === k);
    const sumAmt = (arr) => round2(arr.reduce((s, e) => s + (e.amount || 0), 0));

    // Negative-day detection needs a running balance series — computed here if present.
    const negativeDays = transactions
      .filter((t) => t.runningBalance != null && t.runningBalance < 0)
      .map((t) => t.date);

    return {
      nsfCount: byKind('nsf').length,
      nsfFees: sumAmt(byKind('nsf')),
      overdraftCount: byKind('overdraft').length,
      overdraftFees: sumAmt(byKind('overdraft')),
      returnedCount: byKind('returned').length,
      negativeDayCount: new Set(negativeDays).size,
      negativeDays: Array.from(new Set(negativeDays)),
      events,
    };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const api = { detectNsfOverdraft };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.nsfDetector = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
