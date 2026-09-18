/* ============================================================
   balanceEquation.js — recovers and PROVES the statement's own
   balance equation.

   Every bank statement prints the same equation in its summary:

       beginning balance + credits - debits = ending balance

   Only the layout changes. Two layouts cover what banks print:

     a labelled block          a column table
       Beginning Balance   x     Beginning  Deposits  Withdrawals  Ending
       Deposits          + y     balance
       Withdrawals       - z     x          y         z            w
       Ending Balance      w

   Rather than guess which printed figures are credits and which are
   debits from a list of category names — which is what makes a wrong
   answer look like a right one — this reads the signs the bank itself
   printed, and where a sign is missing it solves for the one assignment
   that reproduces the printed ending balance. The arithmetic is the
   proof: a result is verified only when beginning + sum(components)
   equals the printed ending balance to the cent.
   ============================================================ */
(function (root) {
  'use strict';

  const U = root.ScannerEngine.coreUtils;

  /** Statement arithmetic is printed to the cent, so the tolerance is a cent. */
  const TOLERANCE = 0.01;
  /** A summary block is a handful of rows; scanning further picks up detail rows. */
  const BLOCK_MAX_LINES = 20;
  /** Column headers wrap over at most a few rows before the value row. */
  const HEADER_MAX_LINES = 3;
  /** Solving is a product over the open signs, so cap the search. */
  const MAX_COMBINATIONS = 3 ** 8;

  // The two balance labels. They are not anchored to the start of the row: a
  // posting date, an account name or a column of statistics can sit in front
  // of them, so the figure is taken from after the label instead. Some banks
  // name the two balances after the statements rather than the balances —
  // "LAST STATEMENT 12/31/25 56,002.94 ... THIS STATEMENT 01/30/26".
  const OPENING =
    /(?:(?:beginning|starting|previous|prior|opening)\s+(?:statement\s+|ledger\s+|daily\s+)?balance|(?:last|previous)\s+statement)\b/i;
  const CLOSING =
    /(?:(?:ending|closing|current|new)\s+(?:statement\s+|ledger\s+|posted\s+)?balance|this\s+statement)\b/i;

  /** Category words, used only where the bank printed no sign. */
  const CREDIT_WORDS = /\b(deposits?|credits?|additions?|interest|dividends?|refunds?)\b/i;
  const DEBIT_WORDS =
    /\b(withdrawals?|debits?|checks?|fees?|charges?|payments?|deductions?|subtractions?|purchases?)\b/i;

  function round2(n) {
    const rounded = Math.round((n + Number.EPSILON) * 100) / 100;
    return rounded === 0 ? 0 : rounded; // never report a negative zero
  }

  /**
   * A bare four-digit number in a statement period is a year, not an amount.
   * A figure the bank punctuated — "2,000.00", "2000.00" — is an amount, so
   * only unpunctuated digits are ever read as a year.
   */
  function isYear(text, value) {
    if (/[,.]/.test(text)) return false;
    return Number.isInteger(value) && value >= 1900 && value <= 2100;
  }

  /**
   * Every money figure on a line, with where it sits, years excluded.
   * @returns {Array<{value:number, start:number, end:number}>}
   */
  function moneyHits(line) {
    const source = String(line || '');
    const re = /\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d{2})?|[0-9]{4,}(?:\.\d{2})?|[0-9]{1,3}\.\d{2})/g;
    const out = [];
    let match;
    while ((match = re.exec(source))) {
      const value = parseFloat(match[1].replace(/,/g, ''));
      if (!Number.isFinite(value) || isYear(match[1], value)) continue;
      out.push({ value, start: match.index, end: re.lastIndex });
    }
    return out;
  }

  /**
   * The sign the bank printed for one figure: attached to the number
   * ("-3,405.57"), just before it ("- 469,487.69"), just after it
   * ("$22,888.95 +"), or carried from a row holding nothing but the sign.
   * Returns 1, -1, or null when nothing was printed.
   *
   * A sign after the figure only counts when it really follows that figure
   * and not a later one on the same row, which is why the window is narrow:
   * "Beginning Balance $23,417.64 Minimum Daily Balance $10,228 -" ends with
   * a minus that belongs to the right-hand column, not to the balance.
   */
  function printedSign(line, hit, carried) {
    const before = String(line).slice(Math.max(0, hit.start - 4), hit.start).replace(/[\s$(]+$/, '');
    if (before.endsWith('-')) return -1;
    if (before.endsWith('+')) return 1;

    const after = String(line).slice(hit.end, hit.end + 4).replace(/^[\s$)]+/, '');
    if (after.startsWith('-')) return -1;
    if (after.startsWith('+')) return 1;

    return carried ?? null;
  }

  /** The sign a category name implies, where the bank printed none. */
  function wordSign(label) {
    const credit = CREDIT_WORDS.test(label);
    const debit = DEBIT_WORDS.test(label);
    if (credit && !debit) return 1;
    if (debit && !credit) return -1;
    return null;
  }

  /**
   * Split text into rows, lifting a row that holds nothing but "+" or "-"
   * onto the row below it. Banks print that sign in its own narrow column,
   * and reconstructing rows from the PDF sometimes lands it on its own line.
   */
  function rows(text) {
    const out = [];
    let carry = null;
    for (const line of U.cleanLines(text)) {
      if (/^[-+]$/.test(line)) {
        carry = line === '-' ? -1 : 1;
        continue;
      }
      out.push({ text: line, carry });
      carry = null;
    }
    return out;
  }

  /**
   * Search the sign assignments the statement leaves open, keeping only those
   * that reproduce the printed ending balance.
   *
   * A figure the bank printed a sign against is fixed. A figure the bank left
   * unsigned can be a credit, a debit, or no movement at all — a summary block
   * also carries statistics such as an average balance or dividends paid to
   * date, which sit inside it but are not part of the equation.
   *
   * @param {Array} choicesFor per-component list of the signs it may take
   * @returns {object|null} the one solution, or null when none balances or
   *          more than one does with different totals
   */
  function search(beginning, components, ending, choicesFor) {
    const options = components.map(choicesFor);
    const combinations = options.reduce((total, list) => total * list.length, 1);
    if (combinations > MAX_COMBINATIONS) return null;

    const solutions = [];
    for (let code = 0; code < combinations; code += 1) {
      let rest = code;
      const signs = options.map((list) => {
        const sign = list[rest % list.length];
        rest = Math.floor(rest / list.length);
        return sign;
      });

      const sum = components.reduce((acc, c, i) => acc + c.amount * signs[i], beginning);
      if (Math.abs(round2(sum) - ending) > TOLERANCE) continue;

      const deposits = round2(components.reduce((acc, c, i) => (signs[i] > 0 ? acc + c.amount : acc), 0));
      const withdrawals = round2(components.reduce((acc, c, i) => (signs[i] < 0 ? acc + c.amount : acc), 0));
      if (!solutions.some((s) => s.deposits === deposits && s.withdrawals === withdrawals)) {
        solutions.push({ deposits, withdrawals, signs });
      }
      if (solutions.length > 1) return null; // ambiguous
    }
    return solutions[0] ?? null;
  }

  /**
   * Solve in two passes, so the weakest evidence is only relaxed when the
   * stronger reading fails. First every category name is taken at its word and
   * only the nameless figures are searched; if nothing balances, a named figure
   * is allowed to be a statistic rather than a movement — but never to move in
   * the opposite direction to its own name.
   */
  function solveSigns(beginning, components, ending) {
    const strict = search(beginning, components, ending, (c) =>
      c.sign === null ? [1, -1, 0] : [c.sign]
    );
    if (strict) return strict;

    return search(beginning, components, ending, (c) => {
      if (c.sign === null) return [1, -1, 0];
      return c.printed ? [c.sign] : [c.sign, 0];
    });
  }

  function build(beginning, components, ending, layout) {
    const solved = solveSigns(beginning, components, ending);
    const signs = solved ? solved.signs : components.map((c) => c.sign ?? 0);
    const deposits = solved
      ? solved.deposits
      : round2(components.reduce((acc, c, i) => (signs[i] > 0 ? acc + c.amount : acc), 0));
    const withdrawals = solved
      ? solved.withdrawals
      : round2(components.reduce((acc, c, i) => (signs[i] < 0 ? acc + c.amount : acc), 0));

    return {
      beginning,
      ending,
      deposits,
      withdrawals,
      difference: round2(beginning + deposits - withdrawals - ending),
      verified: Boolean(solved),
      layout,
      evidence: solved ? `Verified ${layout.replace('_', ' ')}` : `Unproven ${layout.replace('_', ' ')}`,
      components: components.map((c, i) => ({ label: c.label, amount: round2(c.amount * signs[i]) })),
    };
  }

  /**
   * Some statements print the labels in one column and the figures in
   * another, and rebuilding rows from the PDF can land them on separate
   * lines. Where a labelled row carries no figure and the row below carries
   * nothing but one, they are the same row of the printed table.
   * Applied only to the labelled block: a column table needs its header rows
   * kept apart from its value row.
   */
  function pairLabelsWithFigures(all) {
    const out = [];
    for (let i = 0; i < all.length; i += 1) {
      const row = all[i];
      const next = all[i + 1];
      const labelled = /[A-Za-z]/.test(row.text) && !moneyHits(row.text).length;
      const bareFigure = next && !/[A-Za-z]/.test(next.text) && moneyHits(next.text).length === 1;
      if (labelled && bareFigure) {
        out.push({ text: `${row.text} ${next.text}`, carry: row.carry ?? next.carry });
        i += 1;
        continue;
      }
      out.push(row);
    }
    return out;
  }

  /**
   * The balance a row states, read from the first figure after the label.
   * The label is not always at the start of the row: some statements print
   * "PREFERRED BUSINESS CHECKING ID 0010 Beginning Balance $22,414.43".
   */
  function balanceOn(row, pattern) {
    const match = pattern.exec(row.text);
    if (!match) return null;
    const hit = moneyHits(row.text).find((candidate) => candidate.start >= match.index);
    if (!hit) return null;
    return hit.value * (printedSign(row.text, hit, row.carry) ?? 1);
  }

  /**
   * Every figure on a row, each taking as its label the words that precede it.
   * A row can carry more than one: two-column summaries put an average balance
   * beside a deposit total, and some put the deposit total itself mid-row.
   */
  function componentsOn(row) {
    const hits = moneyHits(row.text);
    const out = [];
    let from = 0;
    for (const hit of hits) {
      const label = row.text.slice(from, hit.start).replace(/[^A-Za-z&/ ]/g, ' ').trim();
      from = hit.end;
      if (!label) continue;
      const printed = printedSign(row.text, hit, row.carry);
      out.push({ label, amount: hit.value, sign: printed ?? wordSign(label), printed: printed !== null });
    }
    return out;
  }

  /**
   * Layout 1: labelled figures between an opening and a closing balance row.
   *
   * A statement covering several accounts prints one such block per account.
   * The business's operating account is the one its money moves through, so
   * the busiest proven block is the one reported.
   */
  function fromLabelledBlock(rowsIn) {
    const all = pairLabelsWithFigures(rowsIn);
    const found = [];

    for (let i = 0; i < all.length; i += 1) {
      const beginning = balanceOn(all[i], OPENING);
      if (beginning === null) continue;

      for (let j = i + 1; j < Math.min(all.length, i + BLOCK_MAX_LINES); j += 1) {
        if (OPENING.test(all[j].text)) break; // a second block starts here
        const ending = balanceOn(all[j], CLOSING);
        if (ending === null) continue;

        const components = [];
        for (let k = i + 1; k < j; k += 1) components.push(...componentsOn(all[k]));
        if (components.length) found.push(build(beginning, components, ending, 'labelled_block'));
        break;
      }
    }

    const verified = found.filter((block) => block.verified);
    if (!verified.length) return found[0] ?? null;

    const movement = (block) => block.deposits + block.withdrawals;
    const best = verified.reduce((a, b) => (movement(b) > movement(a) ? b : a));
    return verified.length > 1 ? { ...best, accountsInBlock: verified.length } : best;
  }

  /** One value row of a column table, read against the header's operators. */
  function readTableRow(line, operators) {
    const hits = moneyHits(line);
    if (hits.length < 3) return null;
    const middle = hits.slice(1, -1);
    const components = middle.map((hit, index) => ({
      label: `column ${index + 1}`,
      amount: hit.value,
      sign: operators.length === middle.length ? (operators[index] === '-' ? -1 : 1) : null,
    }));
    return build(hits[0].value, components, hits[hits.length - 1].value, 'column_table');
  }

  /**
   * Layout 2: the figures sit in one row under a column header. The header
   * may print the operators itself ("Balance + Deposits - Withdrawals =
   * Balance"); where it does not, the signs are solved for.
   *
   * A statement that covers several accounts prints one row per account. The
   * business's operating account is the one its money moves through, so where
   * more than one row balances the busiest is the one reported, and the rest
   * are counted so the choice is visible rather than silent.
   */
  function fromColumnTable(all) {
    for (let i = 0; i < all.length; i += 1) {
      if (!/\b(beginning|previous|starting)\b/i.test(all[i].text)) continue;

      let header = all[i].text;
      for (let j = i + 1; j < Math.min(all.length, i + 1 + HEADER_MAX_LINES); j += 1) {
        if (moneyHits(all[j].text).length < 3) {
          header = `${header} ${all[j].text}`;
          continue;
        }
        if (!/\b(ending|closing|new|current)\b/i.test(header)) break;

        const operators = header.match(/(?<=\s)[+\-](?=\s)/g) ?? [];
        const verified = [];
        for (let k = j; k < all.length; k += 1) {
          const row = readTableRow(all[k].text, operators);
          if (!row) break; // the table has ended
          if (row.verified) verified.push(row);
        }
        if (!verified.length) break;

        const movement = (row) => row.deposits + row.withdrawals;
        const best = verified.reduce((a, b) => (movement(b) > movement(a) ? b : a));
        return verified.length > 1 ? { ...best, accountsInTable: verified.length } : best;
      }
    }
    return null;
  }

  /**
   * @param {string} text raw statement text
   * @returns {object|null} the statement's balance equation, `verified` when
   *          the arithmetic proves it, or null when none was found.
   */
  function solveBalanceEquation(text) {
    const all = rows(text);
    const block = fromLabelledBlock(all);
    if (block && block.verified) return block;
    const table = fromColumnTable(all);
    if (table && table.verified) return table;
    return block ?? table ?? null;
  }

  const api = { solveBalanceEquation, TOLERANCE };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.balanceEquation = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
