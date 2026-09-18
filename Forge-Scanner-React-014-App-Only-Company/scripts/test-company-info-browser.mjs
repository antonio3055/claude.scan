/**
 * What the statements say the company is — proved in a real browser.
 *
 * A business is often banked under a name that is not the one on its
 * incorporation, and the bank often holds an address the application has moved
 * on from. Both have to reach the company record, and the difference has to be
 * visible. This drives the built app, offline, and reads what it actually
 * stored and rendered.
 */

import assert from 'node:assert/strict';
import { createReporter } from './lib/report.mjs';
import { buildPdf } from './lib/fixtures.mjs';
import { launchScanner } from './lib/browser-harness.mjs';

const reporter = createReporter('Company info tests');

/** The application: the incorporated name and the address it was filed with. */
const APPLICATION = buildPdf([[
  'Business Funding Application',
  'Legal company name: Datalab Infotech Corporation',
  'DBA: Datalab',
  'Business owner information',
  'Full Name: Dana Reed',
  'Business Address: 900 OLD MILL RD City: PLANO State: TX Zip: 75024',
  'Social security no: 000-00-0000',
  '% ownership: 100',
  'Requested financing amount: $150,000',
  'Use of funds: equipment',
  'Business start date: 01/2019',
  'Average monthly revenue: $60,000'
]]);

/** The statement: the trading name, a DBA, and the address the bank writes to. */
const STATEMENT = buildPdf([[
  'P.O. Box 15284',
  'Customer service information',
  'Wilmington, DE 19850',
  'DATALAB INFOTECH INC',
  'Bank of America, N.A.',
  '1201 RICHARDSON DR STE 180',
  'P.O. Box 25118',
  'RICHARDSON, TX 75080-4610',
  'Tampa, FL 33622-5118',
  'DBA: Datalab Print Shop',
  'Account summary',
  'Beginning balance on January 1, 2026 $8,059.65',
  'Deposits and other credits 67,413.88',
  'Withdrawals and other debits -60,000.00',
  'Ending balance on January 31, 2026 $15,473.53',
  'Transaction description daily balance'
]]);

const scanner = await launchScanner();

