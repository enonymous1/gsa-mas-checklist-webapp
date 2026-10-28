import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  FakeSheet,
  FakeSpreadsheet,
  createGasContext,
  makeValidation,
} from './gas-mocks.mjs';

const CHECKLIST_ID = 'checklist-spreadsheet-id';
const SIN_ID = 'sin-spreadsheet-id';

function checklistSpreadsheet(sheets) {
  return new FakeSpreadsheet(CHECKLIST_ID, sheets);
}

function baseSheets() {
  const main = new FakeSheet('Parsed Checklist Items', [
    ['LINE Number', 'Section', 'Required Documentation', 'User Comments'],
    [1, 'A', 'Doc one', ''],
    [2, 'A', 'Doc two', JSON.stringify([{ text: 'hello', timestamp: 't', user: 'Ana', id: 1 }])],
    [3, 'B', 'Doc three', 'plain old note'],
  ]);
  const other = new FakeSheet('Parsed Extra', [
    ['LINE Number', 'Section', 'Required Documentation'],
    [9, 'C', 'Doc nine'],
  ]);
  const offeror = new FakeSheet('Offeror Info', [
    ['Key', 'Value', 'Description'],
    ['Legal Name', 'Acme', ''],
    ['Commodity Type', '', ''],
  ], [
    [null, null, null],
    [null, null, null],
    [null, makeValidation(['Goods', 'Services']), null],
  ]);
  const resources = new FakeSheet('Relevant Resources', [
    ['Title', 'URL', 'Reasoning'],
    ['GSA eLibrary', 'https://example.test/library', 'Check offerings'],
  ]);
  return { main, other, offeror, resources };
}

function sinSpreadsheet() {
  const list = new FakeSheet('Special Item Number (SIN) List ', [
    ['SIN', 'SIN Title'],
    ['123', 'Widgets'],
  ]);
  const glossary = new FakeSheet('Glossary', [
    ['Glossary of Terms', 'Definitions'],
    ['SIN', 'Special Item Number'],
  ]);
  return new FakeSpreadsheet(SIN_ID, [list, glossary]);
}

function ctxWith(sheets, sin = sinSpreadsheet(), userEmail) {
  return createGasContext({
    properties: { CHECKLIST_SHEET_ID: CHECKLIST_ID, SIN_SHEET_ID: SIN_ID },
    spreadsheets: [sheets, sin],
    ...(userEmail !== undefined ? { userEmail } : {}),
  });
}

describe('config', () => {
  it('reads IDs from Script Properties and applies sheet-name defaults', () => {
    const { run } = ctxWith(checklistSpreadsheet([]));
    const config = run('getConfig()');
    assert.equal(config.CHECKLIST_SHEET_ID, CHECKLIST_ID);
    assert.equal(config.SIN_SHEET_ID, SIN_ID);
    assert.equal(config.CHECKLIST_SHEET, 'Parsed Checklist Items');
    assert.equal(config.SIN_SHEET, 'Special Item Number (SIN) List ');
    assert.equal(config.PROGRESS_SHEET, 'Checklist Progress');
  });

  it('throws naming the missing property when an ID is not configured', () => {
    const { run } = createGasContext({ properties: {}, spreadsheets: [] });
    assert.throws(() => run('getConfig()'), /CHECKLIST_SHEET_ID/);
  });

  it('honours sheet-name overrides from Script Properties', () => {
    const { run } = createGasContext({
      properties: {
        CHECKLIST_SHEET_ID: CHECKLIST_ID,
        SIN_SHEET_ID: SIN_ID,
        CHECKLIST_SHEET: 'Custom Main',
      },
      spreadsheets: [],
    });
    assert.equal(run('getConfig()').CHECKLIST_SHEET, 'Custom Main');
  });
});

