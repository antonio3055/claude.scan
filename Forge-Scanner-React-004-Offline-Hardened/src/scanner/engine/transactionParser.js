/* ============================================================
   transactionParser.js — generic transaction-line reconstruction.
   Spec ref: sections 5, 6, 47, 48 ("generic parser" fallback tier).
   This is NOT a bank-specific column parser (none of the 33 banks
   have a verified per-bank column layout in this build — see the
   honesty note in engine/README). It is a single, careful generic
   reconstruction pass that:
     - finds date-led transaction lines,
     - captures amount(s) and an optional running balance,
     - folds wrapped/continuation lines into the previous description,
     - normalizes sign/direction,
     - keeps the raw line as evidence.
   Anything it can't confidently parse is skipped, not guessed —
   the caller decides whether skipped lines matter for reconciliation.
   ============================================================ */
(function (root) {
  'use strict';

  // MM/DD or MM/DD/YY or MM/DD/YYYY at line start (most US statements).
  const DATE_LEAD_RE = /^\s*(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s+(.*)$/;

  // A monetary amount: optional $, optional parens/minus, digits with commas, 2 decimals.
  const AMOUNT_RE = /\(?-?\$?\s?[\d,]+\.\d{2}\)?-?/g;

  function parseAmount(raw) {
    if (!raw) return null;
    const neg = /^\(.*\)$/.test(raw.trim()) || /^-/.test(raw.trim()) || /-\s*$/.test(raw.trim());
    const num = Number(raw.replace(/[^\d.]/g, ''));
    if (Number.isNaN(num)) return null;
    return neg ? -num : num;
  }

  function normalizeYear(y, fallbackYear) {
    if (!y) return fallbackYear;
    y = String(y);
    if (y.length === 2) return (Number(y) > 50 ? 1900 : 2000) + Number(y);
    return Number(y);
  }

  /**
   * @param {string} text - full extracted page/document text.
   * @param {{statementYear?: number}} opts
   * @returns {Array<object>} transactions
   */
  function parseTransactions(text, opts) {
    opts = opts || {};
    const fallbackYear = opts.statementYear || new Date().getFullYear();
    const lines = (text || '').split(/\r?\n/);

    const txns = [];
    let current = null;
    let txnId = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.trim()) continue;

      const dm = line.match(DATE_LEAD_RE);

      if (dm) {
        // New transaction line — flush previous.
        if (current) txns.push(finalize(current));

        const month = Number(dm[1]);
        const day = Number(dm[2]);
        const year = normalizeYear(dm[3], fallbackYear);
        const rest = dm[4];

        const amounts = (rest.match(AMOUNT_RE) || []).map(parseAmount).filter((n) => n !== null);
        const description = rest.replace(AMOUNT_RE, '').replace(/\s{2,}/g, ' ').trim();

        current = {
          id: 'txn_' + (++txnId),
          date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
          descriptionParts: [description],
          rawAmounts: amounts,
          runningBalance: amounts.length >= 2 ? amounts[amounts.length - 1] : null,
          sourceLines: [line],
          reviewFlag: amounts.length === 0,
        };
      } else if (current) {
        // Continuation line: more description text, or a trailing amount.
        const amounts = (line.match(AMOUNT_RE) || []).map(parseAmount).filter((n) => n !== null);
        if (amounts.length) {
          current.rawAmounts = current.rawAmounts.concat(amounts);
          if (amounts.length >= 1) current.runningBalance = amounts[amounts.length - 1];
        }
        const textPart = line.replace(AMOUNT_RE, '').trim();
        if (textPart && looksLikeContinuation(textPart)) {
          current.descriptionParts.push(textPart);
          current.sourceLines.push(line);
        }
      }
    }
    if (current) txns.push(finalize(current));

    return txns;
  }

  // Continuation text shouldn't itself look like a new statement header/footer line.
  function looksLikeContinuation(t) {
    if (/^(page \d+|continued|total|subtotal)/i.test(t)) return false;
    if (t.length > 120) return false;
    return true;
  }

  function finalize(t) {
    // Direction: if we captured 2 amounts, treat first as amount, second as running balance
    // (common column layout: Amount | Balance). If only 1 amount, sign determines direction;
    // if no sign, mark for review rather than guessing.
    let amount = null;
    let direction = 'unknown';

    if (t.rawAmounts.length >= 2) {
      amount = t.rawAmounts[0];
      t.runningBalance = t.rawAmounts[t.rawAmounts.length - 1];
    } else if (t.rawAmounts.length === 1) {
      amount = t.rawAmounts[0];
      t.runningBalance = null;
    }

    if (amount !== null) {
      direction = amount < 0 ? 'debit' : 'credit_or_debit_unmarked';
    }

    const description = t.descriptionParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    const drCrTag = detectDrCrTag(description);
    if (drCrTag && amount !== null) {
      direction = drCrTag === 'DR' ? 'debit' : 'credit';
      amount = Math.abs(amount);
    } else if (amount !== null && direction === 'credit_or_debit_unmarked') {
      // No explicit sign/tag: classify by common descriptor keywords, else needs review.
      direction = classifyByKeyword(description);
    }

    return {
      id: t.id,
      date: t.date,
      description,
      rawDescription: t.sourceLines.join(' | '),
      amount: amount === null ? null : Math.abs(amount),
      direction, // 'credit' | 'debit' | 'needs_review'
      runningBalance: t.runningBalance,
      sourceLines: t.sourceLines,
      confidence: amount === null ? 'low' : direction === 'needs_review' ? 'medium' : 'high',
      reviewFlag: amount === null || direction === 'needs_review',
    };
  }

  function detectDrCrTag(desc) {
    if (/\bDR\b/.test(desc)) return 'DR';
    if (/\bCR\b/.test(desc)) return 'CR';
    return null;
  }

  // 'deposit' etc. are unambiguous enough to decide direction on their own, even
  // when a weaker word like "pmt" also appears in the same description (e.g.
  // "ACH DEPOSIT CUSTOMER PMT" is a deposit, not a payment-out). Credit words are
  // checked first for that reason; only descriptions with no credit signal fall
  // through to the debit-keyword check.
  const CREDIT_KEYWORDS = /deposit|transfer in|payroll credit|ach credit|refund|\bcredit\b/i;
  const DEBIT_KEYWORDS = /check|withdrawal|\bdebit\b|payment|\bpmt\b|purchase|\bfee\b|pos |ach debit|bill pay/i;

  function classifyByKeyword(desc) {
    if (CREDIT_KEYWORDS.test(desc)) return 'credit';
    if (DEBIT_KEYWORDS.test(desc)) return 'debit';
    return 'needs_review';
  }

  const api = { parseTransactions, parseAmount };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.transactionParser = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
