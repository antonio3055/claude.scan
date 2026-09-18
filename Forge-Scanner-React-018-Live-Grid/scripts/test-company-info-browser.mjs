/**
 * What the statements say the company is — proved in a real browser.
 *
 * A business is often banked under a name that is not the one on its
 * incorporation, and the bank often holds an address the application has moved
 * on from. Both have to reach the company record, and the difference has to be
 * visible. This drives the built app, offline, and reads what it actually
 * stored and rendered.
 *
 * The Results sheet (LeadsSheet.tsx) is the current, single source of truth
 * for this -- there is no separate side panel any more (that three-panel
 * design was replaced; see SESSION_LOG.md). The application's own value
 * always sits as the cell's primary text; a difference from the statements
 * is a small "⚠" badge next to it, never a swap.
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
  await scanner.page.waitForTimeout(300); // let the Results sheet re-render after the last document settles

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

  // Everything below reads the rendered Results row, not the stored record.
  const resultsCell = (index) =>
    scanner.page.evaluate((i) => {
      const row = document.querySelector('.leads-sheet .sheet-row:not(.sheet-head-row)');
      const cell = row?.querySelectorAll('.sheet-cell')[i];
      if (!cell) return null;
      const amber = cell.querySelector('.flag-amber')?.textContent ?? null;
      const altRaw = cell.querySelector('.flag-alt')?.textContent ?? null;
      const differsValue = altRaw ? altRaw.replace(/^\s*\(|\)\s*$/g, '') : null;
      const primary = amber ?? (cell.textContent ?? '').trim();
      return { primary, differsValue };
    }, index);

  // Column order (DEFAULT_ORDER in LeadsSheet.tsx): company, owner, revenue,
  // approval, phone, email, address, appDate, statements, bank, bsd, mca, score.
  // Cell 0 is the row number, so company is 1 and address is 7.
  const COMPANY_CELL = 1;
  const OWNER_CELL = 2;
  const ADDRESS_CELL = 7;
  const BANK_CELL = 10;

  await reporter.check('a Results row was rendered for this company', async () => {
    assert.ok(await resultsCell(COMPANY_CELL), 'no Results row was found');
  });

  await reporter.check("the company cell's primary text is the application's own legal name", async () => {
    const cell = await resultsCell(COMPANY_CELL);
    assert.equal(cell.primary, 'Datalab Infotech Corporation');
  });

  await reporter.check('the statement name and DBA are flagged as differing from the application', async () => {
    const cell = await resultsCell(COMPANY_CELL);
    assert.match(cell.differsValue ?? '', /DATALAB INFOTECH INC/);
    assert.match(cell.differsValue ?? '', /Datalab Print Shop/);
  });

  await reporter.check("nothing the statement says replaces the application's own name", async () => {
    const cell = await resultsCell(COMPANY_CELL);
    assert.doesNotMatch(cell.primary, /DATALAB INFOTECH INC|Print Shop/);
  });

  await reporter.check("the address cell's primary text is the application's own address", async () => {
    const cell = await resultsCell(ADDRESS_CELL);
    assert.equal(cell.primary, '900 OLD MILL RD, PLANO, TX 75024');
  });

  await reporter.check('the statement address is flagged as differing from the application', async () => {
    const cell = await resultsCell(ADDRESS_CELL);
    assert.match(cell.differsValue ?? '', /1201 RICHARDSON DR STE 180, RICHARDSON, TX 75080-4610/);
  });

  await reporter.check('the application owner and bank name are shown', async () => {
    assert.equal((await resultsCell(OWNER_CELL)).primary, 'Dana Reed');
    assert.equal((await resultsCell(BANK_CELL)).primary, 'Bank of America');
  });

  await reporter.check('nothing reached the network and no page error was raised', async () => {
    assert.deepEqual(scanner.externalAttempts, []);
    assert.deepEqual(scanner.pageErrors, []);
  });
} finally {
  await scanner.close();
}

reporter.done();
