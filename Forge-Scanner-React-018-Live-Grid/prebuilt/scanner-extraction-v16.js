/* v16: native scanner extraction repairs. One authoritative parser for each repaired field. */
(function (root) {
  'use strict';
  const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const STATES = Object.freeze({alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',montana:'MT',nebraska:'NE',nevada:'NV', 'new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',wyoming:'WY','district of columbia':'DC'});
  const CODES = new Set(Object.values(STATES));
  const STREET_TYPE = '(?:st(?:reet)?|ave(?:nue)?|rd|road|dr(?:ive)?|ln|lane|blvd|boulevard|pkwy|parkway|hwy|highway|ct|court|pl|place|way|ter|terrace|cir|circle|trail|trl|pike|loop|drive)';
  const SPACE = value => String(value || '').replace(/\u00a0/g,' ').replace(/[ \t]+/g,' ').trim();
  const rowLines = text => String(text || '').replace(/\r/g,'').split(/\n/).map(SPACE).filter(Boolean);
  const dateISO = (year, month, day) => {
    const y=Number(year),m=Number(month),d=Number(day);
    if (y<1900||y>2100||m<1||m>12||d<1||d>31) return null;
    const check=new Date(Date.UTC(y,m-1,d));
    return check.getUTCFullYear()===y && check.getUTCMonth()===m-1 && check.getUTCDate()===d
      ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}` : null;
  };
  function dateFromText(s) {
    let m=String(s||'').match(/\b((?:19|20)\d{2})[-\/.](0?[1-9]|1[0-2])[-\/.]([0-3]?\d)\b/);
    if(m)return dateISO(m[1],m[2],m[3]);
    m=String(s||'').match(/\b(0?[1-9]|1[0-2])[-\/.]([0-3]?\d)[-\/.]((?:19|20)\d{2})\b/);
    if(m)return dateISO(m[3],m[1],m[2]);
    m=String(s||'').match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2}),?\s+((?:19|20)\d{2})\b/i);
    if(m)return dateISO(m[3],MONTHS.indexOf(m[1].slice(0,3).toUpperCase())+1,m[2]);
    return null;
  }
  const displayDate = iso => iso ? `${iso.slice(5,7)}/${iso.slice(8,10)}/${iso.slice(0,4)}` : null;
  function validPeriod(p) {return p && dateFromText(p.end) ? p : null;}
  function recoverStatementDate(text, filename, native) {
    const earlier=validPeriod(native(text,filename));
    if(earlier)return earlier;
    const lines=rowLines(text).slice(0,110);
    // Only dates attached to explicit statement labels, not transactions, advertisements or the computer's clock.
    const label=/\b(?:statement issued|statement date|statement ending|statement end date|period ending|period end date|closing date|through date|date of statement)\b/i;
    for(let i=0;i<lines.length;i++) {
      const m=lines[i].match(label);
      if(!m)continue;
      const tail=lines[i].slice(m.index+m[0].length);
      const end=dateFromText(tail)||((i+1<lines.length)?dateFromText(lines[i+1]):null);
      if(end)return {start:null,end,source:'labeled_statement_date'};
    }
    const f=String(filename||'').replace(/\\/g,'/').split('/').pop().replace(/\.pdf$/i,'');
    // Date in basename is independent of the lead folder. Never supply an assumed year.
    let m=f.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[-_ .]+((?:19|20)\d{2})(?!\d)/);
    if(m){const year=Number(m[2]),month=Number(m[1]);return {start:null,end:dateISO(year,month,new Date(Date.UTC(year,month,0)).getUTCDate()),source:'filename_month_year'};}
    m=f.match(/\b((?:19|20)\d{2})[-_ .]+(0?[1-9]|1[0-2])\b/);
    if(m){const y=Number(m[1]),mon=Number(m[2]);return{start:null,end:dateISO(y,mon,new Date(Date.UTC(y,mon,0)).getUTCDate()),source:'filename_year_month'};}
    return null;
  }
  function stateCode(value){const t=SPACE(value).replace(/[^a-z ]/gi,'').toLowerCase();return STATES[t]||(t.length===2&&CODES.has(t.toUpperCase())?t.toUpperCase():null);}
  function normalStreet(value){
    return SPACE(value).replace(/(?:\b([a-z]+\s+(?:st|street|ave|avenue|rd|road|dr|drive|hwy|highway))\1\b)/gi,'$1')
      .replace(/\s*,+\s*/g,', ').replace(/\s+$/,'').replace(/\s*,\s*$/,'');
  }
  function repeatedOverlayLine(line){
    // Duplicated PDF appearance layers repeat each value exactly three times.
    const prefix=new RegExp(`^(\\d{1,6}\\s+.+?\\b${STREET_TYPE})\\1{2}`,'i').exec(line);
    if(!prefix)return null;
    let tail=line.slice(prefix[0].length);
    const town=/^\s+([A-Za-z][A-Za-z -]{2,}?)\1{2}/.exec(tail);
    if(!town)return null;
    tail=tail.slice(town[0].length);
    const st=/^\s+([A-Z]{2})\1{2}/.exec(tail);
    if(!st||!stateCode(st[1]))return null;
    tail=tail.slice(st[0].length);
    const zipcode=/^\s+(\d{5})\1{2}\s*$/.exec(tail);
    if(!zipcode)return null;
    return{street:normalStreet(prefix[1]),city:SPACE(town[1]),state:stateCode(st[1]),zip:zipcode[1]};
  }
  function cityStateZip(line){
    const text=SPACE(line);
    const rx=/([A-Za-z][A-Za-z .'-]{1,55}?)\s*,?\s+([A-Z]{2})\s*,?\s+(\d{5}(?:-\d{4})?)\b/gi;
    let m,match=null;while((m=rx.exec(text))!==null){if(CODES.has(m[2].toUpperCase()))match=m;}
    if(!match)return null;
    const city=SPACE(match[1].replace(/^(?:LLC|INC\.?|CORP\.?|LP|LTD)\s+/i,'').replace(/^.*?\b(?:ste|suite|apt|unit)\s+\d+[A-Za-z-]*\s+/i,''));
    if(!city||city.length>40)return null;
    return{city,state:match[2].toUpperCase(),zip:match[3]};
  }
  function extractBusinessAddress(text){
    const lines=rowLines(text);
    const streetLabels=/\b(?:business\s+(?:physical\s+street\s+)?address|business\s+location|physical\s+business\s+address)\s*:?/i;
    for(let i=0;i<lines.length;i++){
      const match=streetLabels.exec(lines[i]);if(!match)continue;
      const after=SPACE(lines[i].slice(match.index+match[0].length));
      const inline=after.split(/\s+(?=(?:State|City|Zip(?: Code)?|Business Start Date|Industry|Legal Entity|Phone|Email|Home Address)\s*:)/i)[0];
      let street=SPACE(inline), city=null,state=null,zip=null;
      const repeated=/\b(?:City|State|Zip)\b/i.test(after)
        ? lines.slice(i+1,i+4).map(repeatedOverlayLine).find(Boolean) : null;
      if(repeated)return{...repeated,address:`${repeated.street}, ${repeated.city}, ${repeated.state} ${repeated.zip}`};
      if(!/\b\d{1,6}\b/.test(street)||!new RegExp(`\\b${STREET_TYPE}\\b`,'i').test(street)){
        street='';
        for(let j=i+1;j<Math.min(lines.length,i+4);j++){
          if(/\b(?:Home Address|Street Address|Owner Details|Date of Birth|Funding Details|Business Start Date)\b/i.test(lines[j]))break;
          const s=lines[j].match(new RegExp(`(\\d{1,6}\\s+.+?\\b${STREET_TYPE}\\b(?:\\s+(?:[NSEW]{1,2}|STE|SUITE|APT|UNIT|#)\\s*[A-Za-z0-9-]*)?)`,'i'));
          if(s){street=s[1];break;}
        }
      }
      if(!street)continue;
      street=normalStreet(street);
      // E-sign forms sometimes split an apartment number and a town onto later rows.
      for(let j=i+1;j<Math.min(lines.length,i+5);j++){
        const next=lines[j];
        if(/\b(?:Home Address|Street Address|Owner Details|Date of Birth|Funding Details)\b/i.test(next))break;
        if(/\b(?:apt|ste|suite|unit|#)\s*$/i.test(street)&&/^(?:#?\d+[A-Za-z]?|[A-Z]\d+)$/i.test(next))street+=' '+next;
        const loc=cityStateZip(next);
        if(loc&&!city){city=loc.city;state=loc.state;zip=loc.zip;}
      }
      const combined=cityStateZip(street);if(combined&&!city){city=combined.city;state=combined.state;zip=combined.zip;street=SPACE(street.slice(0,street.search(/\b[A-Za-z][A-Za-z .'-]{1,55}?\s*,?\s+[A-Z]{2}\s*,?\s+\d{5}/i))).replace(/,$/,'');}
      const stateLabel=lines[i].match(/\bState\s*:\s*([A-Za-z ]+?)(?=\s+(?:City|Zip(?: Code)?)\s*:|$)/i);
      const cityLabel=lines[i].match(/\bCity\s*:\s*([A-Za-z .'-]+?)(?=\s+(?:State|Zip(?: Code)?)\s*:|$)/i);
      const zipLabel=lines[i].match(/\bZip(?: Code)?\s*:\s*(\d{5}(?:-\d{4})?)/i);
      if(stateLabel&&stateCode(stateLabel[1]))state=stateCode(stateLabel[1]);
      if(cityLabel)city=SPACE(cityLabel[1]);
      if(zipLabel)zip=zipLabel[1];
      if(!city||!state||!zip)continue; // Incomplete source: do not claim a full address.
      street=street.replace(/\s+(?:State|City|Zip(?: Code)?)\s*:.*$/i,'').trim().replace(/,$/,'');
      if(!/\d/.test(street)||!new RegExp(`\\b${STREET_TYPE}\\b`,'i').test(street))continue;
      return{street,city,state,zip,address:`${street}, ${city}, ${state} ${zip}`};
    }
    return null;
  }
  function extractApplicationDate(text){
    const lines=rowLines(text), header=lines.slice(0,8);
    // E-sign confirmation, labeled date and signature-block evidence are authoritative.
    for(let i=0;i<lines.length;i++){
      const line=lines[i];if(/\b(?:date of birth|birth date|\bdob\b|business start date|date established)\b/i.test(line)&&!/\b(?:signed at|signature date|date signed)\b/i.test(line))continue;
      const signed=line.match(/\bsigned at\s*:?\s*(.*)$/i);
      if(signed){const iso=dateFromText(signed[1])||dateFromText(lines[i+1]||'');if(iso)return displayDate(iso);}
      const sig=line.match(/\b(?:signature date|date signed|application date|signed on)\s*:?\s*(.*)$/i);
      if(sig){const iso=dateFromText(sig[1])||dateFromText(lines[i+1]||'');if(iso)return displayDate(iso);}
    }
    for(let i=0;i<lines.length;i++){
      const line=lines[i];
      if(/\b(?:date of birth|birth date|\bdob\b|business start date|date established)\b/i.test(line))continue;
      if(/\b(?:applicant signature|owner\s*#?\d*\s*signature|primary owner signature|authorization|owner signature|partner signature)\b/i.test(line)){
        const same=line.match(/\bDate\s*:\s*([^:]+?)(?=\s+(?:Partner|Owner|Signature|$))/i);
        const iso=(same&&dateFromText(same[1]))||null;
        if(iso)return displayDate(iso);
        for(let j=i+1;j<Math.min(lines.length,i+6);j++){
          if(/\b(?:birth date|date of birth|\bdob\b|business start date)\b/i.test(lines[j]))break;
          const value=dateFromText(lines[j]);if(value)return displayDate(value);
        }
      }
    }
    // An application heading carrying a complete calendar date is distinct from a person's DOB.
    for(const line of header){const val=dateFromText(line);if(val&&/^(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday),?\s+)?[a-z]+\s+\d{1,2},?\s+\d{4}$/i.test(line))return displayDate(val);}
    return null;
  }
  const DIR={street:'st',avenue:'ave',road:'rd',drive:'dr',boulevard:'blvd',lane:'ln',parkway:'pkwy',highway:'hwy',court:'ct',place:'pl',terrace:'ter',circle:'cir',suite:'ste',apartment:'apt',north:'n',south:'s',east:'e',west:'w'};
  function normalizeWords(s){return SPACE(s).toLowerCase().replace(/\./g,'').replace(/\b([a-z]+)\b/g,w=>DIR[w]||w).replace(/\s+/g,' ').trim();}
  function parseAddress(value){
    const text=SPACE(value);if(!text)return null;
    const m=text.match(/^(.*?)(?:,\s*([^,]+?))?,?\s+([A-Z]{2})\s+(\d{5})(?:-\d{4})?\b/i);
    if(!m)return null;
    const city=m[2]?normalizeWords(m[2]):null;
    const primary=SPACE(m[1]);
    const street=primary.match(/^(\d+[A-Za-z]?|P\.?\s*O\.?\s*Box\s*\d+)\s+(.+)$/i);
    if(!street)return null;
    const normalized=normalizeWords(normalStreet(street[2]));
    const unit=normalized.match(/\b(?:ste|apt|unit|#)\s*([a-z0-9-]+)\s*$/);
    const streetName=normalized.replace(/\b(?:ste|apt|unit|#)\s*[a-z0-9-]+\s*$/,'').trim();
    if(!streetName)return null;
    return{house:normalizeWords(street[1]),street:streetName,unit:unit?`${unit[0].split(/\s+/)[0]} ${unit[1]}`:null,city,state:m[3].toUpperCase(),zip:m[4]};
  }
  function compareAddress(a,b){
    const x=parseAddress(a),y=parseAddress(b);
    if(!x||!y)return 'unknown';
    if(x.house!==y.house)return'different';
    if(x.street!==y.street){
      const a=x.street.split(' '),b=y.street.split(' ');
      const common=a.filter(w=>b.includes(w)&&w!=='st'&&w!=='rd'&&w!=='hwy'&&w!=='ave'&&w!=='dr');
      const overlap=common.length>0 && a.every(w=>b.includes(w)) || common.length>0 && b.every(w=>a.includes(w));
      if(!overlap)return'different';
      // The same ZIP, city and state are required before treating a shortened street as equivalent.
      if(x.state!==y.state||x.zip!==y.zip||!x.city||!y.city||x.city!==y.city)return'unknown';
    }
    if(x.unit&&y.unit&&x.unit!==y.unit)return'different';
    if(x.state!==y.state||x.zip!==y.zip)return'different';
    if(x.city&&y.city&&x.city!==y.city)return'different';
    return'same';
  }
  function extractStatementHolder(text,opts,native){
    const first=native(text,opts);
    if(!opts?.name)return first;
    const lines=rowLines(text).slice(0,65);
    const normalized=s=>SPACE(s).toUpperCase().replace(/[^A-Z0-9]/g,'');
    const who=normalized(opts.name);
    const idx=lines.findIndex(v=>normalized(v).startsWith(who)&&who.length>5);
    if(idx<0)return first;
    const near=lines.slice(idx+1,idx+11);
    let physical=-1,street='';
    for(let i=0;i<near.length;i++){
      const v=near[i].replace(/^\d{5,}\s+(?=\d+\s+\D)/,'');
      const m=v.match(new RegExp(`^(\\d{1,6}\\s+.+?\\b${STREET_TYPE}\\b(?:\\s+(?:[NSEW]{1,2}|STE|SUITE|APT|UNIT|#)\\s*[A-Za-z0-9-]*)?)`,'i'));
      if(m){physical=i;street=normalStreet(m[1]);break;}
    }
    if(physical<0)return first;
    let suiteAt=-1;
    for(let j=physical+1;j<Math.min(near.length,physical+4);j++){
      if(/^(?:ste|suite|apt|unit)\s+\S+/i.test(near[j])){suiteAt=j;street+=' '+SPACE(near[j]);break;}
    }
    let localities=[];
    for(let j=physical+1;j<Math.min(near.length,physical+7);j++){
      const town=cityStateZip(near[j]);
      if(town)localities.push({j,...town});
    }
    // Bank-owned PO Box and its locality may occupy a parallel column. Prefer the locality after the customer's suite.
    const bankPo=near.slice(physical+1).some(v=>/^P\.?\s*O\.?\s*Box/i.test(v));
    const locality=bankPo&&suiteAt>=0?localities.filter(v=>v.j>suiteAt).at(-1):localities.length===1?localities[0]:null;
    if(!locality)return bankPo?{street,town:null,state:null,postcode:null,full:null}:first;
    return{street,town:locality.city,state:locality.state,postcode:locality.zip,full:`${street}, ${locality.city}, ${locality.state} ${locality.zip}`};
  }
  // Source-only native routes: accept printed bank totals only when their
  // complete balance equation is internally verified. Never use test data.
  const PRINTED_MONEY='([+−-]?\\s*\\$?\\s*\\d[\\d,]*\\.\\d{2}\\s*[-−]?)';
  function readPrintedValue(lines,label){
    const rx=new RegExp(label+'\\s*'+PRINTED_MONEY,'i');
    const row=lines.find(s=>rx.test(s));
    if(!row)return null;
    const match=row.match(rx);
    if(!match)return null;
    const token=match[1];
    const n=Number(token.replace(/[+$,\s−-]/g,''));
    return Number.isFinite(n)?(/[-−]/.test(token)?-n:n):null;
  }
  function verifiedPrintedSummary(beginning,deposits,withdrawals,ending,layout){
    if([beginning,deposits,withdrawals,ending].some(v=>v===null) ||
       deposits<0 || withdrawals<0)return null;
    const difference=Math.round((beginning+deposits-withdrawals-ending)*100)/100;
    if(Math.abs(difference)>0.02)return null;
    const evidence='Bank printed account summary; balance equation verified';
    return {
      beginning,deposits,withdrawals,ending,math_diff:difference,
      confidence:100,evidence,
      equation:{beginning,deposits,withdrawals,ending,difference,
        verified:true,layout,evidence}
    };
  }
  function extractHuntingtonSummary(text){
    const head=rowLines(text).slice(0,60);
    if(!head.some(s=>/\bHuntington\b/i.test(s)) ||
       !head.some(s=>/\bStatement Activity From\s*:/i.test(s)))return null;
    const sectionEnd=head.findIndex(s=>/^Deposits\s*\(\+\)\s+Account\s*:/i.test(s));
    if(sectionEnd<0)return null;
    const section=head.slice(0,sectionEnd);
    return verifiedPrintedSummary(
      readPrintedValue(section,'\\bBeginning\\s+Balance\\b'),
      readPrintedValue(section,'\\bCredits\\s*\\(\\+\\)'),
      readPrintedValue(section,'\\bDebits\\s*\\(-\\)'),
      readPrintedValue(section,'\\bEnding\\s+Balance\\b'),
      'huntington_account_summary'
    );
  }
  function extractTwoColumnSummary(text){
    const head=rowLines(text).slice(0,50);
    if(!head.some(s=>/^Balances$/i.test(s)) ||
       !head.some(s=>/\bBeginning\s+Balance\b.*\bEnding\s+Balance\b/i.test(s)))return null;
    const withdrawal=readPrintedValue(head,'\\bWithdrawals/Debits\\b');
    return verifiedPrintedSummary(
      readPrintedValue(head,'\\bBeginning\\s+Balance\\b'),
      readPrintedValue(head,'\\bDeposits/Credits\\b'),
      withdrawal===null?null:Math.abs(withdrawal),
      readPrintedValue(head,'\\bEnding\\s+Balance\\b'),
      'bank_two_column_printed_summary'
    );
  }
  function install(){
    const e=root.ScannerEngine;
    if(!e?.applicationExtractor?.extractApplicationFields||!e?.statementDate?.recoverStatementDate||!e?.holderAddress?.sameAddress)return false;
    if(e.__v16ExtractionInstalled)return true;
    const nativeApp=e.applicationExtractor.extractApplicationFields.bind(e.applicationExtractor);
    e.applicationExtractor.extractApplicationFields=function(text,opts){
      const app=nativeApp(text,opts);
      if(app.legalName){
        const repeat=app.legalName.match(/^(.{7,90}?\b(?:LLC|INC|CORP|LTD|LIMITED))\1/i);
        if(repeat)app.legalName=repeat[1].trim();
      }
      if(!app.legalName){
        const lines=rowLines(text);
        for(let i=0;i<lines.length-1;i++){
          const fromInline=lines[i].match(/^Business Name\s*:\s*(.+?)(?=\s+DBA\s*:|\s+Mobile Number\s*:|$)/i);
          if(fromInline && /^[A-Za-z0-9&.,'\- ]{6,85}\b(?:LLC|INC|CORP|LTD|LIMITED)\b/i.test(fromInline[1])){
            app.legalName=fromInline[1].trim();break;
          }

          if(/^Business Name\s*:\s*DBA\s*:/i.test(lines[i]) &&
             /^[A-Za-z0-9&.,'\- ]{6,85}\b(?:LLC|INC|CORP|LTD|LIMITED)\b/i.test(lines[i+1])){
            app.legalName=lines[i+1].trim();break;
          }
        }
      }
      const address=extractBusinessAddress(text);
      if(address)Object.assign(app,{address:address.address,city:address.city,state:address.state,zip:address.zip});
      else if(app.address){app.address=null;app.city=null;app.state=null;app.zip=null;}
      app.appDate=extractApplicationDate(text);
      if(app.businessStartDate&&!dateFromText(app.businessStartDate))app.businessStartDate=null;
      if(app.appDate&&app.dob&&dateFromText(app.appDate)===dateFromText(app.dob))app.appDate=null;
      return app;
    };
    const nativeDate=e.statementDate.recoverStatementDate.bind(e.statementDate);
    e.statementDate.recoverStatementDate=(text,filename)=>recoverStatementDate(text,filename,nativeDate);
    const nativeHolder=e.holderAddress.extractHolderAddress.bind(e.holderAddress);
    e.holderAddress.extractHolderAddress=(text,opts)=>extractStatementHolder(text,opts,nativeHolder);
    e.holderAddress.compareAddress=compareAddress;
    e.holderAddress.sameAddress=(a,b)=>compareAddress(a,b)==='same';
    // Select one verified printed-summary route, otherwise use the native parser.
    const nativeSummary=e.summaryExtractor.extractSummary.bind(e.summaryExtractor);
    e.summaryExtractor.extractSummary=(text,opts)=>extractHuntingtonSummary(text)||extractTwoColumnSummary(text)||nativeSummary(text,opts);

    e.__v16ExtractionInstalled=true;
    return true;
  }
  if(!install()){let count=0;const timer=setInterval(()=>{if(install()||++count>=200)clearInterval(timer);},25);}
  if(typeof module!=='undefined'&&module.exports)module.exports={install,extractBusinessAddress,extractApplicationDate,recoverStatementDate,compareAddress,extractHuntingtonSummary,extractTwoColumnSummary};
})(typeof window!=='undefined'?window:globalThis);
