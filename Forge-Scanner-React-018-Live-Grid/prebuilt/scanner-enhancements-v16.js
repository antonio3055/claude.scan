/* Scanner v16: native-engine extraction integrity. Do not merge parser passes. */
(function (root) {
  'use strict';
  const cleaned = (value) => String(value ?? '').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
  const phonePattern = /(?:\+?1[\s.-]?)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b/g;

  function extractLabeled(lines, patterns) {
    for (let i = 0; i < lines.length; i++) {
      for (const pattern of patterns) {
        const match = lines[i].match(pattern);
        if (!match) continue;
        const direct = cleaned(match[1]);
        if (direct && !/^(?:name|email|phone|address|date|number|information|details)$/i.test(direct)) return direct;
        const following = cleaned(lines[i + 1]);
        if (following && !/^(?:name|email|phone|address|date|number|information|details)$/i.test(following)) return following;
      }
    }
    return null;
  }

  function enrichApplication(rawText, existing) {
    if (!existing) return existing;
    const lines = String(rawText || '').replace(/\r/g, '').split('\n').map(cleaned);
    const fields = [
      ['legalName', [/^legal\s+(?:business|company)\s+name\s*[:\-]?\s*(.*)$/i, /^business\s+legal\s+name\s*[:\-]?\s*(.*)$/i]],
      ['dba', [/^dba\s*[:\-]\s*(.*)$/i]],
      ['fullName', [/^(?:owner\s*\d*\s+(?:full\s+)?name|primary\s+owner|full\s+legal\s+name)\s*[:\-]?\s*(.*)$/i]],
      ['businessStartDate', [/^(?:business\s+start\s+date|date\s+business\s+started)\s*[:\-]?\s*(.*)$/i]]
    ];
    const app = {...existing};
    for (const [name, patterns] of fields) if (!app[name] && name !== 'businessStartDate') {
      const value = extractLabeled(lines, patterns);
      if (value) app[name] = value;
    }
    // Only take contact details explicitly linked to the applicant or owner.
    for (const [key, pattern, label] of [
      ['phones', phonePattern, /\b(?:owner|principal|applicant|contact|mobile|cell|phone)\b/i],
      ['emails', emailPattern, /\b(?:owner|principal|applicant|contact|email|e-mail)\b/i]
    ]) {
      const prior = Array.isArray(app[key]) ? app[key].filter(Boolean) : [];
      const candidates = [];
      for (const line of lines) {
        if (!label.test(line) || /\b(?:bank|customer service|support|funder|fax|no[- ]?reply)\b/i.test(line)) continue;
        for (const hit of line.match(pattern) || []) candidates.push(cleaned(hit));
      }
      app[key] = [...new Set([...prior, ...candidates])].slice(0, 3);
    }
    return app;
  }

  function install() {
    const engine = root.ScannerEngine;
    if (!engine?.pipeline?.processDocument) return false;
    if (engine.pipeline.__v16Installed) return true;
    const processNative = engine.pipeline.processDocument.bind(engine.pipeline);
    engine.pipeline.processDocument = function (input) {
      const result = processNative(input);
      if (result.docType === 'application') result.application = enrichApplication(input.rawText, result.application);
      if (result.docType === 'bank_statement' && result.deposits) {
        const summaryProven = result.reconciliation?.source === 'statement_balance_equation'
          && result.reconciliation?.reconciles === true;
        const printed = Number(result.reconciliation?.statementDeposits ?? result.statementSummary?.deposits);
        const parsed = Number(result.deposits.grossDeposits);
        const hasTotals = result.reconciliation?.statementDeposits != null
          && Number.isFinite(printed) && Number.isFinite(parsed);
        const totalsAgree = hasTotals && Math.abs(printed - parsed) <= 0.02;
        const completePages = !result.truncated && !result.needsOcr;
        const candidate = Number(result.deposits.trueRevenue);
        const hasReportedDeposits = result.statementSummary?.deposits != null
          && Number.isFinite(Number(result.statementSummary.deposits));
        const exceedsReportedDeposits = hasReportedDeposits
          && Number.isFinite(candidate)
          && candidate > Number(result.statementSummary.deposits) + 0.02;
        const contradiction = (summaryProven && hasTotals && !totalsAgree) || exceedsReportedDeposits;
        const unverified = !completePages || contradiction;
        if (unverified) {
          // Do not turn an incomplete or contradictory transaction sum into
          // a verified monthly-revenue figure. Keep it for review only.
          result.deposits = {
            ...result.deposits,
            unverifiedRevenueCandidate: result.deposits.trueRevenue,
            trueRevenue: null,
            trueRevenueSource: 'unverified',
            revenueVerified: false,
            revenueUnverifiedReason: !completePages ? 'incomplete_page_extraction' : (exceedsReportedDeposits ? 'revenue_exceeds_reported_deposits' : 'transaction_deposits_do_not_match_bank_summary'),
            parsedGrossDeposits: parsed,
            printedStatementDeposits: hasTotals ? printed : null
          };
          result.reviewItems = [...(result.reviewItems || []), {
            type: !completePages ? 'revenue_unverified_incomplete' : 'revenue_unverified_deposit_mismatch',
            reason: result.deposits.revenueUnverifiedReason,
            printedStatementDeposits: hasTotals ? printed : null,
            parsedGrossDeposits: parsed
          }];
          if (result.status !== 'failed') result.status = 'needs_review';
        } else {
          result.deposits = { ...result.deposits, revenueVerified: summaryProven && totalsAgree };
        }
      }
      // No additional transaction pass, date guesses, financing estimates or
      // arithmetic replacement: retain the engine's original evidence.
      result.extractionIntegrity = {
        version: 'v16', source: 'native_scanner_engine',
        transactions: result.transactions?.length ?? 0,
        statementVerified: result.reconciliation?.source === 'statement_balance_equation' && result.reconciliation?.reconciles === true,
        truncated: !!result.truncated
      };
      return result;
    };
    engine.pipeline.__v16Installed = true;
    return true;
  }
  if (!install()) {
    let attempts = 0;
    const timer = setInterval(() => {
      if (install() || ++attempts >= 200) clearInterval(timer);
    }, 25);
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = {enrichApplication, install};
})(typeof window !== 'undefined' ? window : globalThis);
