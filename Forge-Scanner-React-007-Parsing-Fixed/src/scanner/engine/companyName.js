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
  const ENTITY_SUFFIX =
    /\b(LLC|L\.L\.C\.|L L C|INC|INC\.|INCORPORATED|CORP|CORP\.|CORPORATION|LTD|LTD\.|LIMITED|LLP|L\.L\.P\.|PLLC|P\.L\.L\.C\.|LP|L\.P\.|PC|P\.C\.|COMPANY|ENTERPRISES|HOLDINGS|PARTNERS)\b\.?\s*$/i;

  // Statement furniture that can carry an entity suffix but is never the holder.
  const BOILERPLATE =
    /\b(statement|account summary|page \d|balance|deposits|withdrawals|transaction|member fdic|equal housing|customer service|client care|contact information|questions about)\b/i;

  // A line that is an address rather than a name. Street types are required
  // alongside a leading number: plenty of real businesses start with a digit
  // ("4Bs Entertainment LLC", "366 Metro Mart INC", "984 LLC").
  const STREET_TYPE =
    /\b(st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|ter|terrace|pl|place|cir|circle)\b\.?/i;
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

  /** Drop a leading mail-sort barcode, but only if a real name remains. */
  function stripNoisePrefix(name) {
    const value = String(name || '');
    const match = value.match(NOISE_TOKEN);
    if (!match || !CONSONANT_RUN.test(match[1])) return value;

    const stripped = value.slice(match[0].length).trim();
    // Only trust the strip when what is left still looks like a business.
    return stripped && ENTITY_SUFFIX.test(stripped) ? stripped : value;
  }

  function looksLikeAddress(name) {
    // A line carrying a legal entity suffix is a business, not an address,
    // however it starts.
    if (ENTITY_SUFFIX.test(name)) return false;
    if (/^\s*(?:p\.?\s*o\.?\s*box|c\/o\b|suite\b|ste\.?\b|apt\b|floor\b)/i.test(name)) return true;
    // A leading number only means an address when a street type follows.
    if (/^\s*\d/.test(name) && STREET_TYPE.test(name)) return true;
    // "City ST 12345"
    if (/\b[A-Z]{2}\s+\d{5}(-\d{4})?\s*$/.test(name)) return true;
    return ADDRESS_LIKE.test(name) && !ENTITY_SUFFIX.test(name);
  }

  function plausible(name) {
    if (!name) return false;
    if (name.length < MIN_LENGTH || name.length > MAX_LENGTH) return false;
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

    // 3. Only a DBA was printed.
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
