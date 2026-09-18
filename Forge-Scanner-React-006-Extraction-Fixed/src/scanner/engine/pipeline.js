/* ============================================================
   pipeline.js — orchestrates the full extraction pipeline for one
   document, from raw text to a structured result object.
   Spec ref: section 28 (result object shape), section 48 (parser
   priority). Does not itself do PDF/OCR text extraction — the caller
   (browser adapter or Node test harness) supplies rawText plus a flag
   for whether OCR was needed, so this module stays runtime-agnostic
   and testable with plain strings.
   ============================================================ */
(function (root) {
  'use strict';

  function getEngine() {
    return root.ScannerEngine;
  }

  /**
   * @param {{
   *   fileId:string, filename:string, rawText:string, usedOcr:boolean,
   *   statedOpeningBalance?:number, statedEndingBalance?:number,
   * }} input
   * @returns {object} full document result, shaped per spec section 28.
   */
  function processDocument(input) {
    const E = getEngine();
    const text = input.rawText || '';

    const quality = E.textQuality.assessTextQuality(text);
    const docType = E.textQuality.classifyDocument(text);

    if (docType === 'application') {
      const appFields = E.applicationExtractor.extractApplicationFields(text, { filename: input.filename });
      const appHolder = E.companyName.extractCompanyName(text, { bank: null });
      return {
        scanId: input.fileId,
        status: quality.trusted ? 'complete' : 'needs_review',
        docType: 'application',
        sourceFile: { fileId: input.fileId, filename: input.filename },
        textQuality: quality,
        application: appFields,
        companyNameGuess: appFields.legalName || appFields.dba || appHolder.legalName || appHolder.dba || null,
        companyNameEvidence: appFields.legalName || appFields.dba ? 'application_form' : appHolder.evidence,
        dbaNameGuess: appFields.dba || appHolder.dba || null,
        confidence: { level: quality.trusted ? 'medium' : 'low', reasons: quality.trusted ? [] : [quality.reason] },
        reviewItems: quality.trusted ? [] : [{ type: 'low_text_quality', reason: quality.reason }],
      };
    }

    const bankRecognition = E.bankRecognizer.recognizeBank(text, { isOcr: input.usedOcr, filename: input.filename });
    const holder = E.companyName.extractCompanyName(text, { bank: bankRecognition.bank });
    const acct = E.accountNumber.extractAccountNumber(text);
    const period = E.statementDate.recoverStatementDate(text, input.filename);
    const isMtd = /month.?to.?date|\bmtd\b|current month activity|period\s+to\s+date/i.test(`${text} ${input.filename || ''}`);

    const statementYear = period && period.end ? Number(String(period.end).slice(0, 4)) : new Date().getFullYear();
    const transactions = E.transactionParser.parseTransactions(text, { statementYear });

    const summary = E.summaryExtractor.extractSummary(text, { usedOcr: !!input.usedOcr, filename: input.filename });
    const openingMatch = text.match(/(?:beginning|opening) balance[:\s]+\$?([\d,]+\.\d{2})/i);
    const endingMatch = text.match(/(?:ending|closing) balance[:\s]+\$?([\d,]+\.\d{2})/i);
    const opening = input.statedOpeningBalance ?? summary.beginning ?? (openingMatch ? Number(openingMatch[1].replace(/,/g, '')) : null);
    const ending = input.statedEndingBalance ?? summary.ending ?? (endingMatch ? Number(endingMatch[1].replace(/,/g, '')) : null);

    const reconciliation = E.reconciliation.reconcile({ opening, ending, transactions });
    if (Number.isFinite(summary.math_diff)) {
      reconciliation.difference = Number(summary.math_diff);
      reconciliation.reconciles = Math.abs(Number(summary.math_diff)) <= 1;
      reconciliation.source = 'v10_statement_summary';
    }

    const mcaAliasNames = E.mcaDetector.MCA_ALIASES.map((a) => a.name);
    const transactionDeposits = E.depositAnalysis.analyzeDeposits(transactions, { mcaAliasNames });
    const summaryDeposits = Number.isFinite(Number(summary.deposits)) ? Number(summary.deposits) : null;
    const transactionTrueRevenue = Number(transactionDeposits.trueRevenue) || 0;
    const deposits = {
      ...transactionDeposits,
      totalDeposits: summaryDeposits ?? transactionDeposits.totalDeposits,
      trueRevenue: transactionTrueRevenue > 0 ? transactionTrueRevenue : (summaryDeposits ?? transactionDeposits.trueRevenue),
      statementSummaryDeposits: summaryDeposits,
    };
    const expenses = E.expenseAnalysis.analyzeExpenses(transactions);
    const nsf = E.nsfDetector.detectNsfOverdraft(transactions);
    const transactionMca = E.mcaDetector.detectMcaPositions(transactions);
    const rawMca = E.mcaDetector.detectMcaFromText(text);
    const mcaPositions = E.mcaDetector.mergeMcaPositions(transactionMca, rawMca);
    const stacking = E.mcaDetector.stackingAnalysis(mcaPositions, deposits.trueRevenue);
    const dailyCashFlow = E.cashFlow.analyzeDailyCashFlow(transactions);
    const dailyBalance = E.cashFlow.analyzeDailyBalance(transactions);

    const reviewFlagged = transactions.filter((t) => t.reviewFlag).length;
    const reviewRatio = transactions.length ? reviewFlagged / transactions.length : 0;

    const confidence = E.confidenceEngine.scoreDocument({
      bankRecognized: !!bankRecognition.bank,
      textTrusted: quality.trusted,
      usedOcr: !!input.usedOcr,
      reconciles: reconciliation.reconciles,
      reviewFlaggedTxnRatio: reviewRatio,
    });

    const reviewItems = [];
    if (!bankRecognition.bank) reviewItems.push({ type: 'unknown_bank' });
    if (reconciliation.reconciles === false) reviewItems.push({ type: 'reconciliation_mismatch', difference: reconciliation.difference });
    if (!quality.trusted) reviewItems.push({ type: 'low_text_quality', reason: quality.reason });
    transactions.filter((t) => t.reviewFlag).forEach((t) => reviewItems.push({ type: 'uncertain_transaction', txnId: t.id }));
    mcaPositions.filter((p) => p.status === 'needs_review').forEach((p) => reviewItems.push({ type: 'potential_mca', funder: p.funder }));

    // The statement analysis above always runs, so nothing is lost. But a
    // document that produced no statement evidence at all is reported as what
    // it is rather than being labelled a bank statement on no grounds.
    // Number(null) is 0, which is finite — so a present-and-numeric check is
    // needed, not a bare Number.isFinite.
    const hasNumber = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
    const statementEvidence =
      Boolean(bankRecognition.bank) ||
      Boolean(acct.accountNumber) ||
      Boolean(period && (period.start || period.end)) ||
      hasNumber(summary.deposits) ||
      hasNumber(opening) ||
      hasNumber(ending) ||
      transactions.length > 0;
    const resolvedDocType = docType === 'bank_statement' || statementEvidence ? 'bank_statement' : docType;

    return {
      scanId: input.fileId,
      status: confidence.level === 'failed' ? 'failed' : reviewItems.length ? 'needs_review' : 'complete',
      docType: resolvedDocType,
      isMtd,
      sourceFile: { fileId: input.fileId, filename: input.filename },
      textQuality: quality,
      extractionMethod: input.usedOcr ? 'ocr' : 'native_text',
      companyNameGuess: holder.legalName || holder.dba || null,
      companyNameEvidence: holder.evidence,
      dbaNameGuess: holder.dba,
      bankAccount: {
        bank: bankRecognition.bank,
        bankConfidence: bankRecognition.confidence,
        accountNumber: acct.accountNumber,
        accountNumberMasked: acct.masked,
      },
      statementPeriod: period,
      balances: { opening, ending, withdrawals: summary.withdrawals ?? null },
      statementSummary: { deposits: summary.deposits ?? null, ending: summary.ending ?? null, beginning: summary.beginning ?? null, withdrawals: summary.withdrawals ?? null, confidence: summary.confidence ?? 0, evidence: summary.evidence ?? '' },
      transactions,
      reconciliation,
      deposits,
      expenses,
      nsf,
      mcaPositions,
      stacking,
      dailyCashFlow,
      dailyBalance,
      confidence,
      reviewItems,
    };
  }

  /**
   * Re-run every derived calculation from the (possibly corrected)
   * transaction list — never trust stale totals after a correction.
   */
  function recalculateAfterCorrection(doc) {
    const E = getEngine();
    const mcaAliasNames = E.mcaDetector.MCA_ALIASES.map((a) => a.name);

    doc.reconciliation = E.reconciliation.reconcile({ opening: doc.balances.opening, ending: doc.balances.ending, transactions: doc.transactions });
    doc.deposits = E.depositAnalysis.analyzeDeposits(doc.transactions, { mcaAliasNames });
    doc.expenses = E.expenseAnalysis.analyzeExpenses(doc.transactions);
    doc.nsf = E.nsfDetector.detectNsfOverdraft(doc.transactions);
    doc.mcaPositions = E.mcaDetector.detectMcaPositions(doc.transactions);
    doc.stacking = E.mcaDetector.stackingAnalysis(doc.mcaPositions, doc.deposits.trueRevenue);
    doc.dailyCashFlow = E.cashFlow.analyzeDailyCashFlow(doc.transactions);
    doc.dailyBalance = E.cashFlow.analyzeDailyBalance(doc.transactions);
    return doc;
  }

  const api = { processDocument, recalculateAfterCorrection };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.pipeline = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
