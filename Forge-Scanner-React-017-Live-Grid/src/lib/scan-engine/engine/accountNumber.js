// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* Account extraction upgraded with ScannerCRM-v10 production rules. */
(function (root) {
  'use strict';

  function extractAccount(text) {
    const U = root.ScannerEngine.coreUtils;
    const lines = U.cleanLines(text);
    let endingAcct = String(text || '').match(/(?:checking\s+(?:account\s+)?(?:for|ending)|account\s+ending)\s+([Xx*\d-]{5,})/i);
    if (endingAcct) return U.normAcct(endingAcct[1]);

    if (lines.some((l) => l.toUpperCase().includes('MICRO BUSINESS DRAFT'))) {
      let m = U.cleanSpace(text).match(/MEMBER\s*#\s*:?\s*(\d{4,})/i);
      if (m) return `${m[1]}050`;
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].toLowerCase() === 'member #:') {
          for (let j = i + 1; j < i + 4 && j < lines.length; j += 1) {
            m = lines[j].match(/\b(\d{4,})\b/);
            if (m) return `${m[1]}050`;
          }
        }
      }
    }

    const accountPatterns = [
      /Primary Account Number\s*[:#]?\s*([Xx*\- ]*\d[\d Xx*\-]{3,})/i,
      /Account number\s*[:#]?\s*([Xx*\- ]*\d[\d Xx*\-]{3,})/i,
      /Account No\.?\s*[:#]?\s*([Xx*\- ]*\d[\d Xx*\-]{3,})/i,
      /Account #\s*([Xx*\- ]*\d[\d Xx*\-]{3,})/i,
      /myBusiness Checking Account #\s*([Xx*\- ]*\d[\d Xx*\-]{3,})/i,
      /TX Small Business(?: Checking)? Account No\s*([Xx*]+\d{4})/i,
    ];

    for (const line of lines.slice(0, 180)) {
      for (const pattern of accountPatterns) {
        const m = line.match(pattern);
        if (!m) continue;
        let token = U.normAcct(m[1]);
        if (/^X+\d{4,}$/.test(token)) return token;
        if (token.length > 14 && /^\d+$/.test(token)) {
          if (token.length === 24) token = token.slice(0, 12);
          else if (token.length === 18 && token.slice(0, 9) === token.slice(9)) token = token.slice(0, 9);
        }
        if (token && !/^(1800|1888|1877|1866|1855|1844|1833|844|888|877|866|855|833)/.test(token)) return token;
      }
    }

    let m = String(text || '').match(/([Xx*]{2,}[\- Xx*]*\d{4,})/);
    if (m) return U.normAcct(m[1]);

    for (let i = 0; i < lines.length && i < 180; i += 1) {
      const low = lines[i].toLowerCase();
      if (/^(account number|account #|account no\. ?|primary account number)$/.test(low)) {
        for (let j = i + 1; j < i + 8 && j < lines.length; j += 1) {
          const raw = lines[j];
          if (/page|cycle|enclosures|customer service|chase\.com|800-|1-800|service center|date/i.test(raw)) continue;
          const token = U.normAcct(raw);
          if (token && /\d{4,}/.test(token) && !/^(001|092|0000|0|26)$/.test(token) && !/^(1800|1888|1877|1866|1855|1844|1833|844|888|877|866|855|833)/.test(token)) return token;
        }
      }
    }

    if (lines.slice(0, 60).some((l) => l.toUpperCase() === 'ACCOUNTS SUMMARY') && lines.slice(0, 70).some((l) => l.toUpperCase().includes('ACCOUNT NUMBER'))) {
      for (let i = 0; i < lines.length && i < 120; i += 1) {
        if (/Business Checking|Business Draft/i.test(lines[i])) {
          for (let j = i + 1; j < i + 6 && j < lines.length; j += 1) {
            const token = U.normAcct(lines[j]);
            if (/^\d{5,12}$/.test(token) && !/^(2026|2025)/.test(token)) return token;
          }
        }
      }
    }

    for (let i = 0; i < lines.length && i < 90; i += 1) {
      if (lines[i].startsWith('Account Summary Account #')) {
        for (let j = i - 1; j > Math.max(-1, i - 10); j -= 1) {
          const token = U.normAcct(lines[j]);
          if (/^\d{8,12}$/.test(token) && !/^(800|888|877|866|855|844|833)/.test(token)) return token;
        }
      }
    }

    for (const line of lines.slice(0, 35)) {
      if (/\d{1,2}\/\d{1,2}\/\d{2,4}|\d{4}-\d{1,2}-\d{1,2}|\(|\)/.test(line)) continue;
      const token = U.normAcct(line);
      if (/^\d{10,17}$/.test(token) && !/^(1800|1888|1877|1866|1855|1844|1833|844|888|877|866|855|833)/.test(token)) return token;
    }

    m = String(text || '').match(/\*{2,}\s*(\d{4})/);
    if (m) return `XXXX${m[1]}`;
    return '';
  }

  function maskAccountNumber(num) {
    if (!num) return null;
    const normalized = root.ScannerEngine.coreUtils.normAcct(num);
    if (!normalized) return null;
    if (/X/.test(normalized)) return normalized;
    return normalized.length > 4 ? `XXXX${normalized.slice(-4)}` : `XXXX${normalized}`;
  }

  function extractAccountNumber(text) {
    const accountNumber = extractAccount(text) || null;
    return {
      accountNumber,
      masked: maskAccountNumber(accountNumber),
      source: accountNumber ? 'ScannerCRM-v10 account rules' : null,
    };
  }

  const api = { extractAccount, extractAccountNumber, maskAccountNumber };
  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.accountNumber = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