try {
  await scanner.open();
  await scanner.addFiles([
    { name: 'USE_THIS_APP.pdf', bytes: APPLICATION },
    { name: 'jan-statement.pdf', bytes: STATEMENT }
  ]);

  const statement = await scanner.waitForDocument('jan-statement.pdf', 120_000);
  await scanner.waitForDocument('USE_THIS_APP.pdf', 120_000);

  await reporter.check('the statement carries the name the bank printed', async () => {
    assert.equal(statement.statementIdentity?.name, 'DATALAB INFOTECH INC');
  });

  await reporter.check('the statement carries the DBA it printed', async () => {
    assert.equal(statement.statementIdentity?.dba, 'Datalab Print Shop');
  });

  await reporter.check('the statement carries the address the bank writes to', async () => {
    assert.equal(statement.statementIdentity?.address, '1201 RICHARDSON DR STE 180, RICHARDSON, TX 75080-4610');
    assert.equal(statement.statementIdentity?.town, 'RICHARDSON');
    assert.equal(statement.statementIdentity?.state, 'TX');
    assert.equal(statement.statementIdentity?.postcode, '75080-4610');
  });

  await reporter.check("the bank's own address is not stored as the company's", async () => {
    const address = String(statement.statementIdentity?.address ?? '');
    assert.ok(!/Tampa|Wilmington|15284|25118/i.test(address), `stored the bank's address: ${address}`);
  });

  // Everything below reads the rendered panel, not the stored record.
  const panel = () =>
    scanner.page.evaluate(() => {
      const section = [...document.querySelectorAll('section')].find((node) =>
        /on the bank statements/i.test(node.querySelector('h3')?.textContent ?? '')
      );
      if (!section) return null;
      const rows = [...section.querySelectorAll('dl > div')].map((row) => ({
        label: row.querySelector('dt')?.textContent ?? '',
        value: row.querySelector('dd')?.textContent ?? ''
      }));
      return { rows, differs: [...section.querySelectorAll('.differs')].length };
    });

  const blockLabels = (heading) =>
    scanner.page.evaluate((wanted) => {
      const section = [...document.querySelectorAll('.paired-info section')].find(
        (node) => (node.querySelector('h3')?.textContent ?? '').trim().toLowerCase() === wanted
      );
      return [...(section?.querySelectorAll('dt') ?? [])].map((node) => (node.textContent ?? '').trim());
    }, heading);

  await reporter.check('the panel has a section for what the statements say', async () => {
    assert.ok(await panel(), 'no "On the bank statements" section was rendered');
  });

  await reporter.check('the company block carries the application fields and nothing else', async () => {
    assert.deepEqual(await blockLabels('company'), ['Legal name', 'DBA', 'EIN', 'DOB', 'Address']);
  });

  await reporter.check('the contact block carries the application fields and nothing else', async () => {
    assert.deepEqual(await blockLabels('contact'), ['Owner', 'Mobile', 'Mobile 2', 'Mobile 3', 'Email']);
  });

  await reporter.check('nothing the statements say is mixed into the company block', async () => {
    const shown = await scanner.page.evaluate(() => {
      const section = [...document.querySelectorAll('.paired-info section')].find(
        (node) => (node.querySelector('h3')?.textContent ?? '').trim().toLowerCase() === 'company'
      );
      return [...(section?.querySelectorAll('dd') ?? [])].map((node) => (node.textContent ?? '').trim());
    });
    assert.ok(!shown.some((text) => /DATALAB INFOTECH INC|RICHARDSON DR|Print Shop/.test(text)),
      `the company block shows statement values: ${shown.join(' | ')}`);
  });

  await reporter.check('the statement name is shown', async () => {
    const { rows } = await panel();
    assert.match(rows.find((row) => /^name/i.test(row.label))?.value ?? '', /DATALAB INFOTECH INC/);
  });

  await reporter.check('the statement DBA is shown', async () => {
    const { rows } = await panel();
    assert.match(rows.find((row) => /dba/i.test(row.label))?.value ?? '', /Datalab Print Shop/);
  });

  await reporter.check('the statement address is shown', async () => {
    const { rows } = await panel();
    assert.match(rows.find((row) => /address/i.test(row.label))?.value ?? '', /1201 RICHARDSON DR STE 180/);
  });

  await reporter.check('DBA and DOB are separate fields, both from the application', async () => {
    const rows = await scanner.page.evaluate(() => {
      const section = [...document.querySelectorAll('.paired-info section')].find(
        (node) => (node.querySelector('h3')?.textContent ?? '').trim().toLowerCase() === 'company'
      );
      return [...(section?.querySelectorAll('dl > div') ?? [])].map((row) => ({
        label: (row.querySelector('dt')?.textContent ?? '').trim(),
        value: (row.querySelector('dd')?.textContent ?? '').trim()
      }));
    });
    // DBA is the trading name; DOB is the owner's date of birth. Different
    // fields that happen to look alike written short.
    assert.equal(rows.find((row) => row.label === 'DBA')?.value, '—', 'this application prints no DBA');
    assert.ok(rows.find((row) => row.label === 'DOB'), 'the date of birth is missing from the company block');
  });

  await reporter.check('the name and address that differ are marked, the DBA is not', async () => {
    const { rows, differs } = await panel();
    // The application carries no DBA, so the statement's is the only one there
    // is — reported, but not a difference from anything.
    assert.equal(differs, 2, `expected the name and the address to be marked, got ${differs}`);
    assert.match(rows.find((row) => /^name/i.test(row.label))?.label ?? '', /differs/i);
    assert.match(rows.find((row) => /address/i.test(row.label))?.label ?? '', /differs/i);
    assert.doesNotMatch(rows.find((row) => /dba/i.test(row.label))?.label ?? '', /differs/i);
  });

  await reporter.check('the application fields are still shown beside them', async () => {
    const shown = await scanner.page.evaluate(() => {
      const section = [...document.querySelectorAll('.paired-info section')].find((node) =>
        /^company$/i.test((node.querySelector('h3')?.textContent ?? '').trim())
      );
      return [...(section?.querySelectorAll('dd') ?? [])].map((node) => node.textContent);
    });
    assert.ok(shown.some((text) => /Datalab Infotech Corporation/.test(text ?? '')), 'the legal name is missing');
    assert.ok(shown.some((text) => /900 OLD MILL RD/.test(text ?? '')), 'the application address is missing');
  });

  await reporter.check('nothing reached the network and no page error was raised', async () => {
    assert.deepEqual(scanner.externalAttempts, []);
    assert.deepEqual(scanner.pageErrors, []);
  });
} finally {
  await scanner.close();
}

reporter.done();
