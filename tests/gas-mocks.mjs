// In-memory fakes for the Apps Script services the server code uses.
// These model only the API surface the code under test actually calls;
// they do not model Google services. Each test gets a fresh context
// through createGasContext() so sheet state never leaks between tests.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

class FakeRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const row = [];
      for (let c = 0; c < this.numCols; c += 1) {
        row.push(this.sheet.cell(this.row + r, this.col + c));
      }
      out.push(row);
    }
    return out;
  }

  getDataValidations() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const row = [];
      for (let c = 0; c < this.numCols; c += 1) {
        row.push(this.sheet.validation(this.row + r, this.col + c));
      }
      out.push(row);
    }
    return out;
  }

  setValue(value) {
    this.sheet.setCell(this.row, this.col, value);
    return this;
  }

  setValues(values) {
    values.forEach((row, r) => {
      row.forEach((value, c) => {
        this.sheet.setCell(this.row + r, this.col + c, value);
      });
    });
    return this;
  }
}

export class FakeSheet {
  constructor(name, values = [], validations = []) {
    this.name = name;
    this.values = values.map((row) => [...row]);
    this.validations = validations;
    this.getDataRangeCalls = 0;
  }

  getName() {
    return this.name;
  }

  cell(row, col) {
    const r = this.values[row - 1];
    return r ? r[col - 1] ?? '' : '';
  }

  setCell(row, col, value) {
    while (this.values.length < row) this.values.push([]);
    const r = this.values[row - 1];
    while (r.length < col) r.push('');
    r[col - 1] = value;
  }

  validation(row, col) {
    const r = this.validations[row - 1];
    return r ? r[col - 1] ?? null : null;
  }

  getDataRange() {
    this.getDataRangeCalls += 1;
    const numRows = Math.max(this.values.length, 1);
    const numCols = Math.max(...this.values.map((row) => row.length), 1);
    return new FakeRange(this, 1, 1, numRows, numCols);
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new FakeRange(this, row, col, numRows, numCols);
  }

  getLastColumn() {
    return Math.max(0, ...this.values.map((row) => row.length));
  }

  appendRow(values) {
    this.values.push([...values]);
  }
}

export class FakeSpreadsheet {
  constructor(id, sheets = []) {
    this.id = id;
    this.sheets = new Map(sheets.map((s) => [s.name, s]));
    this.updated = new Date('2026-01-15T12:00:00Z');
  }

  getSheetByName(name) {
    return this.sheets.get(name) ?? null;
  }

  getSheets() {
    return [...this.sheets.values()];
  }

  insertSheet(name) {
    const sheet = new FakeSheet(name, []);
    this.sheets.set(name, sheet);
    return sheet;
  }

  getLastUpdated() {
    return this.updated;
  }
}

export function makeValidation(values) {
  return {
    getCriteriaType: () => 'VALUE_IN_LIST',
    getCriteriaValues: () => [values],
  };
}

/**
 * Build a fresh vm context with the server files loaded and GAS
 * globals faked. Options:
 *   properties: Script Properties key/value pairs
 *   spreadsheets: FakeSpreadsheet[] registered by id
 *   userEmail: email Session.getActiveUser() returns ('' = anonymous)
 *   lockAvailable: false makes tryLock() fail
 * Returns { context, fakes } where fakes exposes the mutable stores.
 */
export function createGasContext({
  properties = {},
  spreadsheets = [],
  userEmail = 'reviewer@example.test',
  lockAvailable = true,
} = {}) {
  const store = { ...properties };
  const logs = [];
  const lockState = { acquired: 0, released: 0 };

  const sandbox = {
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Error,
    RegExp,
    isNaN,
    parseInt,
    Logger: { log: (msg) => logs.push(String(msg)) },
    Session: {
      getActiveUser: () => ({ getEmail: () => userEmail }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => (key in store ? store[key] : null),
        setProperties: (obj) => Object.assign(store, obj),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => {
          if (!lockAvailable) return false;
          lockState.acquired += 1;
          return true;
        },
        releaseLock: () => {
          lockState.released += 1;
        },
      }),
    },
    SpreadsheetApp: {
      DataValidationCriteria: { VALUE_IN_LIST: 'VALUE_IN_LIST' },
      openById: (id) => {
        const found = spreadsheets.find((s) => s.id === id);
        if (!found) throw new Error(`Spreadsheet not found: ${id}`);
        return found;
      },
    },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  for (const file of ['config.js', 'util.js', 'checklist.js', 'offeror.js', 'sins.js', 'resources.js']) {
    const code = readFileSync(join(root, file), 'utf8');
    new vm.Script(code, { filename: file }).runInContext(context);
  }

  return {
    context,
    fakes: { properties: store, logs, lockState },
    // Values created inside the vm context carry that realm's
    // prototypes, which makes assert.deepStrictEqual fail on
    // cross-realm objects. JSON-round-tripping object results into
    // this realm keeps deep equality meaningful in tests.
    run: (expr) => {
      const result = vm.runInContext(expr, context);
      return result && typeof result === 'object'
        ? JSON.parse(JSON.stringify(result))
        : result;
    },
  };
}

export function extractScripts(htmlFile) {
  const html = readFileSync(join(root, htmlFile), 'utf8');
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
}

export function loadClientScripts(context, ...htmlFiles) {
  for (const file of htmlFiles) {
    for (const code of extractScripts(file)) {
      new vm.Script(code, { filename: file }).runInContext(context);
    }
  }
}

export { root };
