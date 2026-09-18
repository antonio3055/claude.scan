/* Bank statement summary extraction ported from ScannerCRM-v10 production core. */
(function (root) {
  'use strict';
  const U = root.ScannerEngine.coreUtils;
  const { cleanLines, cleanSpace, moneyVals, moneyAbs, nextMoney, prevMoney, labeledMoney } = U;
function parseSummary(text) {
  const lines = cleanLines(text);
  function rowValues(start, maxRows = 3) {
    const vals = [];
    for (let j = start; j < Math.min(lines.length, start + maxRows); j++) vals.push(...moneyVals(lines[j]).map(Math.abs));
    return vals.filter(v => v <= 50000000 && !(v >= 2020 && v <= 2030));
  }
  function adapterFourColumn() {
    for (let i = 0; i < lines.length - 1; i++) {
      const low = lines[i].toLowerCase();
      if ((low.includes('beginning balance') || low.includes('starting balance')) &&
          (low.includes('total deposits') || low.includes('income') || low.includes('deposits')) &&
          (low.includes('ending balance'))) {
        const vals = rowValues(i + 1, 2);
        if (vals.length >= 4) return { beginning: vals[0], deposits: vals[1], withdrawals: vals[2], ending: vals[3], confidence: 97, evidence: 'Four-column account summary' };
      }
      if (low.includes('previous date') && low.includes('beginning balance') && low.includes('deposits') && low.includes('ending balance')) {
        const vals = rowValues(i + 1, 2);
        if (vals.length >= 6) return { beginning: vals[0], deposits: vals[1], withdrawals: vals.length >= 7 ? vals[4] + vals[5] : vals[3], ending: vals[vals.length - 1], confidence: 97, evidence: 'Account Summary table' };
      }
    }
    return null;
  }
  function adapterOnlineActivity() {
    const lowText = String(text || '').toLowerCase();
    if (lowText.includes('account detail - wells fargo')) {
      let deposits = null, ending = null;
      for (let i=0;i<lines.length;i++) {
        const low=lines[i].toLowerCase();
        if (low === 'totals' || low.startsWith('totals ')) { const v=moneyVals(lines[i]).map(Math.abs); if(v.length>=2) deposits=v[0]; }
        if (low.startsWith('current posted balance') || low.startsWith('ending collected balance')) { const v=moneyVals(lines[i]).map(Math.abs); if(v.length) ending=v[0]; else ending=nextMoney(lines,i,2)[0]; }
      }
      if (deposits!=null && ending!=null) return {deposits,ending,confidence:94,evidence:'Wells Fargo online activity totals'};
    }
    if (lowText.includes('printed from chase for business')) {
      let deposits=0,hits=0,ending=null;
      for(let i=0;i<lines.length;i++){
        const low=lines[i].toLowerCase(), vals=moneyVals(lines[i]).map(Math.abs).filter(v=>!(v>=2020&&v<=2030));
        if ((low.includes('ach credit') || low.includes('wire credit') || low.includes('zelle credit') || low.includes('account transfer')) && vals.length>=2 && !/[—–-]\s*$/.test(lines[i])) { deposits+=vals[vals.length-2]; hits++; }
        if(low.includes('present balance')) ending=vals.length?vals[0]:prevMoney(lines,i,3)[0];
      }
      if(hits && ending!=null) return {deposits:Math.round(deposits*100)/100,ending,confidence:88,evidence:'Chase online posted-credit activity'};
    }
    return null;
  }
  function adapterSummaryBlock() {
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (!/^(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s+)?(?:beginning|starting|previous)\s+(?:statement\s+)?balance\b/.test(low)) continue;
      const beginningVals = moneyVals(lines[i]).map(Math.abs).filter(v => !(v >= 2020 && v <= 2030));
      if (!beginningVals.length) continue;
      const r = { beginning: beginningVals[0] }, dep = [], wd = [];
      let endAt = -1;
      for (let j = i + 1; j < Math.min(lines.length, i + 18); j++) {
        const l = lines[j].toLowerCase();
        const vals = moneyVals(lines[j]).map(Math.abs).filter(v => !(v >= 2020 && v <= 2030));
        if (!vals.length) continue;
        if (/^(?:\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\s+)?(?:ending|current|new)\s+balance\b/.test(l)) { r.ending = vals[vals.length - 1]; endAt = j; break; }
        if (/^[+]?\s*(?:\d+\s+)?(?:credits|deposits|other deposits|card deposits|electronic deposits|other credits|deposits?\s*(?:&|and)\s*credits?|deposits?\s*(?:&|and)\s*additions|deposits?\s+and\s+other\s+credits|deposits?\(s\)\s+this\s+period|credits?\(s\)\s+this\s+period|income)\b/.test(l)) dep.push(vals[0]);
        if (/^(?:\d+\s+)?(?:withdrawals?|debits?\(s\)\s+this\s+period|checks paid|electronic payments|other withdrawals|card withdrawals|expenses)\b/.test(l)) wd.push(vals[vals.length - 1]);
      }
      if (endAt > 0 && dep.length) {
        r.deposits = dep.reduce((a,b)=>a+b,0); if (wd.length) r.withdrawals = wd.reduce((a,b)=>a+b,0);
        return { ...r, confidence: 98, evidence: 'Bounded account-summary block' };
      }
    }
    return null;
  }
  function adapterPnc() {
    if (!/\bpnc bank\b/i.test(text)) return null;
    const i = lines.findIndex(l => l.toLowerCase() === 'balance summary');
    if (i >= 0) {
      const vals = [];
      for (let j = i + 1; j < Math.min(lines.length, i + 25); j++) {
        const v = moneyAbs(lines[j]);
        if (v != null) vals.push(v);
        if (vals.length >= 4) break;
      }
      if (vals.length >= 4) return { beginning: vals[0], deposits: vals[1], withdrawals: vals[2], ending: vals[3], confidence: 96, evidence: 'PNC Balance Summary' };
    }
    return null;
  }
  function adapterKeyPoint() {
    if (!text.includes('Account No.') || !text.includes('Deposits')) return null;
    let idx = -1;
    for (let i = 0; i < 60 && i < lines.length; i++) {
      if (lines[i].toLowerCase() === 'balance' && i > 0 && lines[i - 1].toLowerCase() === 'ending') { idx = i; break; }
    }
    if (idx >= 0) {
      const vals = [];
      for (let j = idx + 1; j < Math.min(lines.length, idx + 12); j++) {
        const v = moneyAbs(lines[j]);
        if (v != null) vals.push(v);
        if (vals.length >= 6) break;
      }
      if (vals.length >= 6) return { beginning: vals[0], deposits: vals[1], withdrawals: vals[3], ending: vals[5], confidence: 96, evidence: 'KeyPoint top summary' };
    }
    return null;
  }
  function adapterCommerce() {
    if (!text.includes('Account Summary Account #') || !text.includes('Deposits & Other Credits')) return null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('Beginning Balance on')) {
        const vals = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 20); j++) {
          const v = moneyAbs(lines[j]);
          if (v != null) vals.push(v);
          if (vals.length >= 6) break;
        }
        let ending = null;
        for (let j = i + 1; j < Math.min(lines.length, i + 30); j++) {
          if (lines[j].startsWith('Ending Balance')) ending = labeledMoney(lines, j, 3);
        }
        if (vals.length >= 6 && ending != null) return { beginning: vals[0], deposits: vals[1], withdrawals: vals.slice(2, 6).reduce((a, b) => a + b, 0), ending, confidence: 95, evidence: 'Commerce Account Summary' };
      }
    }
    return null;
  }
  function adapterBluestone() {
    if (!lines.some(l => l.toUpperCase().includes('MICRO BUSINESS DRAFT'))) return null;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toUpperCase().includes('MICRO BUSINESS DRAFT')) {
        const vals = [];
        for (let j = i + 1; j < Math.min(lines.length, i + 10); j++) {
          const v = moneyAbs(lines[j]);
          if (v != null) vals.push(v);
          if (vals.length >= 4) break;
        }
        if (vals.length >= 4) return { beginning: vals[0], withdrawals: vals[1], deposits: vals[2], ending: vals[3], confidence: 96, evidence: 'Bluestone MICRO BUSINESS DRAFT table' };
      }
    }
    return null;
  }
  function adapterTruist() {
    if (!text.includes('Account summary') || !text.includes('Your new balance')) return null;
    const r = {};
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (low.startsWith('your previous balance')) r.beginning = labeledMoney(lines, i, 3);
      if (low.startsWith('deposits, credits and interest')) r.deposits = labeledMoney(lines, i, 3);
      if (low.startsWith('other withdrawals, debits') && r.withdrawals == null) r.withdrawals = labeledMoney(lines, i, 3);
      if (low.startsWith('your new balance')) r.ending = labeledMoney(lines, i, 3);
    }
    return r.deposits != null && r.ending != null ? { ...r, confidence: 96, evidence: 'Truist Account summary' } : null;
  }
  function adapterLabelValue() {
    const terms = [
      ['beginning', /^(Beginning balance|Previous Statement Balance)/i],
      ['deposits', /^(Deposits\s*&\s*Credits|Deposits\/Credits|Deposits and other credits|Total Deposits and Other Credits|Additions|Total Additions)$/i],
      ['withdrawals', /^(Withdrawals|Withdrawals\/Debits|Withdrawals and other debits|Subtractions|Total Subtractions)$/i],
      ['ending', /^(Ending balance|Current Statement Balance|New Balance|Balance this statement)/i]
    ];
    const r = {};
    for (const [key, re] of terms) {
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          const v = labeledMoney(lines, i, 3);
          if (v != null) { r[key] = v; break; }
        }
      }
    }
    return r.deposits != null && r.ending != null ? { ...r, confidence: 92, evidence: 'Label/value statement summary' } : null;
  }
  function adapterProsperity() {
    if (!text.includes('STATEMENT SUMMARY') || !text.includes('Deposits/Other Credits')) return null;
    const r = {};
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      if (low === 'beginning balance' && r.beginning == null) r.beginning = prevMoney(lines, i, 7)[0];
      if (low === 'deposits/other credits' && r.deposits == null) {
        const vals = [];
        for (let j = i - 1; j > Math.max(-1, i - 10); j--) {
          const v = moneyAbs(lines[j]);
          if (v != null) vals.push(v);
          if (vals.length >= 3) break;
        }
        r.deposits = vals.length >= 2 ? vals[1] : (vals[0] || null);
      }
      if (low === 'ending balance' && r.ending == null) r.ending = prevMoney(lines, i, 8)[0];
    }
    return r.deposits != null && r.ending != null ? { ...r, confidence: 90, evidence: 'Prosperity STATEMENT SUMMARY' } : null;
  }
  function adapterGeneric() {
    const map = {
      beginning: ['beginning balance', 'opening balance', 'previous balance'],
      deposits: ['deposits & credits', 'deposits and credits', 'deposits and additions', 'deposits & other credits', 'deposits and other credits', 'deposits, credits and interest', 'deposits/other credits', 'total deposits', 'total credits', 'deposits/credits', 'additions', 'total additions'],
      withdrawals: ['withdrawals', 'withdrawals/debits', 'checks/other debits', 'total debits', 'subtractions', 'total subtractions'],
      ending: ['ending balance', 'closing balance', 'current statement balance', 'your new balance', 'new balance', 'balance this statement', 'ending/new balance']
    };
    const r = {};
    for (const key of Object.keys(map)) {
      for (let i = 0; i < lines.length; i++) {
        const low = lines[i].toLowerCase();
        if (map[key].some(term => low === term || low.startsWith(term))) {
          let v = labeledMoney(lines, i, 4);
          if (v == null) v = prevMoney(lines, i, 5)[0];
          if (v != null) { r[key] = v; break; }
        }
      }
    }
    return r.deposits != null && r.ending != null ? { ...r, confidence: 65, evidence: 'Generic summary' } : null;
  }
  function adapterTransactionTotals() {
    let deposits = 0, hits = 0, ending = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i], low = l.toLowerCase();
      const vals = moneyVals(l).map(Math.abs).filter(v => !(v >= 2020 && v <= 2030));
      const dated = /^(?:\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?|20\d{2}-\d{2}-\d{2})\s+/.test(low);
      if (dated && /\b(?:deposit|credit)\b/.test(low) && !/ending balance|balance forward/.test(low) && vals.length >= 2) {
        deposits += vals[vals.length - 2]; hits++;
      }
      if (/\bending balance\b/.test(low) && vals.length) ending = vals[vals.length - 1];
      else if (dated && vals.length >= 2) ending = vals[vals.length - 1];
    }
    if (hits && ending != null) return { deposits: Math.round(deposits * 100) / 100, ending, confidence: 78, evidence: 'Summed dated deposit/credit transactions' };
    return null;
  }
  for (const fn of [adapterOnlineActivity, adapterSummaryBlock, adapterFourColumn, adapterPnc, adapterKeyPoint, adapterCommerce, adapterBluestone, adapterTruist, adapterProsperity, adapterGeneric, adapterLabelValue, adapterTransactionTotals]) {
    const result = fn();
    if (result && (result.deposits != null || result.ending != null)) {
      if (result.beginning != null && result.deposits != null && result.withdrawals != null && result.ending != null) {
        result.math_diff = Math.round((result.beginning + result.deposits - result.withdrawals - result.ending) * 100) / 100;
      }
      return result;
    }
  }
  return { confidence: 0, evidence: 'No summary found' };
}
function ocrMoneyNums(s){ return moneyVals(String(s||'')).map(Math.abs).filter(v => v > 0 && !(v>=2020&&v<=2030)); }
function parseOcrSummary(text, src){
  const raw=String(text||'');
  const low=raw.toLowerCase();
  const r={};
  if(low.includes('farmers') || String(src||'').toLowerCase().includes('farmers')){
    let m=raw.match(/\b\d+\s+CREDITS\s+([0-9]{1,3}(?:,\s*[0-9]{3})*\.\d{2})/i);
    if(m) r.deposits=parseFloat(m[1].replace(/[,\s]/g,''));
    m=raw.match(/THIS\s+STATEMENT\s+\d{1,2}\/\d{1,2}\/\d{2,4}\s+([0-9]{1,3}(?:,\s*[0-9]{3})*\.\d{2}|[0-9]{4,}\.\d{2})/i);
    if(m) r.ending=parseFloat(m[1].replace(/[,\s]/g,''));
    if(r.deposits!=null || r.ending!=null) return {...r, confidence:95, evidence:'Farmers OCR summary'};
  }
  if(low.includes('imcu.com') || low.includes('members credit union') || low.includes('indiana')){
    const compact=cleanSpace(raw.replace(/\n/g,' '));
    const depMatches=[...compact.matchAll(/(?:total|tot\w*|tata|aera|7stoal|106\s*tata)?\s*(?:d\w+\s*)?(?:depo\w*|doposts\w*|deposts\w*)\s*(?:for|or|tor|stor)?\s*["'$ ]*([0-9]{1,3}(?:,[0-9]{3})*\.\d{2})/ig)]
      .map(x=>parseFloat(x[1].replace(/,/g,''))).filter(v=>v>=1000 && v<10000000);
    if(depMatches.length) r.deposits=Math.max(...depMatches);
    const lines=cleanLines(raw);
    for(const line of lines){
      if(/prefer.*b.*(check|checs|bins|busnes)|preferred business checking|preferred busnes/i.test(line)){
        const vals=ocrMoneyNums(line).filter(v=>v>=100 && v<1000000);
        if(vals.length){ r.ending=vals[vals.length-1]; break; }
      }
    }
    if(r.ending==null){
      const m=compact.match(/Account\s+Balance\s+Total\s+\$?\s*([0-9]{1,3}(?:,[0-9]{3})*\.\d{2})/i);
      if(m) r.ending=parseFloat(m[1].replace(/[,\s]/g,''));
    }
    if(r.deposits!=null || r.ending!=null) return {...r, confidence:95, evidence:'IMCU OCR summary'};
  }
  return null;
}

function extractSummary(text, opts){
  const normal=parseSummary(text);
  const ocr=opts?.usedOcr ? parseOcrSummary(text, opts?.filename || '') : null;
  if(!ocr) return normal;
  return {
    ...normal,
    ...ocr,
    deposits: ocr.deposits ?? normal.deposits,
    ending: ocr.ending ?? normal.ending,
    confidence: Math.max(Number(normal.confidence)||0, Number(ocr.confidence)||0),
    evidence: ocr.evidence || normal.evidence,
  };
}

  const api={parseSummary,parseOcrSummary,extractSummary};
  if(root){root.ScannerEngine=root.ScannerEngine||{};root.ScannerEngine.summaryExtractor=api;}
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
