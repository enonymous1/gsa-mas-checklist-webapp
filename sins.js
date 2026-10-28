function getSINList() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.SIN_SHEET_ID);
    var sheet = ss.getSheetByName(config.SIN_SHEET);
    if (!sheet) throw new Error('Sheet not found: ' + config.SIN_SHEET);
    var data = sheet.getDataRange().getValues();
    if (!data.length) return [];
    var headers = data[0];
    var rows = data.slice(1);

    return rows.map(function(row) {
      var sinObj = {};
      headers.forEach(function(h, i) {
        sinObj[h] = row[i];
      });
      return sinObj;
    });
  } catch (e) {
    Logger.log('Error in getSINList: ' + e);
    throw e;
  }
}

function getSINGlossary() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.SIN_SHEET_ID);
    var sheet = ss.getSheetByName('Glossary');
    if (!sheet) {
      // Glossary is optional help text; the SIN picker works without it.
      Logger.log('Glossary sheet not found; returning an empty glossary');
      return {};
    }

    var data = sheet.getDataRange().getValues();
    var glossary = {};

    // Skip header row, map terms to definitions
    for (var i = 1; i < data.length; i++) {
      var term = data[i][0]; // First column: 'Glossary of Terms'
      var definition = data[i][1]; // Second column: 'Definitions'
      if (term && definition) {
        glossary[term] = definition;
      }
    }

    return glossary;
  } catch (e) {
    Logger.log('Error in getSINGlossary: ' + e);
    throw e;
  }
}
