// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   expenseAnalysis.js — debit categorization + largest expense.
   Spec ref: sections 9, 20, 21.
   ============================================================ */
(function (root) {
  'use strict';

  const CATEGORY_RULES = [
    { category: 'Payroll', re: /payroll|adp |gusto|paychex/i },
    { category: 'Rent', re: /\brent\b|lease pmt|property mgmt/i },
    { category: 'Utilities', re: /electric|utility|water bill|gas company|pg&e|con ?edison/i },
    { category: 'Insurance', re: /insurance|geico|progressive|hartford/i },
    { category: 'Taxes', re: /\btax\b|irs |eftps/i },
    { category: 'Fees', re: /service charge|monthly fee|overdraft|nsf/i },
    { category: 'Financing/MCA', re: /capital|funding|advance|kapitus|ondeck|bluevine|fundbox/i },
    { category: 'Transfers', re: /transfer|xfer/i },
    { category: 'Cash Withdrawal', re: /atm |cash withdrawal/i },
    { category: 'Card Purchase', re: /\bpos\b|debit card purchase/i },
  ];

  function categorize(desc) {
    for (const rule of CATEGORY_RULES) {
      if (rule.re.test(desc || '')) return rule.category;
    }
    return 'Vendor/Other';
  }

  function analyzeExpenses(transactions) {
    const debits = transactions.filter((t) => t.direction === 'debit' && t.amount != null);
    const byCategory = {};

    for (const t of debits) {
      const cat = categorize(t.description);
      byCategory[cat] = byCategory[cat] || { category: cat, count: 0, total: 0, txnIds: [] };
      byCategory[cat].count += 1;
      byCategory[cat].total = round2(byCategory[cat].total + t.amount);
      byCategory[cat].txnIds.push(t.id);
    }

    const categories = Object.values(byCategory).sort((a, b) => b.total - a.total);
    const largestSingleDebit = debits.length ? debits.reduce((a, b) => (a.amount > b.amount ? a : b)) : null;

    // "Recurring" = a description-normalized counterparty appearing 2+ times with a similar amount.
    const recurring = findRecurringDebits(debits);

    return {
      totalDebits: round2(debits.reduce((s, t) => s + t.amount, 0)),
      debitCount: debits.length,
      byCategory: categories,
      largestRecurringExpense: recurring[0] || null,
      largestSingleDebit: largestSingleDebit
        ? { txnId: largestSingleDebit.id, amount: largestSingleDebit.amount, description: largestSingleDebit.description }
        : null,
      recurringExpenses: recurring,
    };
  }

  function findRecurringDebits(debits) {
    const groups = {};
    for (const t of debits) {
      const key = normalizeCounterparty(t.description);
      groups[key] = groups[key] || [];
      groups[key].push(t);
    }
    return Object.keys(groups)
      .map((key) => {
        const txns = groups[key];
        if (txns.length < 2) return null;
        const total = round2(txns.reduce((s, t) => s + t.amount, 0));
        return {
          counterparty: key,
          category: categorize(txns[0].description),
          count: txns.length,
          averageAmount: round2(total / txns.length),
          totalAmount: total,
          txnIds: txns.map((t) => t.id),
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }

  function normalizeCounterparty(desc) {
    return (desc || '')
      .toLowerCase()
      .replace(/\d{3,}/g, '')
      .replace(/[^a-z\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .slice(0, 3)
      .join(' ');
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  const api = { analyzeExpenses, categorize };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.expenseAnalysis = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
