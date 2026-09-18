// @ts-nocheck -- ported verbatim from Forge-Scanner-React-016-Full-Document, verified there by its own Node test suite (checkJs:false there too).
/* ============================================================
   companyAggregator.js — company-level file grouping.
   Spec ref: sections 29, 30, 31, 75, 76.
   Groups processed documents by company, keeps application records
   separate from bank records, keeps MTD separate from completed
   statements, and dedupes same-statement-different-filename uploads.
   ============================================================ */
(function (root) {
  'use strict';

  // One authoritative key rule, owned by companyName.js.
  function normalizeCompanyKey(name) {
    return root.ScannerEngine.companyName.companyKey(name);
  }

  /**
   * @param {Array<object>} docs - each a processed document result with
   *   { companyNameGuess, docType: 'bank_statement'|'application'|'unknown',
   *     isMtd, statementPeriod:{start,end}, fileHash, confidence, ... }
   */
  function aggregateByCompany(docs) {
    const companies = {};

    for (const doc of docs) {
      const key = normalizeCompanyKey(doc.companyNameGuess);
      companies[key] = companies[key] || {
        companyKey: key,
        companyNameGuess: doc.companyNameGuess || 'Unassociated',
        applicationDocs: [],
        bankStatements: [],
        mtdDocs: [],
        unknownDocs: [],
        sourceFileIds: [],
      };

      const bucket = companies[key];
      bucket.sourceFileIds.push(doc.fileId);

      if (doc.docType === 'application') {
        bucket.applicationDocs.push(doc);
      } else if (doc.docType === 'bank_statement' && doc.isMtd) {
        bucket.mtdDocs.push(doc);
      } else if (doc.docType === 'bank_statement') {
        bucket.bankStatements.push(doc);
      } else {
        bucket.unknownDocs.push(doc);
      }
    }

    // Dedupe bank statements covering the same period; keep the higher-confidence one.
    Object.values(companies).forEach((bucket) => {
      bucket.bankStatements = dedupeByPeriod(bucket.bankStatements);
      bucket.bankStatements.sort((a, b) => (b.statementPeriod?.end || '').localeCompare(a.statementPeriod?.end || ''));
    });

    return Object.values(companies);
  }

  function dedupeByPeriod(statements) {
    const byPeriod = {};
    for (const s of statements) {
      const key = `${s.statementPeriod?.start || ''}_${s.statementPeriod?.end || ''}`;
      if (!byPeriod[key] || confidenceRank(s) > confidenceRank(byPeriod[key])) {
        byPeriod[key] = s;
      }
    }
    return Object.values(byPeriod);
  }

  function confidenceRank(doc) {
    const order = { high: 3, medium: 2, low: 1, needs_review: 0, failed: -1 };
    return order[doc.confidence?.level] ?? 0;
  }

  const api = { aggregateByCompany, normalizeCompanyKey };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.companyAggregator = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
