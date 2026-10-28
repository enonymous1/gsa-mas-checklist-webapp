// Checklist data: read path is read-only (it never mutates a sheet).
// Writes go through saveCommentToSheet / appendCommentToSheet /
// setProgress, which validate their inputs, hold the script lock while
// they read-modify-write, and only then create a column/sheet.
//
// Comment storage contract (unchanged from the original):
// comments for one LINE Number are stored as a JSON array in the
// "User Comments" column of that row. loadCommentsFromSheet still
// falls back to treating a non-JSON cell as one plain-text comment,
// for rows written before the JSON format existed. Do not change
// that contract without a migration for existing rows.

var MAX_COMMENT_TEXT_LENGTH = 5000;
var MAX_COMMENTS_PER_LINE = 200;

function getParsedSheetNames() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var sheets = ss.getSheets().map(function(sheet) { return sheet.getName(); });
    var main = config.CHECKLIST_SHEET;
    var others = sheets.filter(function(n) { return n.startsWith('Parsed') && n !== main; }).sort();
    var mainPresent = sheets.indexOf(main) !== -1;
    return mainPresent ? [main].concat(others) : others;
  } catch (e) {
    Logger.log('Error in getParsedSheetNames: ' + e);
    throw e;
  }
}

// Read one sheet's values once and return { headers, rows }.
// Returns null when the sheet does not exist.
function readSheetValues_(ss, sheetName) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) return null;
  var data = sheet.getDataRange().getValues();
  if (!data.length) return { sheet: sheet, headers: [], rows: [] };
  return { sheet: sheet, headers: data[0], rows: data.slice(1) };
}

function rowsToItems_(headers, rows) {
  return rows.map(function(row) {
    var item = {};
    headers.forEach(function(h, i) { item[h] = row[i]; });
    return item;
  });
}

// Parse one "User Comments" cell. Returns an array (possibly empty).
// Non-JSON content is treated as a single plain-text comment, for
// backwards compatibility with rows written before the JSON format.
function parseCommentCell_(cellValue) {
  if (!cellValue) return [];
  if (typeof cellValue !== 'string') cellValue = String(cellValue);
  try {
    var parsed = JSON.parse(cellValue);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch (parseError) {
    Logger.log('Error parsing comment JSON: ' + parseError);
    return [{
      text: cellValue,
      timestamp: new Date().toLocaleString(),
      id: Date.now()
    }];
  }
}

function getAllParsedChecklists() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var sheetNames = getParsedSheetNames();
    var allData = {};

    sheetNames.forEach(function(name) {
      var result = readSheetValues_(ss, name);
      if (!result || !result.headers.length) return;

      var lineNumberCol = result.headers.indexOf('LINE Number');
      var userCommentsCol = result.headers.indexOf('User Comments');
      var checklist = rowsToItems_(result.headers, result.rows);
      if (lineNumberCol !== -1 && userCommentsCol !== -1) {
        checklist.forEach(function(item, i) {
          item.comments = parseCommentCell_(result.rows[i][userCommentsCol]);
        });
      }
      allData[name] = checklist;
    });
    return allData;
  } catch (e) {
    Logger.log('Error in getAllParsedChecklists: ' + e);
    throw e;
  }
}

function ensureUserCommentsColumn(sheet) {
  try {
    var lastColumn = sheet.getLastColumn();
    if (lastColumn === 0) {
      // Sheet is completely empty, cannot add User Comments column
      Logger.log('Sheet ' + sheet.getName() + ' is empty, skipping User Comments column');
      return -1;
    }

    var headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
    var userCommentsIndex = headers.indexOf('User Comments');

    if (userCommentsIndex === -1) {
      // User Comments column doesn't exist, add it
      var nextColumn = lastColumn + 1;
      sheet.getRange(1, nextColumn).setValue('User Comments');
      Logger.log("Added 'User Comments' column to sheet: " + sheet.getName());
      return nextColumn;
    }

    return userCommentsIndex + 1; // Return 1-based column index
  } catch (e) {
    Logger.log('Error in ensureUserCommentsColumn for sheet ' + sheet.getName() + ': ' + e);
    return -1; // Return -1 to indicate failure
  }
}

