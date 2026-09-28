/* Application extraction upgraded with ScannerCRM-v10 production rules. */
(function (root) {
  'use strict';
  const U=root.ScannerEngine.coreUtils;
  const {cleanSpace,cleanLines,digits,moneyVals,parseDate}=U;
  function folderOf(name){const parts=String(name||'').split('/').filter(Boolean);return parts.length>1?parts[parts.length-2]:'';}
function valueAfter(text, labels, maxLen = 140) {
  const lines = cleanLines(text);
  for (const line of lines) {
    const low = line.toLowerCase();
    for (const label of labels) {
      const idx = low.indexOf(label);
      if (idx >= 0) {
        const val = line.slice(idx + label.length).replace(/^[\s:#\-|]+/, '').trim();
        if (val.length > 1) return val.slice(0, maxLen);
      }
    }
  }
  for (let i = 0; i < lines.length - 1; i++) {
    const low = lines[i].toLowerCase();
    if (labels.some(label => low.includes(label))) return lines[i + 1].slice(0, maxLen);
  }
  return '';
}
function cleanCompany(value) {
  let v = cleanSpace(value).replace(/^(legal company name|legal business name|business name|company name|dba)\s*:?\s*/i, '');
  v = v.replace(/[^A-Za-z0-9&.,'\- /]/g, '').trim();
  return /[A-Za-z]{3}/.test(v) ? v.slice(0, 90) : '';
}
// Whole words only: stripping "mar" out of "Marquetta" left "c d quetta Jones".
const FILENAME_NOISE = /\b(?:use this app|application|statement|bank|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b|\d+/gi;
// A filename made only of these names the kind of file, not the company:
// every application in a CRM export is called "APP.pdf".
const GENERIC_FILENAME = /^(?:app|apps|application|form|img|image|scan|scanned|doc|document|file|copy|signed|final|summary|mtd|new|submission)(?:\s+(?:app|copy|signed|final))*$/i;
function companyFromFilename(filename) {
  const base = String(filename || '').split('/').pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_\-]+/g, ' ').replace(FILENAME_NOISE, ' ');
  const words = cleanSpace(base).split(' ').filter((word) => word.length > 1 || /^&$/.test(word));
  const name = cleanCompany(words.join(' '));
  return GENERIC_FILENAME.test(name) ? '' : name;
}
// Words that only ever appear in a form's own printed labels. A "value" made
// of nothing but these is the next field's label, not an answer -- forms that
// print every label first and every answer in a block below them read as
// "Business Name: DBA: Mobile Number:".
const LABEL_WORDS = new Set(('legal business company corporate name names dba d/b/a doing as mobile cell phone number email e-mail address ' +
  'city state zip code first last middle full owner owners ownership percentage percent % of date birth dob ssn social security ' +
  'ein tax id federal type entity title start signature home website industry category incorporation structure information ' +
  'details years at est est. month year no no. # financial requested amount principal applicant primary business information ' +
  'use funds loan the your print printed contact preferred ' +
  // An entity-type checkbox list ("LP Corp / LLP LLC / Sole Prop") is options, not an answer.
  'lp llp llc corp corp. inc inc. partnership sole prop prop. proprietorship non profit other yes corporation').split(' '));
const US_STATES = new Set('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY PR'.split(' '));
function looksLikeLabel(value) {
  const v = cleanSpace(value);
  if (!v) return true;
  if (/:\s*$/.test(v) || (v.match(/:/g) || []).length >= 2) return true;
  const words = v.toLowerCase().replace(/[():,]/g, ' ').split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((word) => LABEL_WORDS.has(word));
}
/**
 * The answer printed against a label: on the same line after it, or -- for
 * forms that set the label above its answer -- on the next line. A label
 * followed only by another label has no answer on this form.
 */
function labeledValue(lines, labels, accept) {
  for (const label of labels) {
    const lab = label.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const low = lines[i].toLowerCase();
      const idx = low.indexOf(lab);
      if (idx < 0) continue;
      // The label must start a word: "Business Name" is not inside "DBA Business Name".
      if (idx > 0 && /[a-z0-9]/i.test(low[idx - 1])) continue;
      // Cut at the next known field ("Michael Materasso   Full Name:" on a
      // two-column form), but judged before boundedField trims the trailing
      // colon that gives a label away.
      const rawSame = cleanSpace(lines[i].slice(idx + label.length).replace(/^[\s:#\-|]+/, '').split(FIELD_BOUNDARY)[0]);
      const sameIsLabel = looksLikeLabel(rawSame);
      if (!sameIsLabel) {
        const value = accept(boundedField(rawSame));
        if (value) return value;
      } else {
        // An answer on its own line carries no label, so no colon either.
        const rawNext = cleanSpace(lines[i + 1] || '');
        if (rawNext && !rawNext.includes(':') && !looksLikeLabel(rawNext)) {
          const value = accept(boundedField(rawNext));
          if (value) return value;
        }
      }
    }
  }
  return '';
}
// Unlabelled next fields that run on after a company name on one line.
const COMPANY_TAIL = /\s+(?=(?:Business Address|Business Start Date|Doing Business As|Legal Entity|Entity Type|Industry|Federal Tax|Tax ID|Business Phone)\b)/i;
const COMPANY_LABELS = ['Legal Company Name', 'Legal Business Name', 'Business Legal Name', 'Company Legal Name', 'Legal/Corporate Name', 'Corporate Name', 'Business Name', 'Company Name'];
function companyFromForm(lines) {
  return labeledValue(lines, COMPANY_LABELS, (value) => {
    const name = cleanCompany(value.split(COMPANY_TAIL)[0]);
    return name && !looksLikeLabel(name) ? name : '';
  });
}
const OWNER_LABELS = ['Full Name', 'Full Legal Name', 'Owner Name', 'Owner Full Name', 'Your Full Name', 'Name Printed', 'Printed Name', 'Print Name', 'Applicant Name', 'Principal Name', 'Guarantor Name'];
const NOT_A_PERSON = /\b(?:name|fico|score|credit|percentage|ownership|date|birth|ssn|social|address|phone|email|title|signature|llc|inc|corp|company)\b/i;
function personName(value) {
  const v = cleanSpace(String(value || '').replace(/^[-–\s]*owner\s*#?\s*\d*\s*[:\-]?\s*/i, '')).replace(/\s*:\s*$/, '');
  if (!v || looksLikeLabel(v) || NOT_A_PERSON.test(v)) return '';
  const words = v.split(' ');
  if (words.length < 2 || words.length > 5) return '';
  return words.every((word) => /^[A-Za-z][A-Za-z.'\-]*$/.test(word)) ? v : '';
}
/** "Name" on its own is only an owner's name inside an owner section, or when it plainly reads as one. */
function ownerFromSection(lines) {
  let ownerSectionEnds = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/\b(?:owner|principal|guarantor|applicant)\b.{0,30}\b(?:information|info|details)\b/i.test(lines[i])) ownerSectionEnds = i + 15;
    const m = lines[i].match(/^name\b(?!\s*of)\s*:?\s*(.*)$/i);
    if (!m) continue;
    const candidate = personName(m[1]) || (!m[1] ? personName(lines[i + 1]) : '');
    if (!candidate) continue;
    const strictlyCapitalised = candidate.split(' ').every((word) => /^[A-Z]/.test(word));
    if (i <= ownerSectionEnds || strictlyCapitalised) return candidate;
  }
  return '';
}
function valueAfterFrom(lines, label, startIdx, endIdx) {
  const lab = String(label || '').toLowerCase();
  startIdx = Math.max(0, startIdx || 0);
  endIdx = Math.min(lines.length, endIdx == null ? lines.length : endIdx);
  for (let i = startIdx; i < endIdx; i++) {
    const line = String(lines[i] || '');
    const low = line.toLowerCase();
    if (low.startsWith(lab)) return { value: line.slice(label.length).replace(/^[\s:#\-|]+/, '').trim(), index: i };
    const idx = low.indexOf(lab);
    if (idx >= 0) return { value: line.slice(idx + label.length).replace(/^[\s:#\-|]+/, '').trim(), index: i };
  }
  return { value: '', index: -1 };
}
const FIELD_BOUNDARY = /\s+(?=(?:City|State|Zip|Full Name|First Name|Last Name|Date of Birth|DOB|Monthly Credit Card Processing|Home Address|Business Telephone|Mobile|Email|Signature|Title)\s*:)/i;
function boundedField(value) {
  return cleanSpace(String(value || '').split(FIELD_BOUNDARY)[0]).replace(/\s*:\s*$/, '').trim();
}
function normalizeDOB(v) {
  v = boundedField(String(v || '').replace(/\s+0:00:00\b/i, ''));
  if (!v) return '';
  if (/\b[A-Za-z]{3,9},?\s+\d{1,2},?\s+\d{2}\b/.test(v) && !/\b(?:19|20)\d{2}\b/.test(v)) return '';
  let m = v.match(/\b((?:19|20)\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (m) return String(m[2]).padStart(2, '0') + '/' + String(m[3]).padStart(2, '0') + '/' + m[1].slice(-2);
  m = v.match(/\b(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})\b/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y >= 30 ? 1900 : 2000;
    return String(m[1]).padStart(2, '0') + '/' + String(m[2]).padStart(2, '0') + '/' + String(y).slice(-2);
  }
  const d = parseDate(v);
  if (d && d.getFullYear() >= 1900 && d.getFullYear() <= new Date().getFullYear()) return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + String(d.getFullYear()).slice(-2);
  return ''; // incomplete or ambiguous DOB is safer left for review
}
function extractApplicationRevenue(lines) {
  const monthlyLabels = /^(?:average\s+)?(?:gross\s+)?monthly\s+(?:business\s+)?(?:revenue|sales)(?:\s*[:#-])?/i;
  const annualLabels = /^(?:average\s+)?(?:gross\s+)?(?:annual|yearly)\s+(?:business\s+)?revenue(?:\s*[:#-])?/i;
  const moneyOnly = /^\s*\(?\$?\s*[0-9]{1,3}(?:,[0-9]{3})*(?:\.\d{2})?\)?\s*$/;
  const readValue = (index, labelPattern) => {
    const line = cleanSpace(lines[index]);
    const remainder = cleanSpace(line.replace(labelPattern, ''));
    const sameLine = moneyVals(remainder).filter(v => v > 0);
    if (sameLine.length) return sameLine[0];
    const next = cleanSpace(lines[index + 1] || '');
    if (moneyOnly.test(next)) {
      const values = moneyVals(next).filter(v => v > 0);
      if (values.length) return values[0];
    }
    return null;
  };
  for (let i = 0; i < lines.length; i++) {
    if (monthlyLabels.test(cleanSpace(lines[i]))) {
      const value = readValue(i, monthlyLabels);
      if (value != null) return { value: Math.round(value), source: 'application monthly revenue' };
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (annualLabels.test(cleanSpace(lines[i]))) {
      const value = readValue(i, annualLabels);
      if (value != null) return { value: Math.round(value / 12), source: 'application annual revenue divided by 12' };
    }
  }
  return { value: null, source: 'application revenue not found' };
}
function cleanAddressPart(value) {
  return cleanSpace(value)
    .replace(/\b(?:Business Address|Address|City|State|Zip(?: Code)?)\s*:\s*/gi, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/(?:,\s*){2,}/g, ', ')
    .replace(/^,|,$/g, '')
    .trim();
}
function normalizeDateField(value) {
  const raw = boundedField(String(value || '').replace(/\s+0:00:00\b/i, ''));
  if (!raw) return '';
  let m = raw.match(/\b((?:19|20)\d{2})[\/-](\d{1,2})[\/-](\d{1,2})\b/);
  if (m) return String(m[2]).padStart(2,'0') + '/' + String(m[3]).padStart(2,'0') + '/' + m[1];
  const cleaned = raw.replace(/^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+/i, '');
  const d = parseDate(cleaned);
  if (!d || Number.isNaN(d.getTime())) return '';
  return String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0') + '/' + d.getFullYear();
}
// A line that starts another field: the date being looked for is not past it.
const OTHER_FIELD_LINE = /^(?:city|state|zip|phone|email|address|ssn|ein|tax id)\b|\b(?:birth|dob|signature|signed|social security)\b|^[^:]{1,40}:\s*$/i;
/**
 * The date printed against a label. `isDate` says whether a candidate really
 * is one: when the text beside the label is not ("Business start date under /
 * current ownership / Feb 27, 2022"), the next few lines are tried instead.
 */
function labeledDateValue(lines, labels, isDate = (value) => Boolean(value)) {
  for (let i = 0; i < lines.length; i++) {
    const low = lines[i].toLowerCase();
    for (const label of labels) {
      const idx = low.indexOf(label.toLowerCase());
      if (idx < 0) continue;
      let same = boundedField(lines[i].slice(idx + label.length).replace(/^[\s:#\-|]+/, ''));
      if (same) {
        const hasMonthDay = /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}/i.test(same);
        const hasYear = /\b(?:19|20)\d{2}\b/.test(same);
        if (hasMonthDay && !hasYear) {
          for (let j = i + 1; j < Math.min(lines.length, i + 6); j++) {
            const year = lines[j].match(/\b(?:19|20)\d{2}\b/);
            if (year) { same += ' ' + year[0]; break; }
          }
        }
        if (isDate(same)) return same;
      }
      for (let j = i + 1; j < Math.min(lines.length, i + 4); j++) {
        const candidate = boundedField(lines[j]);
        if (OTHER_FIELD_LINE.test(candidate)) break;
        if (candidate && isDate(candidate)) return candidate;
      }
    }
  }
  return '';
}
function extractApplicationEmails(text) {
  const raw = String(text || '').replace(/\u00a0/g, ' ');
  const candidates = [
    raw,
    raw.replace(/\s*@\s*/g, '@').replace(/\s*\.\s*(?=[A-Za-z]{2,}(?:\s|$))/g, '.'),
    raw.replace(/[\r\n]+/g, ' ').replace(/\s*@\s*/g, '@').replace(/\s*\.\s*/g, '.')
  ];
  const found = [];
  for (const source of candidates) {
    const matches = source.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi) || [];
    for (const email of matches) {
      const cleaned = email.toLowerCase().replace(/^\.+|\.+$/g, '');
      if (cleaned.length <= 254 && !found.includes(cleaned)) found.push(cleaned);
    }
  }
  return found.slice(0, 8);
}
const APP_DATE_EXCLUDED_LABEL = /date of birth|\bdob\b|business start date|\bstart date\b|date established|date business started/i;
/** The signature date near the AUTHORIZATIONS block — not DOB, not business start date. */
function extractAppDate(lines) {
  const authIdx = lines.findIndex((line) => /\bauthorizations?\b/i.test(line));
  const window = lines.slice(authIdx >= 0 ? authIdx : 0, (authIdx >= 0 ? authIdx : 0) + 60);
  const labels = ['date signed', 'signature date', 'signed on', 'date'];
  for (let i = 0; i < window.length; i++) {
    const low = window[i].toLowerCase();
    if (APP_DATE_EXCLUDED_LABEL.test(low)) continue;
    for (const label of labels) {
      const idx = low.indexOf(label);
      if (idx < 0) continue;
      const sameLine = boundedField(window[i].slice(idx + label.length).replace(/^[\s:#\-|]+/, ''));
      const normalized = normalizeDateField(sameLine);
      if (normalized) return normalized;
      for (let j = i + 1; j < Math.min(window.length, i + 3); j++) {
        if (APP_DATE_EXCLUDED_LABEL.test(window[j].toLowerCase())) break;
        const candidate = normalizeDateField(window[j]);
        if (candidate) return candidate;
      }
    }
  }
  return '';
}
function extractApp(text, src) {
  const r = { kind: 'application', src, folder: folderOf(src), phones: [], emails: [] };
  const lines = String(text || '').split(/\n+/).map(x => String(x || '').trim()).filter(Boolean);
  const joined = lines.join('\n');
  const formCompany = companyFromForm(lines);
  r.company = formCompany || companyFromFilename(src);
  r.company_source = formCompany ? 'form' : r.company ? 'filename' : '';
  const first = boundedField(valueAfterFrom(lines, 'First Name', 0).value).replace(/[^A-Za-z\- ]/g, '').trim();
  const last = boundedField(valueAfterFrom(lines, 'Last Name', 0).value).replace(/[^A-Za-z\- ]/g, '').trim();
  r.owner = labeledValue(lines, OWNER_LABELS, personName) || personName(first + ' ' + last) || ownerFromSection(lines);
  const baddr = valueAfterFrom(lines, 'Business Address', 0);
  const addressLine = lines[baddr.index] || '';
  const structuredAddress = addressLine.match(/Business Address\s*:\s*(.*?)\s+City\s*:\s*(.*?)\s+State\s*:\s*([A-Za-z]{2})\s+Zip(?: Code)?\s*:\s*([0-9-]+)/i);
  let street = structuredAddress ? structuredAddress[1] : boundedField(baddr.value);
  const blockStart = baddr.index >= 0 ? baddr.index : 0;
  let city = structuredAddress ? structuredAddress[2] : boundedField(valueAfterFrom(lines, 'City', blockStart, blockStart + 18).value);
  let state = structuredAddress ? structuredAddress[3] : boundedField(valueAfterFrom(lines, 'State', blockStart, blockStart + 18).value);
  let zip = structuredAddress ? structuredAddress[4] : boundedField(valueAfterFrom(lines, 'Zip', blockStart, blockStart + 18).value);
  street = cleanAddressPart(street);
  city = cleanAddressPart(city);
  state = cleanAddressPart(state).replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 2);
  zip = cleanAddressPart(zip).match(/\b\d{5}(?:-\d{4})?\b/)?.[0] || '';
  // On a form whose answers are not in its text, every "value" here is the
  // next label ("City: State: Zip Code:" read as a street of "Zip Code").
  // A street has a number; a city is not a label; a state is a real one.
  if (!/\d/.test(street) || looksLikeLabel(street)) street = '';
  if (looksLikeLabel(city)) city = '';
  if (!US_STATES.has(state)) state = '';
  const locality = [city, state].filter(Boolean).join(', ') + (zip ? ' ' + zip : '');
  r.address = [street, locality].filter(Boolean).join(', ').replace(/\s+,/g, ',').replace(/(?:,\s*){2,}/g, ', ').trim();
  r.dob = normalizeDOB(labeledDateValue(lines,['Date of Birth','DOB','Birth Date'], normalizeDOB));
  r.start_date = normalizeDateField(labeledDateValue(lines,['Business Start Date','Start Date','Date Business Started','Business Established','Date Established'], normalizeDateField));
  r.app_date = extractAppDate(lines);
  const ssn = joined.match(/(?:Social Security NO|Social Security|SSN)[^\d]{0,20}(\d{3})[-\s]?(\d{2})[-\s]?(\d{4})/i);
  r.ssn = ssn ? ssn[1] + '-' + ssn[2] + '-' + ssn[3] : '';
  const ein = joined.match(/(?:Tax ID|EIN|Federal Tax ID)[^\d]{0,20}(\d{2})[-\s]?(\d{7})/i) || joined.match(/\b(\d{2})[-\s](\d{7})\b/);
  r.ein = ein ? ein[1] + '-' + ein[2] : '';
  const rawPhones = joined.match(/(?:\+?1[\s.\-]?)?\(?([2-9]\d{2})\)?[\s.\-]?([2-9]\d{2})[\s.\-]?(\d{4})/g) || [];
  r.phones = [...new Set(rawPhones.map(p => digits(p).slice(-10)).filter(d => d.length === 10).map(d => '(' + d.slice(0,3) + ') ' + d.slice(3,6) + '-' + d.slice(6)))].slice(0, 8);
  r.emails = extractApplicationEmails(joined);
  const revenueResult = extractApplicationRevenue(lines);
  r.revenue = revenueResult.value;
  r.revenue_source = revenueResult.source;
  return r;
}
  function maskSsn(ssn){const d=digits(ssn);return d.length>=4?`XXX-XX-${d.slice(-4)}`:null;}
  function extractApplicationFields(text, opts){
    const r=extractApp(text, opts?.filename || '');
    const nameParts=String(r.owner||'').trim().split(/\s+/).filter(Boolean);
    return {
      legalName:r.company||null,
      /** 'form' when printed against a name label; 'filename' when only the file's name offered one. */
      legalNameSource:r.company_source||null,
      dba:null,
      firstName:nameParts[0]||null,
      lastName:nameParts.length>1?nameParts.slice(1).join(' '):null,
      fullName:r.owner||null,
      address:r.address||null,
      city:null,
      state:null,
      zip:null,
      dob:r.dob||null,
      businessStartDate:r.start_date||null,
      appDate:r.app_date||null,
      ssn:maskSsn(r.ssn),
      ein:r.ein||null,
      phones:r.phones||[],
      emails:r.emails||[],
      statedRevenue:r.revenue==null?null:Number(r.revenue),
      revenueSource:r.revenue_source||null,
      source:'application_document_v10',
    };
  }
  /**
   * The answers an application is read for, each either found or not. The
   * company only counts when the form itself printed it -- a name guessed from
   * the file's name is no evidence the form was read.
   */
  function applicationFieldChecks(fields){
    const f=fields||{};
    return [
      {field:'Company',found:Boolean(f.legalName)&&f.legalNameSource!=='filename'},
      {field:'Owner',found:Boolean(f.fullName)},
      {field:'Phone',found:Boolean(f.phones&&f.phones.length)},
      {field:'Email',found:Boolean(f.emails&&f.emails.length)},
      {field:'Address',found:Boolean(f.address)},
      {field:'Start date',found:Boolean(f.businessStartDate)},
      {field:'EIN',found:Boolean(f.ein)},
      {field:'DOB',found:Boolean(f.dob)},
    ];
  }
  const api={extractApplicationFields,extractApplicationRevenue,normalizeDOB,normalizeDateField,extractApplicationEmails,applicationFieldChecks,companyFromFilename};
  if(root){root.ScannerEngine=root.ScannerEngine||{};root.ScannerEngine.applicationExtractor=api;}
})(typeof window!=='undefined'?window:typeof globalThis!=='undefined'?globalThis:this);