describe('checklist read path', () => {
  it('lists Parsed sheets with the main sheet first', () => {
    const { main, other } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([other, main]));
    assert.deepEqual(run('getParsedSheetNames()'), ['Parsed Checklist Items', 'Parsed Extra']);
  });

  it('reads each sheet once, merges comments, and never writes on read', () => {
    const { main, other } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([main, other]));
    const before = JSON.stringify(main.values);
    const all = run('getAllParsedChecklists()');
    assert.equal(all['Parsed Checklist Items'].length, 3);
    assert.deepEqual(all['Parsed Checklist Items'][1].comments, [{ text: 'hello', timestamp: 't', user: 'Ana', id: 1 }]);
    // Plain-text legacy cell becomes a single comment.
    assert.equal(all['Parsed Checklist Items'][2].comments[0].text, 'plain old note');
    assert.equal(all['Parsed Extra'][0]['Required Documentation'], 'Doc nine');
    assert.equal(main.getDataRangeCalls, 1);
    assert.equal(other.getDataRangeCalls, 1);
    assert.equal(JSON.stringify(main.values), before, 'read path must not mutate the sheet');
  });

  it('loadCommentsFromSheet tolerates a missing User Comments column', () => {
    const { other } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([other]));
    assert.deepEqual(run("loadCommentsFromSheet('Parsed Extra')"), {});
  });
});

describe('comment writes', () => {
  it('appends one comment inside the lock and returns the updated list', () => {
    const { main } = baseSheets();
    const { run, fakes } = ctxWith(checklistSpreadsheet([main]));
    const updated = run(`appendCommentToSheet('Parsed Checklist Items', 1, { text: 'first', timestamp: 't1', user: 'Ana', id: 7 })`);
    assert.equal(updated.length, 1);
    assert.equal(updated[0].text, 'first');
    const again = run(`appendCommentToSheet('Parsed Checklist Items', 1, { text: 'second', timestamp: 't2', user: 'Bo', id: 8 })`);
    assert.equal(again.length, 2);
    assert.equal(again[1].text, 'second');
    assert.equal(fakes.lockState.acquired, 2);
    assert.equal(fakes.lockState.released, 2);
    // Stored as JSON in the User Comments column.
    const stored = JSON.parse(main.values[1][3]);
    assert.equal(stored.length, 2);
  });

  it('saveCommentToSheet replaces the whole list (edit/delete path)', () => {
    const { main } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([main]));
    const replaced = run(`saveCommentToSheet('Parsed Checklist Items', 2, [{ text: 'edited', timestamp: 't', user: 'Ana', id: 1 }])`);
    assert.equal(replaced.length, 1);
    assert.equal(replaced[0].text, 'edited');
  });

  it('rejects writes to non-checklist sheets', () => {
    const { main, offeror } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([main, offeror]));
    assert.throws(
      () => run(`appendCommentToSheet('Offeror Info', 1, { text: 'x' })`),
      /not a checklist sheet/,
    );
    assert.throws(
      () => run(`saveCommentToSheet('No Such Sheet', 1, [])`),
      /not a checklist sheet/,
    );
  });

  it('rejects malformed and oversized comments without writing', () => {
    const { main } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([main]));
    const before = JSON.stringify(main.values);
    assert.throws(() => run(`appendCommentToSheet('Parsed Checklist Items', 1, { text: '   ' })`), /non-empty/);
    assert.throws(() => run(`appendCommentToSheet('Parsed Checklist Items', 1, { text: 'x'.repeat(5001) })`), /exceeds/);
    assert.throws(() => run(`saveCommentToSheet('Parsed Checklist Items', 1, 'not-an-array')`), /must be an array/);
    assert.equal(JSON.stringify(main.values), before);
  });

  it('throws when the script lock cannot be acquired', () => {
    const { main } = baseSheets();
    const { run } = createGasContext({
      properties: { CHECKLIST_SHEET_ID: CHECKLIST_ID, SIN_SHEET_ID: SIN_ID },
      spreadsheets: [checklistSpreadsheet([main]), sinSpreadsheet()],
      lockAvailable: false,
    });
    assert.throws(() => run(`appendCommentToSheet('Parsed Checklist Items', 1, { text: 'x' })`), /script lock/);
  });

  it('creates the User Comments column on write when it is missing', () => {
    const { other } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([other]));
    run(`appendCommentToSheet('Parsed Extra', 9, { text: 'noted', timestamp: 't', user: 'Ana', id: 3 })`);
    assert.equal(other.values[0][3], 'User Comments');
    assert.equal(JSON.parse(other.values[1][3]).length, 1);
  });
});

