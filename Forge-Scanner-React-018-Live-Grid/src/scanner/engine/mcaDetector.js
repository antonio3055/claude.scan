/* ============================================================
   mcaDetector.js — Merchant Cash Advance detection.
   Spec ref: sections 10-14, 63-66.
   Carries forward the EXACT alias dictionary, exclusion list, Capital
   One safeguard, and occurrence-based frequency thresholds from the
   verified prior source (spec sections 63-66) — improved with real
   transaction dates for cadence instead of relying on match-count
   alone, per section 66's explicit instruction to do so.
   ============================================================ */
(function (root) {
  'use strict';

  // Exact dictionary from spec section 63.
  const MCA_ALIASES = [
    { name: 'FundX', aliases: ['fundx', 'fund x'] },
    { name: 'Forward Financing', aliases: ['forward financing', 'forward financin', 'forwardfinance'] },
    { name: 'Shopify Capital', aliases: ['shopify capital', 'shopify repay', 'shopify repayments'] },
    { name: 'Expansion Capital', aliases: ['expansioncap', 'expansion capital', 'expansion cap'] },
    { name: 'Fintech Capital', aliases: ['fintech capital', 'fintechcapital'] },
    { name: 'Forest Capital', aliases: ['forest capital'] },
    { name: 'Millstone Funding', aliases: ['millstone fundin', 'millstone funding', 'millstone fund'] },
    { name: 'Flow Capital', aliases: ['flow capital'] },
    { name: 'Barclays Advance', aliases: ['barclays advance'] },
    { name: 'Viking Funding', aliases: ['viking funding', 'viking funding ii', 'viking funding i i'] },
    { name: 'Giggle Finance', aliases: ['giggle finance'] },
    { name: 'DoorDash Capital', aliases: ['doordash capital', 'door dash capital'] },
    { name: 'OnDeck', aliases: ['ondeck', 'on deck'] },
    { name: 'Rapid Finance', aliases: ['rapid finance'] },
    { name: 'Kapitus', aliases: ['kapitus'] },
    { name: 'Fora Financial', aliases: ['fora financial'] },
    { name: 'Credibly', aliases: ['credibly'] },
    { name: 'National Funding', aliases: ['national funding'] },
    { name: 'Everest Business Funding', aliases: ['everest business funding', 'everest funding'] },
    { name: 'QuickBridge', aliases: ['quickbridge', 'quick bridge'] },
    { name: 'Square Capital', aliases: ['square capital'] },
    { name: 'PayPal Working Capital', aliases: ['paypal working capital', 'paypal wc'] },
    { name: 'Stripe Capital', aliases: ['stripe capital'] },
    { name: 'Toast Capital', aliases: ['toast capital'] },
    { name: 'BlueVine', aliases: ['bluevine'] },
    { name: 'Fundbox', aliases: ['fundbox'] },
  ];

  // Generic MCA terminology that isn't tied to one company (spec section 65).
  const GENERIC_MCA_TERMS = [
    'merchant cash advance', 'cash advance', 'future receivables',
    'receivables purchase', 'mca debit', 'mca payment',
  ];

  // Exact exclusion list from spec section 64 — checked BEFORE alias matching.
  const EXCLUSIONS = [
    'capital one mobile pmt', 'capital one online pmt', 'capital one crcardpmt',
    'credit card', 'crcardpmt', 'card pmt', 'cc pmt', 'crc ardpmt',
    'payroll', 'adp tax', 'adp 401k', 'insurance', 'utility', 'rent', 'lease',
    'service charge', 'monthly service fee', 'square inc', 'toast dep', 'grubhub',
    'uber', 'doordash, inc.', 'dd *doordash', 'doordash*', 'shopify payout',
    'stripe payout', 'paypal transfer', 'merchant service merch dep',
    'advance auto', 'cont finance', 'sig properties',
  ];

  function normalize(s) {
    return (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function isExcluded(desc) {
    const d = normalize(desc);
    return EXCLUSIONS.some((ex) => d.includes(ex));
  }

  // Capital One special safeguard (spec section 64): only counts as MCA-relevant
  // if a business loan/funding/capital context word is present alongside it.
  function passesCapitalOneSafeguard(desc) {
    const d = normalize(desc);
    if (!d.includes('capital one')) return true; // not Capital One at all, rule doesn't apply
    return /\b(business loan|funding|capital advance|commercial loan)\b/.test(d);
  }

  function matchAlias(desc) {
    const d = normalize(desc);
    for (const entry of MCA_ALIASES) {
      if (entry.aliases.some((a) => d.includes(a))) return entry.name;
    }
    for (const term of GENERIC_MCA_TERMS) {
      if (d.includes(term)) return 'Unidentified MCA (generic terminology match)';
    }
    return null;
  }

  // Occurrence-based frequency helper (spec section 66), improved with real
  // transaction date intervals when at least 2 dated occurrences exist.
  function classifyFrequency(occurrences, dates) {
    if (dates && dates.length >= 2) {
      const sorted = dates.slice().sort();
      const intervals = [];
      for (let i = 1; i < sorted.length; i++) {
        const d1 = new Date(sorted[i - 1]);
        const d2 = new Date(sorted[i]);
        intervals.push(Math.round((d2 - d1) / 86400000));
      }
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avg <= 2) return 'daily';
      if (avg <= 9) return 'weekly';
      if (avg <= 35) return 'monthly';
      return 'irregular';
    }
    // Fallback: pure occurrence count (spec section 66 thresholds).
    if (occurrences >= 30) return 'daily';
    if (occurrences >= 4) return 'weekly';
    if (occurrences >= 2) return 'recurring';
    return 'review';
  }

  /**
   * @param {Array} transactions - only debit transactions matter here.
   * @returns {Array} MCA positions, highest-confidence first.
   */
  function detectMcaPositions(transactions) {
    const debits = transactions.filter((t) => t.direction === 'debit' && t.amount != null);
    const groups = {}; // name -> {txns, aliasHit}

    for (const t of debits) {
      const desc = t.description || '';
      if (isExcluded(desc)) continue;
      if (!passesCapitalOneSafeguard(desc)) continue;

      const name = matchAlias(desc);
      if (!name) continue;

      groups[name] = groups[name] || [];
      groups[name].push(t);
    }

    const positions = Object.keys(groups).map((name) => {
      const txns = groups[name];
      const amounts = txns.map((t) => t.amount);
      const dates = txns.map((t) => t.date).filter(Boolean);
      const frequency = classifyFrequency(txns.length, dates);

      // Recurring-amount selection: pick the amount that repeats most; else median.
      const amountMode = pickModeOrMedian(amounts);

      const monthsSpanned = estimateMonthsSpanned(dates);
      const estimatedMonthlyBurden = round2(
        frequency === 'daily' ? amountMode * 30 :
        frequency === 'weekly' ? amountMode * 4.33 :
        frequency === 'monthly' ? amountMode :
        (amountMode * txns.length) / Math.max(1, monthsSpanned)
      );

      // "Verified" only with sufficient repeated evidence — DoorDash Capital exception
      // (spec 65) allows verification off a single strong descriptor match.
      const verified = txns.length >= 2 || name === 'DoorDash Capital';

      return {
        funder: name,
        rawDescriptorSample: txns[0].description,
        estimatedPaymentAmount: amountMode,
        observedAmounts: amounts,
        cadence: frequency,
        firstObservedPayment: dates.length ? dates.slice().sort()[0] : null,
        lastObservedPayment: dates.length ? dates.slice().sort().slice(-1)[0] : null,
        numberOfObservedPayments: txns.length,
        estimatedMonthlyBurden,
        status: verified ? 'verified' : 'needs_review',
        classification: 'likely_mca',
        sourceTxnIds: txns.map((t) => t.id),
      };
    });

    // Highest-confidence first: verified, then by observed-payment count.
    positions.sort((a, b) => (b.status === 'verified') - (a.status === 'verified') || b.numberOfObservedPayments - a.numberOfObservedPayments);

    return positions;
  }

  function pickModeOrMedian(amounts) {
    const rounded = amounts.map((a) => Math.round(a * 100) / 100);
    const counts = {};
    rounded.forEach((a) => { counts[a] = (counts[a] || 0) + 1; });
    const maxCount = Math.max(...Object.values(counts));
    if (maxCount >= 2) {
      const modeVal = Object.keys(counts).find((k) => counts[k] === maxCount);
      return Number(modeVal);
    }
    const sorted = rounded.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : round2((sorted[mid - 1] + sorted[mid]) / 2);
  }

  function estimateMonthsSpanned(dates) {
    if (dates.length < 2) return 1;
    const sorted = dates.slice().sort();
    const days = (new Date(sorted[sorted.length - 1]) - new Date(sorted[0])) / 86400000;
    return Math.max(1, round2(days / 30));
  }

  function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  function stackingAnalysis(positions, trueMonthlyRevenue) {
    const totalMonthlyBurden = round2(positions.reduce((s, p) => s + p.estimatedMonthlyBurden, 0));
    return {
      activePositionCount: positions.length,
      totalMonthlyBurden,
      burdenToRevenueRatio: trueMonthlyRevenue ? round2(totalMonthlyBurden / trueMonthlyRevenue) : null,
      stacked: positions.length >= 2,
    };
  }


  function sectionKind(line,current='') {
    const low=normalize(line);
    if (/(deposits?\s*(?:&|and)?\s*credits?|credits?\s*(?:&|and)?\s*deposits?|deposits\/other credits|deposits and other credits)/i.test(low)) return 'credit';
    if (/(withdrawals?|debits?|checks paid|electronic withdrawals?|other withdrawals?|payments and other debits|withdrawals and other debits|debits and withdrawals)/i.test(low)) return 'debit';
    return current;
  }

  function rawLineIsDebit(line,section,previousLine='',nextLine='') {
    const raw=String(line||''),context=[previousLine,raw,nextLine].join(' ');
    if (/(?:^|\s)-\s*\$?\s*\d[\d,]*\.\d{2}\b|\(\s*\$?\s*\d[\d,]*\.\d{2}\s*\)/.test(raw)) return true;
    if (/\b(?:ach\s+debit|debit|withdrawal|external\s+withdrawal|e\s+withdrawal|payment|pmt)\b/i.test(raw)) return true;
    if (/\b(?:deposit|credit|external\s+deposit|e\s+deposit)\b/i.test(raw)) return false;
    if (/\b(?:wire\s+type\s*:\s*wire\s+in|loan\s+proceeds|funding)\b/i.test(context)) return false;
    return section !== 'credit';
  }

  function detectMcaFromText(text) {
    const U=root.ScannerEngine.coreUtils;
    const lines=U.cleanLines(text).map((x)=>x.replace(/\u00a0/g,' '));
    const hits={};
    let section='';
    for(let i=0;i<lines.length;i+=1){
      const line=lines[i];
      section=sectionKind(line,section);
      const name=matchAlias(line);
      if(!name || isExcluded(line) || !passesCapitalOneSafeguard(line) || !rawLineIsDebit(line,section,lines[i-1]||'',lines[i+1]||'')) continue;
      const key=name;
      hits[key]=hits[key]||{funder:name,amounts:[],count:0,evidence:line};
      const scrubbed=line
        .replace(/\b(?:DES|ID|TRACE|REF|Transaction)\s*[:#]?\s*[A-Z0-9-]+/gi,' ')
        .replace(/(?:\*{2,}|X{2,})\d+/gi,' ')
        .replace(/\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,' ');
      // A funder alias already matched this line and DES/ID/TRACE/REF/phone/masked-
      // account noise is already scrubbed out above, so a high floor here does more
      // harm than good: some real MCA holdbacks (e.g. a daily percentage-of-sales
      // funder) are genuinely a few dollars. Only a near-zero/blank value is noise.
      const vals=U.moneyVals(scrubbed).map(Math.abs).filter((v)=>v>=1&&v<=250000&&!(v>=2020&&v<=2030));
      const selected=vals.length?(vals.length>=2?vals[vals.length-2]:vals[0]):null;
      hits[key].count+=1;
      if(selected!=null) hits[key].amounts.push(selected);
    }
    return Object.values(hits).map((hit)=>{
      const amount=hit.amounts.length?pickModeOrMedian(hit.amounts):0;
      const cadence=hit.count>=12?'daily':hit.count>=2?'weekly':'monthly';
      const observedTotal=round2(hit.amounts.reduce((a,b)=>a+b,0));
      const monthly=observedTotal || round2(cadence==='daily'?amount*30:cadence==='weekly'?amount*4.33:amount);
      const verified=hit.funder.startsWith('Unidentified MCA')?hit.count>=2:true;
      return {
        funder:hit.funder,
        rawDescriptorSample:hit.evidence,
        estimatedPaymentAmount:amount,
        observedAmounts:hit.amounts,
        cadence,
        firstObservedPayment:null,
        lastObservedPayment:null,
        numberOfObservedPayments:hit.count,
        estimatedMonthlyBurden:monthly,
        status:verified?'verified':'needs_review',
        classification:'likely_mca',
        sourceTxnIds:[],
        extractionSource:'v10_raw_text'
      };
    }).sort((a,b)=>(b.status==='verified')-(a.status==='verified')||b.numberOfObservedPayments-a.numberOfObservedPayments).slice(0,12);
  }

  function mergeMcaPositions(transactionPositions, rawPositions) {
    const map=new Map();
    for(const item of [...(transactionPositions||[]),...(rawPositions||[])]){
      const key=String(item.funder||'').toLowerCase();
      const prior=map.get(key);
      if(!prior){map.set(key,item);continue;}
      const rank=(p)=>(p.status==='verified'?1000:0)+(Number(p.numberOfObservedPayments)||0)*10+(Number(p.estimatedMonthlyBurden)||0)/100000;
      map.set(key,rank(item)>rank(prior)?item:prior);
    }
    return [...map.values()].sort((a,b)=>(b.status==='verified')-(a.status==='verified')||b.numberOfObservedPayments-a.numberOfObservedPayments);
  }

  const api = {
    MCA_ALIASES, GENERIC_MCA_TERMS, EXCLUSIONS,
    isExcluded, passesCapitalOneSafeguard, matchAlias, classifyFrequency,
    detectMcaPositions, detectMcaFromText, mergeMcaPositions, stackingAnalysis,
  };

  if (root) {
    root.ScannerEngine = root.ScannerEngine || {};
    root.ScannerEngine.mcaDetector = api;
  }
})(typeof window !== 'undefined' ? window : typeof globalThis !== 'undefined' ? globalThis : this);
