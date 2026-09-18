/* ============================================================
   transactionParser.js — generic transaction-line reconstruction.
   Spec ref: sections 5, 6, 47, 48 ("generic parser" fallback tier).

   This is NOT a bank-specific column parser. It is a single generic
   reconstruction pass that:
     - tracks which section of the statement it is reading, because real
       statements group credits and debits under their own headings and
       that is far stronger evidence of direction than any keyword,
     - finds transaction lines whose date leads the line OR sits just
       before the amount, with -, / or . separators,
     - skips summary tables (daily balance, transaction counts) that look
       like transactions but are not,
     - captures amount(s) and an optional running balance,
     - folds wrapped/continuation lines into the previous description,
     - keeps the raw line as evidence.

   Anything it cannot confidently parse is skipped or flagged, not
   guessed — the caller decides whether that matters for reconciliation.
   ============================================================ */
(function (root) {
  'use strict';

  // A date with any common separator: 01/22, 01-22-2026, 1.22.26
  const DATE = '(\\d{1,2})[\\/\\-.](\\d{1,2})(?:[\\/\\-.](\\d{2,4}))?';
  const DATE_LEAD_RE = new RegExp(`^\\s*${DATE}\\s+(.*)$`);
  // Layouts that print the description first and the date beside the amount:
  //   "Deposit 650825261202 01-02 1,280.00"
  const DATE_TRAILING_RE = new RegExp(`^(.*?)\\s${DATE}\\s+(\\(?-?\\$?\\s?[\\d,]+\\.\\d{2}\\)?-?)\\s*$`);

  // A monetary amount: optional $, optional parens/minus, digits with commas, 2 decimals.
  const AMOUNT_RE = /\(?-?\$?\s?[\d,]+\.\d{2}\)?-?/g;

  /**
   * Section headings. Real statements group their transactions, and the
   * heading above a line is the most reliable statement of its direction.
   *
   * Every pattern is anchored to the start of the line, and headings are
   * length-capped, because statements are full of prose that mentions these
   * same words: "For ATM and Debit Card withdrawals, use the transaction
   * date" is an instruction to the reader, not the start of the debits.
   */
  const HEADING_MAX = 60;

  const CREDIT_SECTION = [
    /^(?:\d+\s+)?deposits?\s*(?:&|and|,)\s*(?:other\s+)?credits\b/i,
    /^deposits?\s*,\s*credits\b/i,
    /^deposits?\s+and\s+additions\b/i,
    /^electronic\s+(?:deposits|credits)\b/i,
    /^additions\s+to\s+account\b/i,
    /^money\s+in\b/i,
    // A bare one-word heading only counts when it is the whole line, give or
    // take an account number or a "(continued)" marker.
    /^(?:deposits?|credits)\s*(?:account\s*#?\s*[\d\s-]*)?(?:[-–]?\s*\(?cont(?:inued)?\.?\)?)?\s*$/i
  ];

  const DEBIT_SECTION = [
    /^(?:\d+\s+)?withdrawals?\s*(?:&|and|,)\s*(?:other\s+)?debits\b/i,
    /^checks?\s+and\s+other\s+debits\b/i,
    /^other\s+withdrawals\b/i,
    /^electronic\s+(?:withdrawals|payments|debits)\b/i,
    /^checks?\s+paid\b/i,
    /^atm\s+withdrawals?\b/i,
    /^debit\s+card\s+(?:purchases?|withdrawals?)\b/i,
    /^subtractions\s+from\s+account\b/i,
    /^money\s+out\b/i,
    /^(?:withdrawals?|debits)\s*(?:account\s*#?\s*[\d\s-]*)?(?:[-–]?\s*\(?cont(?:inued)?\.?\)?)?\s*$/i
  ];

  /**
   * Tables that are date-led but are not transactions. Without this a daily
   * balance table becomes dozens of phantom transactions and wrecks the
   * reconciliation.
   */
  const IGNORE_SECTION = [
    /^daily\s+balance\b/i,
    /^balance\s+summary\b/i,
    /^transaction\s+counts?\b/i,
    /^service\s+charge\s+summary\b/i,
    /^accounts?\s+summary\b/i,
    /^interest\s+summary\b/i,
    /^(?:rate|fee|overdraft)\s+summary\b/i,
    /^statement\s+of\s+account\b/i,
    /^summary\s+of\s+account\b/i
  ];

  /**
   * A cheque number, wherever it is written. Some statements list the same
   * cheques twice in two different layouts, and the number is what makes the
   * repeat recognisable.
   */
  const CHECK_IN_DESCRIPTION = /\b(?:check|cheque|chk)\s*#?\s*(\d{3,6})\b|^#(\d{3,6})\b/i;

  function checkNumberOf(description) {
    const match = String(description || '').match(CHECK_IN_DESCRIPTION);
    return match ? String(match[1] || match[2]) : null;
  }

  /** A totals line closes the running list; it is never a transaction. */
  const TOTAL_LINE = /^\s*(?:total|subtotal|ending|beginning|previous|new)\b/i;

  function parseAmount(raw) {
    if (!raw) return null;
    const value = String(raw).trim();
    const neg = /^\(.*\)$/.test(value) || /^-/.test(value) || /-\s*$/.test(value);
    const num = Number(value.replace(/[^\d.]/g, ''));
    if (Number.isNaN(num)) return null;
    return neg ? -num : num;
  }

  function normalizeYear(y, fallbackYear) {
    if (!y) return fallbackYear;
    const value = String(y);
    if (value.length === 2) return (Number(value) > 50 ? 1900 : 2000) + Number(value);
    return Number(value);
  }

  /**
   * Which section a heading opens, or null when the line is not a heading.
   * Ignore is checked first: "Account Summary" contains the word deposits
   * further down and must not be read as the deposits section.
   */
  function sectionOf(line) {
    const trimmed = String(line || '').trim();
    // Headings are short. Anything longer is prose that happens to use the
    // same words.
    if (!trimmed || trimmed.length > HEADING_MAX) return null;

    if (IGNORE_SECTION.some((pattern) => pattern.test(trimmed))) return 'ignore';
    if (CREDIT_SECTION.some((pattern) => pattern.test(trimmed))) return 'credit';
    if (DEBIT_SECTION.some((pattern) => pattern.test(trimmed))) return 'debit';
    return null;
  }

  /**
   * A heading also carries transaction data on some statements, so only treat
   * a line as a pure heading when it has no amount of its own.
   */
  function isHeadingOnly(line) {
    return !/[\d,]+\.\d{2}/.test(line);
  }

  function makeDate(month, day, year) {
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /**
   * @param {string} text - full extracted page/document text.
   * @param {{statementYear?: number}} opts
   * @returns {Array<object>} transactions
   */
  function parseTransactions(text, opts) {
    opts = opts || {};
    const fallbackYear = opts.statementYear || new Date().getFullYear();
    const lines = String(text || '').split(/\r?\n/);

    const txns = [];
    const seenChecks = new Set();
    let current = null;
    let txnId = 0;
    let section = null;

    const flush = () => {
      if (!current) return;
      const done = finalize(current);
      current = null;
      // Some statements list their cheques twice, in two different layouts.
      // The cheque number is what makes the repeat recognisable.
      if (done.checkNumber) {
        if (seenChecks.has(done.checkNumber)) return;
        seenChecks.add(done.checkNumber);
      }
      txns.push(done);
    };

    for (const line of lines) {
      if (!line || !line.trim()) continue;

      // A heading changes which section we are in and ends the previous entry.
      const heading = isHeadingOnly(line) ? sectionOf(line) : null;
      if (heading) {
        flush();
        section = heading;
        continue;
      }

      if (TOTAL_LINE.test(line)) {
        flush();
        continue;
      }

      // Summary tables are date-led but hold no transactions.
      if (section === 'ignore') continue;

      const started = startTransaction(line, fallbackYear, section, () => `txn_${++txnId}`);
      if (started) {
        flush();
        current = started;
        continue;
      }

      if (current) appendContinuation(current, line);
    }

    flush();
    return txns;
  }

  /** Begin a transaction from a line, whichever layout the statement uses. */
  function startTransaction(line, fallbackYear, section, nextId) {
    const lead = line.match(DATE_LEAD_RE);
    if (lead) {
      const rest = lead[4];
      const amounts = (rest.match(AMOUNT_RE) || []).map(parseAmount).filter((n) => n !== null);
      return {
        id: nextId(),
        date: makeDate(Number(lead[1]), Number(lead[2]), normalizeYear(lead[3], fallbackYear)),
        descriptionParts: [rest.replace(AMOUNT_RE, '').replace(/\s{2,}/g, ' ').trim()],
        rawAmounts: amounts,
        runningBalance: amounts.length >= 2 ? amounts[amounts.length - 1] : null,
        sourceLines: [line],
        section
      };
    }

    const trailing = line.match(DATE_TRAILING_RE);
    if (trailing) {
      const amount = parseAmount(trailing[5]);
      if (amount === null) return null;
      return {
        id: nextId(),
        date: makeDate(Number(trailing[2]), Number(trailing[3]), normalizeYear(trailing[4], fallbackYear)),
        descriptionParts: [String(trailing[1]).replace(/\s{2,}/g, ' ').trim()],
        rawAmounts: [amount],
        runningBalance: null,
        sourceLines: [line],
        section
      };
    }

    return null;
  }

  function appendContinuation(current, line) {
    const amounts = (line.match(AMOUNT_RE) || []).map(parseAmount).filter((n) => n !== null);
    if (amounts.length) {
      current.rawAmounts = current.rawAmounts.concat(amounts);
      current.runningBalance = amounts[amounts.length - 1];
    }
    const textPart = line.replace(AMOUNT_RE, '').trim();
    if (textPart && looksLikeContinuation(textPart)) {
      current.descriptionParts.push(textPart);
      current.sourceLines.push(line);
    }
  }

  // Continuation text shouldn't itself look like a new statement header/footer line.
  function looksLikeContinuation(t) {
    if (/^(page \d+|continued|total|subtotal)/i.test(t)) return false;
    if (t.length > 120) return false;
    return true;
  }

  function finalize(t) {
    // Direction: if we captured 2 amounts, treat first as amount, second as running
    // balance (common column layout: Amount | Balance). If only 1 amount, use it.
    let amount = null;

    if (t.rawAmounts.length >= 2) {
      amount = t.rawAmounts[0];
      t.runningBalance = t.rawAmounts[t.rawAmounts.length - 1];
    } else if (t.rawAmounts.length === 1) {
      amount = t.rawAmounts[0];
      t.runningBalance = null;
    }

    const description = t.descriptionParts.join(' ').replace(/\s{2,}/g, ' ').trim();
    const direction = resolveDirection({ amount, description, section: t.section });
    const checkNumber = direction === 'debit' ? checkNumberOf(description) : null;

    return {
      id: t.id,
      date: t.date,
      description,
      checkNumber,
      rawDescription: t.sourceLines.join(' | '),
      amount: amount === null ? null : Math.abs(amount),
      direction, // 'credit' | 'debit' | 'needs_review'
      directionSource: direction === 'needs_review' ? 'none' : directionSource({ amount, description, section: t.section }),
      section: t.section ?? null,
      runningBalance: t.runningBalance,
      sourceLines: t.sourceLines,
      confidence: amount === null ? 'low' : direction === 'needs_review' ? 'medium' : 'high',
      reviewFlag: amount === null || direction === 'needs_review'
    };
  }

  /**
   * Strongest evidence first: an explicit sign, then a DR/CR tag, then the
   * section the line was printed under, then descriptor keywords.
   */
  function resolveDirection({ amount, description, section }) {
    if (amount === null) return 'needs_review';
    if (amount < 0) return 'debit';

    const tag = detectDrCrTag(description);
    if (tag) return tag === 'DR' ? 'debit' : 'credit';

    if (section === 'credit') return 'credit';
    if (section === 'debit') return 'debit';

    return classifyByKeyword(description);
  }

  function directionSource({ amount, description, section }) {
    if (amount !== null && amount < 0) return 'sign';
    if (detectDrCrTag(description)) return 'tag';
    if (section === 'credit' || section === 'debit') return 'section';
    return 'keyword';
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
  // through to the debit-keyword check. Used only when the statement gave no
  // section and no sign.
  const CREDIT_KEYWORDS =
    /deposit|\bdep\b|transfer in|payroll credit|ach credit|refund|\bcredit\b|hcclaimpmt|claim\s*pmt|merch(?:ant)?\s*(?:dep|deposit|settle)/i;
  const DEBIT_KEYWORDS =
    /check|withdrawal|\bdebit\b|payment|\bpmt\b|purchase|\bfee\b|pos |ach debit|bill pay|service charge/i;

  function classifyByKeyword(desc) {
    if (CREDIT_KEYWORDS.test(desc)) return 'credit';
    if (DEBIT_KEYWORDS.test(desc)) return 'debit';
    return 'needs_review';
  }

  const api = { parseTransactions, parseAmount, sectionOf, CREDIT_SECTION, DEBIT_SECTION, IGNORE_SECTION };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.transactionParser = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
