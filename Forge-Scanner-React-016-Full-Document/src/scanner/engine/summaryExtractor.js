/* ============================================================
   summaryExtractor.js — the statement's own beginning balance,
   deposit total, withdrawal total and ending balance.

   Sources, strongest first:

     1. balanceEquation — the summary block or table the bank prints,
        accepted only when its arithmetic reproduces the printed ending
        balance. This is the authoritative reading of a statement.
     2. Online-banking activity printouts, which show posted activity and
        a present balance but no balance equation to prove.
     3. OCR recovery for scanned statements, where the text is too damaged
        for a block to balance.
     4. Summed dated deposit rows, for anything that prints no summary.
     5. The unproven equation, reported with the difference it leaves, so
        a figure that does not add up is visible as such instead of being
        passed off as the bank's own total.

   Ported from ScannerCRM-v10 production core; the per-bank summary-block
   adapters it carried are replaced by the verified equation above.
   ============================================================ */
(function (root) {
  'use strict';
  const U = root.ScannerEngine.coreUtils;
  const { cleanLines, cleanSpace, moneyVals, nextMoney, prevMoney } = U;

/** Online-banking printouts: posted activity and a present balance, no equation. */
function adapterOnlineActivity(text, lines) {
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

/** Last resort: add up the dated deposit rows and take the last running balance. */
function adapterTransactionTotals(lines) {
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

function fromEquation(equation) {
  return {
    beginning: equation.beginning,
    deposits: equation.deposits,
    withdrawals: equation.withdrawals,
    ending: equation.ending,
    math_diff: equation.difference,
    confidence: equation.verified ? 99 : 40,
    evidence: equation.evidence,
    equation,
  };
}

function parseSummary(text) {
  const lines = cleanLines(text);
  const equation = root.ScannerEngine.balanceEquation.solveBalanceEquation(text);
  if (equation && equation.verified) return fromEquation(equation);

  const online = adapterOnlineActivity(text, lines);
  if (online) return online;

  const summed = adapterTransactionTotals(lines);
  if (summed) return summed;

  if (equation) return fromEquation(equation);
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

/**
 * A proven equation is the statement's own arithmetic and outranks OCR
 * pattern recovery; anything weaker gives way to it.
 */
function extractSummary(text, opts){
  const normal=parseSummary(text);
  const ocr=opts?.usedOcr ? parseOcrSummary(text, opts?.filename || '') : null;
  if(!ocr) return normal;
  if(normal.equation?.verified) return normal;
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