describe('progress', () => {
  it('returns {} when the progress sheet does not exist (read never creates it)', () => {
    const { main } = baseSheets();
    const ss = checklistSpreadsheet([main]);
    const { run } = ctxWith(ss);
    assert.deepEqual(run('getProgress()'), {});
    assert.equal(ss.getSheetByName('Checklist Progress'), null);
  });

  it('persists ticks per user and round-trips through getProgress', () => {
    const { main } = baseSheets();
    const ss = checklistSpreadsheet([main]);
    const { run } = ctxWith(ss);
    run(`setProgress('Parsed Checklist Items', 1, true)`);
    run(`setProgress('Parsed Checklist Items', 2, true)`);
    run(`setProgress('Parsed Checklist Items', 1, false)`);
    const progress = run('getProgress()');
    assert.deepEqual(progress, { 'Parsed Checklist Items': { 2: true } });
    const sheet = ss.getSheetByName('Checklist Progress');
    assert.equal(sheet.values[0].join(','), 'Sheet,LINE Number,User,Checked,Updated');
    assert.equal(sheet.values.length, 3, 'second setProgress for line 1 updates in place');
  });

  it('isolates progress between users', () => {
    const { main } = baseSheets();
    const ss = checklistSpreadsheet([main]);
    const a = ctxWith(ss, sinSpreadsheet(), 'ana@example.test');
    const b = ctxWith(ss, sinSpreadsheet(), 'bo@example.test');
    a.run(`setProgress('Parsed Checklist Items', 1, true)`);
    assert.deepEqual(b.run('getProgress()'), {});
    assert.deepEqual(a.run('getProgress()'), { 'Parsed Checklist Items': { 1: true } });
  });

  it('rejects non-boolean checked values and anonymous users', () => {
    const { main } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([main]));
    assert.throws(() => run(`setProgress('Parsed Checklist Items', 1, 'yes')`), /boolean/);
    const anon = ctxWith(checklistSpreadsheet([main]), sinSpreadsheet(), '');
    assert.throws(() => anon.run(`setProgress('Parsed Checklist Items', 1, true)`), /no signed-in user/);
  });
});

describe('other server functions', () => {
  it('getOfferorInfo maps validations and comma lists, guarding short validation rows', () => {
    const { offeror } = baseSheets();
    const { run } = ctxWith(checklistSpreadsheet([offeror]));
    const info = run('getOfferorInfo()');
    assert.equal(info[0].key, 'Legal Name');
    assert.equal(info[0].value, 'Acme');
    assert.deepEqual(info[1].acceptedValues, ['Goods', 'Services']);
    assert.equal(info[1].value, '');
  });

  it('getOfferorInfo tolerates validation rows shorter than the data', () => {
    const short = new FakeSheet('Offeror Info', [
      ['Key', 'Value', 'Description'],
      ['Legal Name', 'Acme', ''],
    ], [[null, null, null]]);
    const { run } = ctxWith(checklistSpreadsheet([short]));
    const info = run('getOfferorInfo()');
    assert.equal(info[0].value, 'Acme');
    assert.equal(info[0].acceptedValues, null);
  });

  it('getSINList and getSINGlossary handle empty and missing sheets', () => {
    const empty = new FakeSpreadsheet(SIN_ID, [
      new FakeSheet('Special Item Number (SIN) List ', []),
    ]);
    const { run } = createGasContext({
      properties: { CHECKLIST_SHEET_ID: CHECKLIST_ID, SIN_SHEET_ID: SIN_ID },
      spreadsheets: [checklistSpreadsheet([]), empty],
    });
    assert.deepEqual(run('getSINList()'), []);
    assert.deepEqual(run('getSINGlossary()'), {}, 'missing Glossary returns {} instead of throwing');
  });

  it('getRelevantResources returns [] for a missing sheet', () => {
    const { run } = ctxWith(checklistSpreadsheet([]));
    assert.deepEqual(run('getRelevantResources()'), []);
  });

  it('getCurrentUser derives a display name and tolerates anonymous access', () => {
    const { run } = ctxWith(checklistSpreadsheet([]), sinSpreadsheet(), 'jane.q.doe@example.test');
    const user = run('getCurrentUser()');
    assert.equal(user.displayName, 'Jane Q Doe');
    assert.equal(user.hasEmail, true);
    const anon = ctxWith(checklistSpreadsheet([]), sinSpreadsheet(), '');
    const anonUser = anon.run('getCurrentUser()');
    assert.equal(anonUser.displayName, 'User');
    assert.equal(anonUser.hasEmail, false);
  });
});
