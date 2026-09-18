/* ============================================================
   companyName.js — recovers the business name from a bank statement.

   Bank statements rarely label the account holder. Across real statements
   the name appears as an unlabelled line in the address block, identified
   by its legal entity suffix:

     ACS MAINTENANCE SERVICES INC
     4Bs Entertainment LLC
     A-1 SERVICES GOES ANYWHERE LLC

   So this reads, in order of strength: an explicit label, then a line
   carrying an entity suffix, then a DBA line. It never invents a name —
   when there is no evidence it returns null.
   ============================================================ */
(function (root) {
  'use strict';

  // Explicit labels, strongest evidence when a statement bothers to print one.
  const LABELLED = [
    /account\s*holder\s*(?:name)?\s*[:\-]\s*(.+)/i,
    /business\s*name\s*[:\-]\s*(.+)/i,
    /customer\s*name\s*[:\-]\s*(.+)/i,
    /member\s*name\s*[:\-]\s*(.+)/i,
    /account\s*title\s*[:\-]\s*(.+)/i,
    /prepared\s*for\s*[:\-]\s*(.+)/i,
    /legal\s*company\s*name\s*[:\-]\s*(.+)/i
  ];

  const DBA = /^\s*(?:d\/?b\/?a|doing business as)\b[:\s]+(.+)$/i;

  // Legal entity suffixes. Deliberately excludes bare "CO" — too common
  // inside ordinary words and addresses to be evidence of anything.
  const SUFFIX_WORDS =
    'LLC|L\\.L\\.C\\.|L L C|INC|INC\\.|INCORPORATED|CORP|CORP\\.|CORPORATION|LTD|LTD\\.|LIMITED|LLP|L\\.L\\.P\\.|PLLC|P\\.L\\.L\\.C\\.|LP|L\\.P\\.|PC|P\\.C\\.|COMPANY|ENTERPRISES|HOLDINGS|PARTNERS';
  const ENTITY_SUFFIX = new RegExp(`\\b(${SUFFIX_WORDS})\\b\\.?\\s*$`, 'i');
  /** The same suffixes, wherever they fall on the row. */
  const ENTITY_SUFFIX_ANYWHERE = new RegExp(`\\b(${SUFFIX_WORDS})\\b\\.?`, 'i');

  // Statement furniture that can carry an entity suffix but is never the holder.
  const BOILERPLATE =
    /\b(statement|account summary|page \d|balance|deposits|withdrawals|transaction|member fdic|equal housing|customer service|client care|contact information|questions about)\b/i;

  // A line that is an address rather than a name. Street types are required
  // alongside a leading number: plenty of real businesses start with a digit
  // ("4Bs Entertainment LLC", "366 Metro Mart INC", "984 LLC").
  const STREET_TYPE = root.ScannerEngine.holderAddress.STREET_TYPE;
  const ADDRESS_LIKE = /^\s*(?:p\.?\s*o\.?\s*box|c\/o\b|suite\b|ste\.?\b|apt\b|floor\b|\d+\s+\w+)/i;

  // Bank furniture. A line naming a bank is only a candidate if it also
  // carries an entity suffix, because a real business can be "… Financial LLC".
  const BANK_WORDS = /\b(bank|credit union|bancorp|savings|n\.a\.|federal|financial)\b/i;

  // Mail-sort barcodes print as a long run of capitals on the holder's own
  // row, e.g. "ACECMKMEIGOCICAAMGOAGCMK A-1 SERVICES GOES ANYWHERE LLC".
  // Length alone is not enough — real words like INTERNATIONAL are long too —
  // so a run of four or more consonants is required as well, which ordinary
  // English words do not have.
  const NOISE_TOKEN = /^([A-Z]{16,})\s+(?=\S)/;
  const CONSONANT_RUN = /[BCDFGHJKLMNPQRSTVWXZ]{4}/;

  /**
   * Some statements print the account number joined onto the name in the
   * routing block: "ESTAFFLLC4812 ESTAFF LLC". Such a code is letters followed
   * by the account digits, and the name repeats straight after it — both are
   * required, so a business whose name simply starts with a number keeps it:
   * "23HUNDRED VENTURES INC", "366 Metro Mart INC", "984 LLC".
   */
  const FUSED_CODE = /^([A-Za-z]+\d{3,})\s+(?=\S)/;

  /**
   * A row that opens with a posting date is a transaction, not the holder —
   * written either way round: "04-13-2026 ZEL FROM AL MAWA LLC" on one export,
   * "Apr 14, 2026 THORO CORP" on another.
   */
  const TRANSACTION_ROW =
    /^(?:\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{4})\b/i;

  const MIN_LENGTH = 3;
  const MAX_LENGTH = 80;
  /** The holder block sits near the top; scanning further invites noise. */
  const HEAD_LINES = 45;

  function clean(value) {
    return String(value || '')
      .replace(/ /g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[,;]+$/, '')
      .trim();
  }

  /**
   * The one key used to decide whether two documents belong to the same
   * business. Case, punctuation, mail-sort noise and the legal entity suffix
   * are all ignored, so "984, LLC", "984 LLC" and "984" are one company.
   */
  function companyKey(name) {
    const base = stripNoisePrefix(clean(name))
      .toLowerCase()
      // Possessives and plurals are the same business written two ways:
      // "1950'S Original" on the application, "1950 ORIGINALS LLC" on the
      // statements.
      .replace(/[''\u2019]s\b/g, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((word) => word && word !== 's')
      .map((word) => (word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word))
      .join(' ')
      .trim();
    if (!base) return 'unassociated';

    // One trailing suffix comes off, not a stack of them. "G & S METAL
    // PRODUCTS CO., INC." therefore keys apart from "G&S Metal Products INC",
    // and those two documents become two leads. That is deliberate: stripping
    // further would also turn "Test Company LLC" into "test", which would
    // merge businesses that merely share a first word. Splitting one company
    // in two is visible and recoverable; merging two is neither.
    const withoutSuffix = base
      .replace(
        /\s+(llc|l l c|inc|incorporated|corp|corporation|ltd|limited|llp|pllc|lp|pc|company|co)$/,
        ''
      )
      .trim();
    return withoutSuffix || base;
  }

  function lines(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(clean)
      .filter(Boolean);
  }

  /** Is what is left after a strip still a business name in its own right? */
  function survivesStrip(stripped) {
    return Boolean(stripped) && ENTITY_SUFFIX.test(stripped) && stripped.split(/\s+/).length >= 2;
  }

  /** Drop a leading mail-sort barcode or account code, if a real name remains. */
  function stripNoisePrefix(name) {
    const value = String(name || '');

    const barcode = value.match(NOISE_TOKEN);
    if (barcode && CONSONANT_RUN.test(barcode[1])) {
      const stripped = value.slice(barcode[0].length).trim();
      if (survivesStrip(stripped)) return stripped;
    }

    const fused = value.match(FUSED_CODE);
    if (fused) {
      const stripped = value.slice(fused[0].length).trim();
      const repeatsTheName = stripped
        .split(/\s+/)[0]
        .toLowerCase()
        .split('')
        .every((_letter, index) => fused[1][index]?.toLowerCase() === stripped[index]?.toLowerCase());
      if (repeatsTheName && survivesStrip(stripped)) return stripped;
    }

    return value;
  }

  /** A business name may be at most this many words before its suffix. */
  const MAX_NAME_WORDS = 6;

  /**
   * The business name at the start of a row that carries other text after it.
   * The name must end at a legal entity suffix, be short enough to be a name,
   * and every word before the suffix must start like one — so a suffix word
   * appearing mid-sentence does not turn the sentence into a company.
   * Returns null when the row is not of that shape.
   */
  function nameBeforeTrailingText(line) {
    const value = clean(line);
    const match = ENTITY_SUFFIX_ANYWHERE.exec(value);
    if (!match) return null;

    const candidate = value.slice(0, match.index + match[0].length).trim();
    if (candidate === value) return null; // nothing followed; already considered

    const words = candidate.split(/\s+/);
    if (words.length < 2 || words.length > MAX_NAME_WORDS) return null;
    if (!words.slice(0, -1).every((word) => /^[A-Z0-9]/.test(word))) return null;
    return candidate;
  }

  function looksLikeAddress(name) {
    // No business is named after the part of an address, so these win even
    // over a legal entity suffix later on the line.
    if (/^\s*(?:p\.?\s*o\.?\s*box|c\/o\b|suite\b|ste\.?\b|apt\b|floor\b)/i.test(name)) return true;
    // Otherwise a line carrying a legal entity suffix is a business, not an
    // address, however it starts: "4Bs Entertainment LLC", "984 LLC".
    if (ENTITY_SUFFIX.test(name)) return false;
    // A leading number only means an address when a street type follows.
    if (/^\s*\d/.test(name) && STREET_TYPE.test(name)) return true;
    // "City ST 12345"
    if (/\b[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/.test(name)) return true;
    return ADDRESS_LIKE.test(name) && !ENTITY_SUFFIX.test(name);
  }

  function plausible(name) {
    if (!name) return false;
    if (name.length < MIN_LENGTH || name.length > MAX_LENGTH) return false;
    if (TRANSACTION_ROW.test(name)) return false;
    if (BOILERPLATE.test(name)) return false;
    if (looksLikeAddress(name)) return false;
    // Needs at least one real word, not just punctuation or a code block.
    if (!/[A-Za-z]{2}/.test(name)) return false;
    return true;
  }

  function sameAsBank(name, bank) {
    if (!bank) return false;
    const a = String(name).toLowerCase().replace(/[^a-z0-9]/g, '');
    const b = String(bank).toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!a || !b) return false;
    return a.includes(b) || b.includes(a);
  }

  /**
   * @param {string} text raw statement text
   * @param {{bank?:string|null}} [options] the recognised bank, so its own
   *        name is never mistaken for the account holder
   * @returns {{legalName:string|null, dba:string|null, evidence:string}}
   */
  function extractCompanyName(text, options) {
    const bank = options && options.bank;
    const all = lines(text);
    const head = all.slice(0, HEAD_LINES);

    // 1. An explicit label anywhere in the document.
    for (const line of all) {
      for (const pattern of LABELLED) {
        const match = line.match(pattern);
        const name = match && clean(match[1]);
        if (plausible(name) && !sameAsBank(name, bank)) {
          return { legalName: stripNoisePrefix(name), dba: findDba(head), evidence: 'labelled' };
        }
      }
    }

    // 2. An unlabelled line carrying a legal entity suffix, near the top.
    for (const line of head) {
      if (!ENTITY_SUFFIX.test(line)) continue;
      if (!plausible(line)) continue;
      if (sameAsBank(line, bank)) continue;
      // A bank-ish line only counts when it is itself an entity.
      if (BANK_WORDS.test(line) && !ENTITY_SUFFIX.test(line)) continue;
      return { legalName: stripNoisePrefix(line), dba: findDba(head), evidence: 'entity_suffix' };
    }

    // 3. The holder's row ran into the column beside it. Statements print a
    //    marketing column next to the address block, and rebuilding rows from
    //    the PDF joins the two: "ABBASPOUR INC IMCU now offers Visa cards."
    //    Only reached when no row ended in a suffix of its own.
    for (const line of head) {
      const name = nameBeforeTrailingText(line);
      if (!name) continue;
      if (!plausible(name)) continue;
      if (sameAsBank(name, bank)) continue;
      return { legalName: stripNoisePrefix(name), dba: findDba(head), evidence: 'entity_suffix_split_row' };
    }

    // 4. Only a DBA was printed.
    const dba = findDba(head);
    if (dba) return { legalName: null, dba, evidence: 'dba_only' };

    return { legalName: null, dba: null, evidence: 'none' };
  }

  function findDba(candidates) {
    for (const line of candidates) {
      const match = line.match(DBA);
      const name = match && clean(match[1]);
      if (plausible(name)) return name;
    }
    return null;
  }

  const api = { extractCompanyName, companyKey, stripNoisePrefix, ENTITY_SUFFIX, HEAD_LINES };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.companyName = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
