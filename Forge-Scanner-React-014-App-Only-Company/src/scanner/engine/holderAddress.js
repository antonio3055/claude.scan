/* ============================================================
   holderAddress.js — the account holder's address, as printed on
   the statement.

   The address sits directly under the holder's name, but rarely on
   its own: banks set their own address, telephone numbers and opening
   hours in a column beside it, and rebuilding rows from the PDF
   interleaves the two.

     DATALAB INFOTECH INC
     Bank of America, N.A.          <- the bank's column
     1201 RICHARDSON DR STE 180
     P.O. Box 25118                 <- the bank's column
     RICHARDSON, TX 75080-4610
     Tampa, FL 33622-5118           <- the bank's column

   So the rows are not counted. The first street line after the name is
   taken, then the first town line after that, which steps over the
   bank's own column without having to know anything about the bank.
   ============================================================ */
(function (root) {
  'use strict';

  const U = root.ScannerEngine.coreUtils;

  /** How far below the name the address block can run. */
  const REACH = 10;

  /**
   * Street types, kept here because this is the module that knows what an
   * address looks like; companyName reads the same list rather than keeping
   * a second copy of it.
   */
  const STREET_TYPE_WORDS =
    'st|street|ave|avenue|rd|road|dr|drive|blvd|boulevard|ln|lane|way|ct|court|pkwy|parkway|hwy|highway|ter|terrace|pl|place|cir|circle|trl|trail|turnpike|tpke|loop|run|row|sq|square|xing|crossing|pike|expy|expressway';
  const STREET_TYPE = new RegExp(`\\b(?:${STREET_TYPE_WORDS})\\b\\.?`, 'i');

  /**
   * The holder's street, cut off where the bank's column begins.
   *
   * The row is rarely the street alone: "2998 SCOTT BLVD reserve your seat by
   * calling (408) 731-4197 or". So the match runs from the house number to the
   * street type, and then takes a direction and a unit if they follow —
   * "1201 RICHARDSON DR STE 180" keeps its suite, the marketing copy is cut.
   */
  const STREET = new RegExp(
    `^(\\d+[A-Za-z]?\\s+[A-Za-z0-9.'&#\\- ]*?\\b(?:${STREET_TYPE_WORDS})\\b\\.?` +
      `(?:\\s+(?:N|S|E|W|NE|NW|SE|SW)\\b\\.?)?` +
      `(?:\\s+(?:ste|suite|apt|unit|rm|room|fl|floor|#)\\.?\\s*[A-Za-z0-9\\-]+)?)`,
    'i'
  );
  /** A post box, used only when the holder prints no street. */
  const PO_BOX = /^p\.?\s*o\.?\s*box\s+\d+/i;
  /**
   * "RICHARDSON, TX 75080-4610", "AUSTIN TX 78753". The row may carry the
   * bank's column after it — "CLEVELAND OH 44127-1831 Online: wellsfargo.com"
   * — so only the start of the row has to be the town.
   */
  const TOWN = /^([A-Za-z.'\- ]{2,}?),?\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\b/;

  /** The same town pattern, found anywhere in a one-line address. */
  const TOWN_ANYWHERE = /([A-Za-z.'\- ]{2,}?),?\s+([A-Za-z]{2})\s+\d{5}(?:-\d{4})?\b/;

  /** Rows that look like an address but belong to the statement, not a person. */
  const NOT_AN_ADDRESS = /\b(page \d|account number|statement|balance|deposits|withdrawals|member fdic)\b/i;

  function normalise(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  /** The row the holder's name was printed on. */
  function nameRow(lines, name) {
    const wanted = normalise(name).toLowerCase();
    if (!wanted) return -1;
    return lines.findIndex((line) => line.toLowerCase().includes(wanted));
  }

  /**
   * @param {string} text raw statement text
   * @param {{name?: string|null}} options the holder name already recovered
   * @returns {{street:string|null, town:string|null, state:string|null,
   *            postcode:string|null, full:string|null}}
   */
  function extractHolderAddress(text, options) {
    const none = { street: null, town: null, state: null, postcode: null, full: null };
    const lines = U.cleanLines(text);
    const start = nameRow(lines, options && options.name);
    if (start < 0) return none;

    let street = null;
    let poBox = null;

    for (let i = start + 1; i < Math.min(lines.length, start + 1 + REACH); i += 1) {
      const line = lines[i];
      if (NOT_AN_ADDRESS.test(line)) continue;

      if (!street) {
        // A mail-sort code can print in front of the house number:
        // "019749 808 BANKS AVE". The real number is the one a street follows.
        const withoutSortCode = line.replace(/^\d{5,}\s+(?=\d+\s+\D)/, '');
        const match = withoutSortCode.match(STREET);
        if (match) {
          street = normalise(match[1]);
          continue;
        }
        if (!poBox && PO_BOX.test(line)) poBox = line;
      }

      // The town line ends the block. Taking it only after a street has been
      // seen is what steps over the bank's own address in the next column.
      const town = line.match(TOWN);
      if (town && (street || poBox)) {
        const where = street || poBox;
        return {
          street: where,
          town: normalise(town[1]),
          state: town[2].toUpperCase(),
          postcode: town[3],
          full: `${where}, ${normalise(town[1])}, ${town[2].toUpperCase()} ${town[3]}`
        };
      }
    }

    return none;
  }

  /**
   * Are two addresses the same place?
   *
   * Not the same words: an application says "1201 Richardson Drive, Richardson,
   * TX 75080" and the bank writes to "1201 RICHARDSON DR STE 180, RICHARDSON,
   * TX 75080-4610". That is one address written twice, and reporting it as a
   * difference would bury the addresses that really are different. So the
   * comparison is on what identifies a place: the house number with the
   * postcode, or where there is no postcode, the house number with the town
   * and state.
   */
  function addressParts(value) {
    const text = String(value || '');
    const house = text.match(/\b\d+[A-Za-z]?\b/);
    const postcode = text.match(/\b(\d{5})(?:-\d{4})?\b/g);
    const town = text.match(TOWN_ANYWHERE);
    return {
      house: house ? house[0].toLowerCase() : null,
      // The last five-digit run is the postcode; an earlier one is the house.
      postcode: postcode && postcode.length ? postcode[postcode.length - 1].slice(0, 5) : null,
      town: town ? `${town[1].toLowerCase().trim()} ${town[2].toLowerCase()}` : null
    };
  }

  function sameAddress(a, b) {
    const left = addressParts(a);
    const right = addressParts(b);
    if (!left.house || !right.house || left.house !== right.house) return false;
    if (left.postcode && right.postcode) return left.postcode === right.postcode;
    if (left.town && right.town) return left.town === right.town;
    return false;
  }

  const api = { extractHolderAddress, sameAddress, STREET_TYPE, STREET_TYPE_WORDS };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.holderAddress = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
