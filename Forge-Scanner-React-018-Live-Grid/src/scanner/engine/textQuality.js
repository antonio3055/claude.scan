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

  // Phrases that indicate a funding application. Drawn from the wording real
  // application PDFs actually use, not from an idealised form. Each entry is a
  // whole phrase: single tokens like 'ein' matched inside ordinary words and
  // were worthless as evidence.
  const APPLICATION_SIGNAL_PHRASES = [
    'legal company name',
    'business owner information',
    'company information',
    'requested financing amount',
    'requested funding amount',
    'use of funds',
    'average monthly revenue',
    'monthly credit card processing',
    'business start date',
    'ownership percentage',
    '% ownership',
    'social security no',
    'date of birth',
    'incorporation state',
    'legal entity',
    'merchant application',
    'funding application',
    'existing business loan',
    // Wording from the many other application forms brokers send, not just
    // one: each seen on real applications that were otherwise misread as
    // statements.
    'business legal name',
    'legal business name',
    'business name',
    'company name',
    'legal/corporate name',
    'doing business as',
    'federal tax id',
    'tax id',
    'social security',
    'birth date',
    'percent ownership',
    '% of ownership',
    'ownership %',
    'credit score',
    'fico score',
    'owner information',
    'owner details',
    'principal information',
    'business information',
    'business details',
    'home address',
    'state of incorporation',
    'type of entity',
    'entity type',
    'legal structure',
    'amount requested',
    'loan amount',
    'funding amount',
    'gross annual sales',
    'annual revenue',
    'monthly sales',
  ];

  /**
   * Application wording counted as whole phrases: "tax id" is evidence,
   * "syntax identifier" is not.
   */
  function applicationPhrasesIn(text) {
    return APPLICATION_SIGNAL_PHRASES.filter((phrase) => {
      const escaped = phrase.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      return new RegExp(`(?:^|[^a-z0-9])${escaped}(?![a-z0-9])`).test(text);
    });
  }

  const PHONE_LINE = /^(?:\+?1[\s.\-]?)?\(?[2-9]\d{2}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}$/;
  const EMAIL_LINE = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
  const CONTACT_LABEL_LINE = /^(?:mobile|cell|residential|landline|home|work|business|phone|phones|email|emails|e-mail|other)$/i;

  /**
   * A list of phone numbers and email addresses and nothing else -- the
   * contact sheet some brokers file as "APP.pdf" alongside, or instead of,
   * the application itself. No application form fields, but real contact
   * details worth keeping.
   */
  function isContactSheet(rawText) {
    const lines = String(rawText || '').split(/\n+/).map((line) => line.trim()).filter(Boolean);
    let data = 0;
    let labels = 0;
    for (const line of lines) {
      const tokens = line.split(/\s+/);
      if (tokens.every((token) => PHONE_LINE.test(token) || EMAIL_LINE.test(token))) data += 1;
      else if (PHONE_LINE.test(line)) data += 1;
      else if (CONTACT_LABEL_LINE.test(line)) labels += 1;
    }
    return data >= 2 && (data + labels) / lines.length >= 0.8;
  }

  /**
   * Is the extracted text good enough to parse directly?
   *
   * A document is judged against the wording of its own kind: an application
   * form has no beginning balance to find, and marking one down for that said
   * nothing about whether its text was readable.
   *
   * A statement whose printed balance equation adds up is readable by proof,
   * whatever wording it uses — some banks set the summary in two columns, so
   * "beginning" and "balance" never land next to each other.
   *
   * @param {string} rawText text extracted natively from a PDF page/doc.
   * @param {{docType?:string, provenArithmetic?:boolean}} [options]
   * @returns {{trusted:boolean, signalsFound:string[], charCount:number, reason:string}}
   */
  function assessTextQuality(rawText, options) {
    const text = (rawText || '').toLowerCase();
    const charCount = text.replace(/\s+/g, '').length;
    const isApplication = options?.docType === 'application';
    const signalsFound = isApplication
      ? applicationPhrasesIn(text)
      : STATEMENT_SIGNAL_PHRASES.filter((p) => text.includes(p));

    // DocuSign / cover-page detector: lots of boilerplate, no content signal.
    const looksLikeEnvelopeOnly =
      /docusign|envelope id|certificate of completion|signed by:/i.test(rawText || '') &&
      signalsFound.length === 0;

    let trusted = true;
    let reason = 'ok';

    if (charCount < MIN_MEANINGFUL_CHARS) {
      trusted = false;
      reason = 'insufficient_text';
    } else if (options?.provenArithmetic) {
      reason = 'statement_arithmetic_proven';
    } else if (signalsFound.length < MIN_SIGNALS) {
      trusted = false;
      reason = isApplication ? 'no_application_signal' : 'no_statement_signal';
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
    const appSignals = applicationPhrasesIn(text).length;

    if (bankSignals >= MIN_SIGNALS && bankSignals >= appSignals) return 'bank_statement';
    if (appSignals >= MIN_SIGNALS) return 'application';
    if (charSafe(text) === 0) return 'unreadable';
    return 'unknown';
  }

  function charSafe(t) {
    return (t || '').replace(/\s+/g, '').length;
  }

  const api = {
    assessTextQuality,
    classifyDocument,
    isContactSheet,
    applicationPhrasesIn,
    STATEMENT_SIGNAL_PHRASES,
    APPLICATION_SIGNAL_PHRASES,
    MIN_SIGNALS,
    MIN_MEANINGFUL_CHARS,
  };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.textQuality = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
