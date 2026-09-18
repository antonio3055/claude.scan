/* Bank recognition upgraded with ScannerCRM-v10 production rules. */
(function (root) {
  'use strict';

  const KNOWN_BANKS = [
    'Truist','Chase','Regions Bank','PNC Bank','Bank of America','Wells Fargo','TD Bank','U.S. Bank',
    'Citizens Bank','First Citizens Bank','City National Bank','M&T Bank','KeyBank','California Coast Credit Union',
    'BlueVine','Navy Federal Credit Union','Huntington Bank','Fifth Third Bank','Middlesex Federal Savings',
    'Thomaston Savings Bank','HomeTrust Bank','Valliance Bank','VyStar Credit Union','Visions Federal Credit Union',
    'Nano Banc','Carter Bank','Southern Bank','Old National Bank','KeyPoint Credit Union','Bluestone Federal Credit Union',
    'DFCU Financial Credit Union','Commerce Bank','Prosperity Bank','CNB','Indiana Members Credit Union','Farmers Bank'
  ];

  const OCR_RECOVERY_BANKS = ['Indiana Members Credit Union', 'Farmers Bank'];

  // The 120-line "header" window used below is wide enough to reach into the
  // transaction table, so a wire-transfer counterparty's bank name (e.g. an
  // incoming wire "FR JPMORGAN CHASE BANK" inside a Bank of America
  // statement) can match before the true letterhead is even considered,
  // because detection used to be first-match-wins by check order rather than
  // by position. TABLE_START_RE finds where the transaction table begins so
  // the true letterhead can be scored on position (earliest match wins)
  // before any counterparty text is in play.
  const TABLE_START_RE = /(deposits and other credits|other credits|checks and other debits|other debits|withdrawals and other debits|daily balance summary|transaction history|account activity|beginning balance|date\s+description\s+amount)/i;

  function getTrueHeader(lines) {
    const cap = 30;
    let end = cap;
    for (let i = 0; i < Math.min(lines.length, cap); i++) {
      if (TABLE_START_RE.test(lines[i])) { end = i; break; }
    }
    return lines.slice(0, Math.max(end, 6)).join('\n').toLowerCase();
  }

  const HEADER_RULES = [
    { bank: 'Truist', patterns: ['truist'] },
    { bank: 'Chase', patterns: ['jpmorgan chase bank', 'chase business', 'printed from chase for business'] },
    { bank: 'Regions Bank', patterns: ['regions bank'] },
    { bank: 'PNC Bank', patterns: ['pnc bank'] },
    { bank: 'Bank of America', patterns: ['bank of america'] },
    { bank: 'Wells Fargo', patterns: ['wells fargo'] },
    { bank: 'TD Bank', patterns: ['td bank'] },
    { bank: 'U.S. Bank', patterns: ['u.s. bank', 'us bank'] },
    { bank: 'Citizens Bank', patterns: ['citizens bank'] },
    { bank: 'First Citizens Bank', patterns: ['first citizens bank'] },
    { bank: 'City National Bank', patterns: ['city national bank'] },
    { bank: 'M&T Bank', patterns: ['m&t bank', 'm and t bank'] },
    { bank: 'KeyBank', patterns: ['keybank'] },
    { bank: 'California Coast Credit Union', patterns: ['california coast credit union'] },
    { bank: 'BlueVine', patterns: ['bluevine'] },
    { bank: 'Navy Federal Credit Union', patterns: ['navy federal credit union'] },
    { bank: 'Huntington Bank', patterns: ['huntington national bank'] },
    { bank: 'Fifth Third Bank', patterns: ['fifth third bank'] },
    { bank: 'Middlesex Federal Savings', patterns: ['middlesex federal'] },
    { bank: 'Visions Federal Credit Union', patterns: ['visions federal credit union'] },
    { bank: 'Old National Bank', patterns: ['old national'] },
    { bank: 'KeyPoint Credit Union', patterns: ['keypoint'] },
    { bank: 'Bluestone Federal Credit Union', patterns: ['bluestone federal'] },
    { bank: 'DFCU Financial Credit Union', patterns: ['the cash back'] },
  ];

  function earliestIndex(headerText, patterns) {
    let idx = Infinity;
    for (const p of patterns) {
      const i = headerText.indexOf(p);
      if (i !== -1 && i < idx) idx = i;
    }
    return idx;
  }

  function nanoBancIndex(headerText) {
    const a = headerText.indexOf('nano');
    const b = headerText.indexOf('ban');
    if (a === -1 || b === -1) return Infinity;
    return Math.max(a, b);
  }

  function detectFromTrueHeader(headerText) {
    let bestBank = null;
    let bestIndex = Infinity;
    for (const rule of HEADER_RULES) {
      const idx = earliestIndex(headerText, rule.patterns);
      if (idx < bestIndex) { bestIndex = idx; bestBank = rule.bank; }
    }
    const nanoIdx = nanoBancIndex(headerText);
    if (nanoIdx < bestIndex) { bestIndex = nanoIdx; bestBank = 'Nano Banc'; }
    return bestBank;
  }

  function detectBank(text, filename) {
    const U = root.ScannerEngine.coreUtils;
    const lines = U.cleanLines(text);

    const positionMatch = detectFromTrueHeader(getTrueHeader(lines));
    if (positionMatch) return positionMatch;

    const header = lines.slice(0, 120).join('\n').toLowerCase();
    const all = String(text || '').toLowerCase();
    const f = String(filename || '').toLowerCase();
    if (header.includes('truist')) return 'Truist';
    if (header.includes('jpmorgan chase bank') || header.includes('chase business') || header.includes('printed from chase for business')) return 'Chase';
    if (header.includes('regions bank') || all.includes('1-800-regions')) return 'Regions Bank';
    if (header.includes('pnc bank')) return 'PNC Bank';
    if (header.includes('bank of america')) return 'Bank of America';
    if (header.includes('wells fargo') || all.includes('wellsfargo.com')) return 'Wells Fargo';
    if (header.includes('td bank') || all.includes('tdbank.com')) return 'TD Bank';
    if (header.includes('u.s. bank') || header.includes('us bank') || all.includes('usbank.com')) return 'U.S. Bank';
    if (header.includes('citizens bank') || all.includes('citizensbank.com')) return 'Citizens Bank';
    if (header.includes('first citizens bank') || all.includes('firstcitizens.com') || all.includes('1-866-322-4249')) return 'First Citizens Bank';
    if (header.includes('city national bank') || all.includes('cnb.com')) return 'City National Bank';
    if (header.includes('m&t bank') || header.includes('m and t bank') || all.includes('mtb.com')) return 'M&T Bank';
    if (header.includes('keybank') || all.includes('key.com')) return 'KeyBank';
    if (header.includes('california coast credit union') || all.includes('calcoastcu.org') || all.includes('bank name: cal coast')) return 'California Coast Credit Union';
    if (header.includes('bluevine') || all.includes('bluevine.com')) return 'BlueVine';
    if (header.includes('navy federal credit union') || all.includes('navyfederal.org')) return 'Navy Federal Credit Union';
    if (header.includes('huntington national bank') || all.includes('huntington.com')) return 'Huntington Bank';
    if (header.includes('fifth third bank') || all.includes('53.com')) return 'Fifth Third Bank';
    if (header.includes('middlesex federal') || all.includes('middlesexfederal.com')) return 'Middlesex Federal Savings';
    if (all.includes('thomastonsb.com')) return 'Thomaston Savings Bank';
    if (all.includes('htb.com')) return 'HomeTrust Bank';
    if (all.includes('vbank.com')) return 'Valliance Bank';
    if (all.includes('vystarcu.org')) return 'VyStar Credit Union';
    if (header.includes('visions federal credit union') || all.includes('visionsfcu.org')) return 'Visions Federal Credit Union';
    if (header.includes('nano') && header.includes('ban')) return 'Nano Banc';
    if (all.includes('carterbank.com')) return 'Carter Bank';
    if (all.includes('bankwithsouthern.com')) return 'Southern Bank';
    if (/\bcnb\b/i.test(f)) return 'CNB';
    if (header.includes('old national') || f.includes('old national')) return 'Old National Bank';
    if (header.includes('keypoint') || all.includes('kpcu.com')) return 'KeyPoint Credit Union';
    if (all.includes('bluestonefcu') || header.includes('bluestone federal')) return 'Bluestone Federal Credit Union';
    if (all.includes('dfcu') || header.includes('the cash back')) return 'DFCU Financial Credit Union';
    if (all.includes('800-453-bank') || all.includes('mybusiness checking')) return 'Commerce Bank';
    if (all.includes('nyse symbol "pb"')) return 'Prosperity Bank';
    if ((all.includes('indiana') && (all.includes('members credit union') || all.includes('imcu.com')))) return 'Indiana Members Credit Union';
    if (all.includes('farmers') && (all.includes('thefarmersbank') || f.includes('farmers'))) return 'Farmers Bank';
    return null;
  }

  function recognizeBank(text, opts) {
    const bank = detectBank(text, opts?.filename || '');
    return {
      bank,
      confidence: bank ? 'high' : 'unknown',
      evidence: bank || null,
      ocrRecoveryBank: !!bank && OCR_RECOVERY_BANKS.includes(bank),
    };
  }

  const api = { KNOWN_BANKS, OCR_RECOVERY_BANKS, detectBank, recognizeBank };
  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.bankRecognizer = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