// The caller must be holding the script lock: this reads the sheet,
// finds the row, and returns { sheet, targetRow, userCommentsCol }.
// Throws a descriptive error for every expected failure.
function locateCommentCell_(ss, config, sheetName, lineNumber) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName);
  }

  // Ensure User Comments column exists (write path only)
  var userCommentsCol = ensureUserCommentsColumn(sheet);
  if (userCommentsCol === -1) {
    throw new Error('Cannot create User Comments column in sheet: ' + sheetName);
  }

  var data = sheet.getDataRange().getValues();
  if (!data.length) {
    throw new Error('Sheet has no data: ' + sheetName);
  }

  var headers = data[0];
  var lineNumberCol = headers.indexOf('LINE Number');
  if (lineNumberCol === -1) {
    throw new Error('LINE Number column not found in sheet: ' + sheetName);
  }

  var targetRow = -1;
  for (var i = 1; i < data.length; i++) {
    if (data[i][lineNumberCol] == lineNumber) { // loose compare: sheet values may be numbers or strings
      targetRow = i + 1; // +1 because sheet rows are 1-indexed
      break;
    }
  }
  if (targetRow === -1) {
    throw new Error('Line number ' + lineNumber + ' not found in sheet: ' + sheetName);
  }

  return { sheet: sheet, targetRow: targetRow, userCommentsCol: userCommentsCol, data: data };
}

function assertParsedSheetName_(sheetName) {
  if (typeof sheetName !== 'string' || !sheetName) {
    throw new Error('sheetName must be a non-empty string');
  }
  var allowed = getParsedSheetNames();
  if (allowed.indexOf(sheetName) === -1) {
    throw new Error('Sheet not found or not a checklist sheet: ' + sheetName);
  }
}

function assertLineNumber_(lineNumber) {
  if (lineNumber === undefined || lineNumber === null || lineNumber === '') {
    throw new Error('lineNumber is required');
  }
}

// Canonicalize one comment. Throws on a bad shape so a malformed
// payload can never be persisted. Unknown fields are dropped.
function validateComment_(comment) {
  if (!comment || typeof comment !== 'object') {
    throw new Error('Comment must be an object');
  }
  var text = comment.text;
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Comment text must be a non-empty string');
  }
  if (text.length > MAX_COMMENT_TEXT_LENGTH) {
    throw new Error('Comment text exceeds ' + MAX_COMMENT_TEXT_LENGTH + ' characters');
  }
  return {
    text: text,
    timestamp: typeof comment.timestamp === 'string' && comment.timestamp
      ? comment.timestamp
      : new Date().toLocaleString(),
    user: typeof comment.user === 'string' ? comment.user.slice(0, 200) : 'User',
    id: (typeof comment.id === 'number' || typeof comment.id === 'string') && comment.id !== ''
      ? comment.id
      : Date.now()
  };
}

function validateComments_(commentData) {
  if (!Array.isArray(commentData)) {
    throw new Error('Comments must be an array');
  }
  if (commentData.length > MAX_COMMENTS_PER_LINE) {
    throw new Error('Too many comments for one line (max ' + MAX_COMMENTS_PER_LINE + ')');
  }
  return commentData.map(validateComment_);
}

// Run fn while holding the script lock, so concurrent comment/progress
// writes serialize instead of overwriting each other. Throws if the
// lock cannot be acquired within 10 seconds.
function withScriptLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    throw new Error('Could not acquire the script lock; please try again.');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// Replace the full comment list for one line (used by comment edit and
// delete, which send the whole list). Returns the stored list.
function saveCommentToSheet(sheetName, lineNumber, commentData) {
  try {
    assertParsedSheetName_(sheetName);
    assertLineNumber_(lineNumber);
    var comments = validateComments_(commentData);
    var config = getConfig();
    return withScriptLock_(function() {
      var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
      var cell = locateCommentCell_(ss, config, sheetName, lineNumber);
      cell.sheet.getRange(cell.targetRow, cell.userCommentsCol).setValue(JSON.stringify(comments));
      Logger.log('Saved ' + comments.length + ' comment(s) for line ' + lineNumber + ' in sheet ' + sheetName);
      return comments;
    });
  } catch (e) {
    Logger.log('Error in saveCommentToSheet: ' + e);
    throw e;
  }
}

// Append one comment to a line's list, reading the current list inside
// the lock so two users commenting at once cannot lose each other.
// Returns the updated list.
function appendCommentToSheet(sheetName, lineNumber, comment) {
  try {
    assertParsedSheetName_(sheetName);
    assertLineNumber_(lineNumber);
    var newComment = validateComment_(comment);
    var config = getConfig();
    return withScriptLock_(function() {
      var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
      var cell = locateCommentCell_(ss, config, sheetName, lineNumber);
      var current = parseCommentCell_(cell.data[cell.targetRow - 1][cell.userCommentsCol - 1]);
      if (current.length >= MAX_COMMENTS_PER_LINE) {
        throw new Error('Too many comments for one line (max ' + MAX_COMMENTS_PER_LINE + ')');
      }
      current.push(newComment);
      cell.sheet.getRange(cell.targetRow, cell.userCommentsCol).setValue(JSON.stringify(current));
      Logger.log('Appended comment for line ' + lineNumber + ' in sheet ' + sheetName);
      return current;
    });
  } catch (e) {
    Logger.log('Error in appendCommentToSheet: ' + e);
    throw e;
  }
}

