/* ============================================================
   textQuality.js — embedded-text quality gate + doc classification.
   Spec ref: sections 8, 70.
   Decides whether native PDF text is trustworthy enough to parse
   directly, or whether the OCR fallback path must run instead.
   Pure functions only — no DOM, no fetch. Works in browser <script>
   tag (attaches to globalThis.ScannerEngine) and in Node (module.exports)
   from the same file, so there is exactly one implementation.
   ============================================================ */
(function (root) {
  'use strict';

  // Phrases that indicate real bank-statement content. At least MIN_SIGNALS
  // of these must appear before native text is trusted (spec section 70).
  const STATEMENT_SIGNAL_PHRASES = [
    'account statement',
    'beginning balance',
    'ending balance',
    'transaction description',
    'statement period',
    'account summary',
    'deposits and other credits',
    'checks and other debits',
    'daily balance',
  ];

  const MIN_SIGNALS = 2;
  const MIN_MEANINGFUL_CHARS = 200;

  /**
   * @param {string} rawText - text extracted natively from a PDF page/doc.
   * @returns {{trusted:boolean, signalsFound:string[], charCount:number, reason:string}}
   */
  function assessTextQuality(rawText) {
    const text = (rawText || '').toLowerCase();
    const charCount = text.replace(/\s+/g, '').length;

    const signalsFound = STATEMENT_SIGNAL_PHRASES.filter((p) => text.includes(p));

    // DocuSign / cover-page detector: lots of boilerplate, no statement signal.
    const looksLikeEnvelopeOnly =
      /docusign|envelope id|certificate of completion|signed by:/i.test(rawText || '') &&
      signalsFound.length === 0;

    let trusted = true;
    let reason = 'ok';

    if (charCount < MIN_MEANINGFUL_CHARS) {
      trusted = false;
      reason = 'insufficient_text';
    } else if (signalsFound.length < MIN_SIGNALS) {
      trusted = false;
      reason = 'no_statement_signal';
    } else if (looksLikeEnvelopeOnly) {
      trusted = false;
      reason = 'envelope_only_text';
    }

    return { trusted, signalsFound, charCount, reason };
  }

  /**
   * Very small, evidence-based document type guess. Never invents a type
   * it can't support with a signal.
   */
  function classifyDocument(rawText) {
    const text = (rawText || '').toLowerCase();
    const bankSignals = STATEMENT_SIGNAL_PHRASES.filter((p) => text.includes(p)).length;
    const appSignals = [
      'application',
      'requested funding amount',
      'ownership percentage',
      'ein',
      'ssn',
      'date of birth',
    ].filter((p) => text.includes(p)).length;

    if (bankSignals >= MIN_SIGNALS && bankSignals >= appSignals) return 'bank_statement';
    if (appSignals >= 2) return 'application';
    if (charSafe(text) === 0) return 'unreadable';
    return 'unknown';
  }

  function charSafe(t) {
    return (t || '').replace(/\s+/g, '').length;
  }

  const api = { assessTextQuality, classifyDocument, STATEMENT_SIGNAL_PHRASES, MIN_SIGNALS, MIN_MEANINGFUL_CHARS };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.textQuality = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
