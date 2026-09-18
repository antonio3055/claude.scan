/* Statement date recovery: React scanner + ScannerCRM-v10 fallbacks. */
(function (root) {
  'use strict';
  const U = () => root.ScannerEngine.coreUtils;
  const MONTHS = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const pad = (n) => String(n).padStart(2,'0');
  const toIso = (y,m,d) => y && m && d ? `${y}-${pad(m)}-${pad(d)}` : null;
  const normalizeYear = (y) => String(y).length === 2 ? ((Number(y)>50?1900:2000)+Number(y)) : Number(y);

  function fromDocumentText(text) {
    const t = String(text || '').replace(/\u00a0/g,' ');
    let m = t.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:-|to|through|thru)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
    if (m) return { start:toIso(normalizeYear(m[3]),m[1],m[2]), end:toIso(normalizeYear(m[6]),m[4],m[5]), source:'document_text_numeric_range' };
    const monthPat='(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*';
    const re=new RegExp(monthPat+'\\s+(\\d{1,2}),?\\s+(\\d{4})\\s*(?:-|to|through|thru)\\s*'+monthPat+'\\s+(\\d{1,2}),?\\s+(\\d{4})','i');
    m=t.match(re);
    if(m) return { start:toIso(m[3],MONTHS[m[1].slice(0,3).toLowerCase()],m[2]), end:toIso(m[6],MONTHS[m[4].slice(0,3).toLowerCase()],m[5]), source:'document_text_word_range' };
    const singles=[
      [/(?:End\s+Date|Statement\s+Date|Statement\s+Ending|as of)\s*:?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,'document_text_single_date'],
      [/THIS\s+STATEMENT\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i,'ocr_this_statement'],
    ];
    for(const [rx,source] of singles){ m=t.match(rx); if(m){const d=U().parseDate(m[1]); if(d)return {start:null,end:U().isoDate(d),source};}}
    m=t.match(/(?:Statement|Stavernent)\s+For\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s*[-–]\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
    if(m){const d1=U().parseDate(m[1]),d2=U().parseDate(m[2]); if(d2)return {start:d1?U().isoDate(d1):null,end:U().isoDate(d2),source:'ocr_range_end'};}
    return null;
  }

  function fromFilename(filename) {
    const f=String(filename||'').replace(/_/g,' ');
    let m=f.match(/(\d{4})(\d{2})(\d{2})[-_](\d{4})(\d{2})(\d{2})/);
    if(m)return{start:toIso(m[1],m[2],m[3]),end:toIso(m[4],m[5],m[6]),source:'filename_compact_range'};
    const dates=[...f.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)];
    if(dates.length){const d=dates.at(-1);return{start:null,end:toIso(d[1],d[2],d[3]),source:'filename_single_end_date'};}
    m=f.match(/\b(20\d{2})[- ](0?[1-9]|1[0-2])\b/);
    if(m){const d=new Date(Number(m[1]),Number(m[2]),0);return{start:null,end:U().isoDate(d),source:'filename_year_month'};}
    const low=f.toLowerCase(),year=(low.match(/20\d{2}/)||[String(new Date().getFullYear())])[0];
    for(let i=0;i<12;i+=1){const mon=Object.keys(MONTHS)[i];if(new RegExp('\\b'+mon+'[a-z]*\\b').test(low)){const d=new Date(Number(year),i+1,0);return{start:null,end:U().isoDate(d),source:'filename_month'};}}
    return null;
  }

  function recoverStatementDate(text, filename) { return fromDocumentText(text) || fromFilename(filename) || null; }
  const api={recoverStatementDate,fromDocumentText,fromFilename};
  if(root){root.ScannerEngine=root.ScannerEngine||{};root.ScannerEngine.statementDate=api;}
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