function loadCommentsFromSheet(sheetName) {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      return {};
    }

    var data = sheet.getDataRange().getValues();
    if (!data.length) return {};

    var headers = data[0];
    var lineNumberCol = headers.indexOf('LINE Number');
    var userCommentsCol = headers.indexOf('User Comments');

    if (lineNumberCol === -1 || userCommentsCol === -1) {
      // Either LINE Number or User Comments column doesn't exist
      Logger.log('Missing required columns in sheet ' + sheetName + ': LINE Number=' + lineNumberCol + ', User Comments=' + userCommentsCol);
      return {};
    }

    var comments = {};
    for (var i = 1; i < data.length; i++) {
      var lineNumber = data[i][lineNumberCol];
      var commentJson = data[i][userCommentsCol];

      if (lineNumber && commentJson) {
        comments[lineNumber] = parseCommentCell_(commentJson);
      }
    }

    return comments;
  } catch (e) {
    Logger.log('Error in loadCommentsFromSheet: ' + e);
    return {};
  }
}

// --- Completion progress -------------------------------------------------
// Progress is stored per user in a dedicated sheet in the same
// spreadsheet (columns: Sheet, LINE Number, User, Checked, Updated),
// keyed by the active user's email. It is created lazily, on the
// first write only — reading progress never creates the sheet.

function getProgress() {
  try {
    var config = getConfig();
    var user = getCurrentUser();
    if (!user.hasEmail) return {};
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var result = readSheetValues_(ss, config.PROGRESS_SHEET);
    if (!result || !result.headers.length) return {};
    var sheetCol = result.headers.indexOf('Sheet');
    var lineCol = result.headers.indexOf('LINE Number');
    var userCol = result.headers.indexOf('User');
    var checkedCol = result.headers.indexOf('Checked');
    if (sheetCol === -1 || lineCol === -1 || userCol === -1 || checkedCol === -1) return {};

    var progress = {};
    result.rows.forEach(function(row) {
      if (row[userCol] !== user.email || row[checkedCol] !== true) return;
      var sheetName = row[sheetCol];
      if (!progress[sheetName]) progress[sheetName] = {};
      progress[sheetName][row[lineCol]] = true;
    });
    return progress;
  } catch (e) {
    Logger.log('Error in getProgress: ' + e);
    throw e;
  }
}

function setProgress(sheetName, lineNumber, checked) {
  try {
    assertParsedSheetName_(sheetName);
    assertLineNumber_(lineNumber);
    if (typeof checked !== 'boolean') {
      throw new Error('checked must be a boolean');
    }
    var user = getCurrentUser();
    if (!user.hasEmail) {
      throw new Error('Cannot save progress: no signed-in user email is available.');
    }
    var config = getConfig();
    return withScriptLock_(function() {
      var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
      var sheet = ss.getSheetByName(config.PROGRESS_SHEET);
      if (!sheet) {
        sheet = ss.insertSheet(config.PROGRESS_SHEET);
        sheet.getRange(1, 1, 1, 5).setValues([['Sheet', 'LINE Number', 'User', 'Checked', 'Updated']]);
      }
      var data = sheet.getDataRange().getValues();
      var headers = data[0];
      var sheetCol = headers.indexOf('Sheet');
      var lineCol = headers.indexOf('LINE Number');
      var userCol = headers.indexOf('User');
      var checkedCol = headers.indexOf('Checked');
      var updatedCol = headers.indexOf('Updated');
      if (sheetCol === -1 || lineCol === -1 || userCol === -1 || checkedCol === -1 || updatedCol === -1) {
        throw new Error('Progress sheet has unexpected headers: ' + config.PROGRESS_SHEET);
      }
      var updated = new Date();
      for (var i = 1; i < data.length; i++) {
        if (data[i][sheetCol] === sheetName && data[i][lineCol] == lineNumber && data[i][userCol] === user.email) {
          sheet.getRange(i + 1, checkedCol + 1).setValue(checked);
          sheet.getRange(i + 1, updatedCol + 1).setValue(updated);
          return true;
        }
      }
      sheet.appendRow([sheetName, lineNumber, user.email, checked, updated]);
      return true;
    });
  } catch (e) {
    Logger.log('Error in setProgress: ' + e);
    throw e;
  }
}
