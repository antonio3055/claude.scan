// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   cashFlow.js — daily cash flow, average daily balance, trends.
   Spec ref: sections 16, 17, 19.
   Trend is only ever computed from real per-month figures actually
   passed in — never fabricated from a single data point.
   ============================================================ */
(function (root) {
  'use strict';

  function analyzeDailyCashFlow(transactions) {
    const credits = transactions.filter((t) => t.direction === 'credit' && t.amount != null);
    const debits = transactions.filter((t) => t.direction === 'debit' && t.amount != null);

    const days = new Set(transactions.map((t) => t.date).filter(Boolean));
    const dayCount = Math.max(1, days.size);

    const totalIn = round2(credits.reduce((s, t) => s + t.amount, 0));
    const totalOut = round2(debits.reduce((s, t) => s + t.amount, 0));

    return {
      averageDailyInflow: round2(totalIn / dayCount),
      averageDailyOutflow: round2(totalOut / dayCount),
      netDailyCashFlow: round2((totalIn - totalOut) / dayCount),
      activeDayCount: dayCount,
    };
  }

  // Reconstructed average daily balance from running-balance series when available.
  function analyzeDailyBalance(transactions, statementStart, statementEnd) {
    const withBalance = transactions.filter((t) => t.runningBalance != null).sort((a, b) => (a.date > b.date ? 1 : -1));
    if (!withBalance.length) {
      return { available: false, reason: 'no_running_balance_in_source' };
    }
    const balances = withBalance.map((t) => t.runningBalance);
    const negativeDays = withBalance.filter((t) => t.runningBalance < 0).map((t) => t.date);

    return {
      available: true,
      averageDailyBalance: round2(balances.reduce((s, b) => s + b, 0) / balances.length),
      lowestBalance: Math.min(...balances),
      highestBalance: Math.max(...balances),
      negativeDayCount: new Set(negativeDays).size,
      sampledDays: balances.length,
      note: 'Reconstructed from transaction running balances; may under-sample days with no posted transaction.',
    };
  }

  /**
   * @param {Array<{period:string, value:number}>} monthlySeries - real figures only.
   */
  function computeTrend(monthlySeries) {
    const series = (monthlySeries || []).filter((m) => typeof m.value === 'number');
    if (series.length < 2) return { trend: 'insufficient_data', periodsUsed: series.map((s) => s.period) };

    const diffs = [];
    for (let i = 1; i < series.length; i++) diffs.push(series[i].value - series[i - 1].value);

    const allUp = diffs.every((d) => d > 0);
    const allDown = diffs.every((d) => d < 0);
    const avgAbsDiff = diffs.reduce((s, d) => s + Math.abs(d), 0) / diffs.length;
    const avgVal = series.reduce((s, m) => s + m.value, 0) / series.length;
    const volatile = avgVal > 0 && avgAbsDiff / avgVal > 0.25;

    let trend;
    if (allUp) trend = 'increasing';
    else if (allDown) trend = 'decreasing';
    else if (volatile) trend = 'irregular';
    else trend = 'stable';

    return { trend, periodsUsed: series.map((s) => s.period), values: series.map((s) => s.value) };
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const api = { analyzeDailyCashFlow, analyzeDailyBalance, computeTrend };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.cashFlow = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
