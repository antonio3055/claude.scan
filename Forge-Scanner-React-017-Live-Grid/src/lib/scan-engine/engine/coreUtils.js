// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* Shared extraction helpers adapted from ScannerCRM-v10 production core. */
(function (root) {
  'use strict';

  const MONTH_LABEL = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  function cleanSpace(value) { return String(value || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim(); }
  function cleanLines(text) { return String(text || '').split(/\r?\n/).map(cleanSpace).filter(Boolean); }
  function digits(value) { return String(value || '').replace(/\D/g, ''); }

  function moneyVals(text) {
    const out = [];
    const source = String(text || '');
    const re = /\(?\$?\s*([0-9]{1,3}(?:,[0-9]{3})+(?:\.\d{2})?|[0-9]{4,}(?:\.\d{2})?|[0-9]{1,3}\.\d{2})\)?/g;
    let m;
    while ((m = re.exec(source))) {
      const raw = m[0];
      const bareDigits = raw.replace(/\D/g, '');
      if (bareDigits.length >= 7 && !/[,$.]/.test(raw)) continue;
      let value = parseFloat(m[1].replace(/,/g, ''));
      const chunk = source.slice(Math.max(0, m.index - 3), Math.min(source.length, re.lastIndex + 3));
      if (chunk.includes('-') || (chunk.includes('(') && chunk.includes(')'))) value = -value;
      if (Math.abs(value) <= 50000000) out.push(value);
    }
    return out;
  }

  function moneyAbs(text) {
    const values = moneyVals(text).filter((v) => !(Math.abs(v) >= 2020 && Math.abs(v) <= 2030));
    return values.length ? Math.abs(values[0]) : null;
  }

  function normAcct(value) {
    return String(value || '')
      .replace(/\u00a0/g, ' ')
      .replace(/[^0-9Xx*\- ]/g, '')
      .trim()
      .replace(/\s+/g, '')
      .replace(/[x*]/g, 'X')
      .replace(/-/g, '');
  }

  function parseDate(value) {
    const s = cleanSpace(value).replace(/,/g, '');
    let m = s.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
    if (m) {
      let y = Number(m[3]);
      if (y < 100) y += y >= 30 ? 1900 : 2000;
      return new Date(y, Number(m[1]) - 1, Number(m[2]));
    }
    m = s.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})\s+(\d{4})\b/i);
    if (m) {
      const month = ['january','february','march','april','may','june','july','august','september','october','november','december'].indexOf(m[1].toLowerCase());
      return new Date(Number(m[3]), month, Number(m[2]));
    }
    m = s.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[\s\/-]+(\d{1,2})[\s\/-]+(\d{2,4})\b/i);
    if (m) {
      const month = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(m[1].slice(0,3).toLowerCase());
      let year = Number(m[3]);
      if (year < 100) year += year >= 30 ? 1900 : 2000;
      return new Date(year, month, Number(m[2]));
    }
    return null;
  }

  function isoDate(date) {
    if (!date || Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  }

  function nextMoney(lines, index, count = 4) {
    for (let j = index + 1; j < Math.min(lines.length, index + 1 + count); j += 1) {
      const value = moneyAbs(lines[j]);
      if (value != null) return [value, j, lines[j]];
    }
    return [null, null, ''];
  }

  function prevMoney(lines, index, count = 7) {
    for (let j = index - 1; j > Math.max(-1, index - 1 - count); j -= 1) {
      const value = moneyAbs(lines[j]);
      if (value != null) return [value, j, lines[j]];
    }
    return [null, null, ''];
  }

  function displayAccount(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = normAcct(raw);
    if (!normalized) return '';
    if (/X/.test(normalized)) return normalized;
    return normalized;
  }

  const api = {
    MONTH_LABEL,
    cleanSpace,
    cleanLines,
    digits,
    moneyVals,
    moneyAbs,
    normAcct,
    parseDate,
    isoDate,
    nextMoney,
    prevMoney,
    displayAccount,
  };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.coreUtils = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
