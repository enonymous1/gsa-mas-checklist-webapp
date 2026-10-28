function getRelevantResources() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var sheet = ss.getSheetByName(config.RELEVANT_RESOURCES_SHEET);
    if (!sheet) return [];
    var data = sheet.getDataRange().getValues();
    if (!data.length) return [];
    var rows = data.slice(1);
    return rows
      .filter(function(row) { return row[0] && row[1]; })
      .map(function(row) {
        return {
          title: String(row[0]).trim(),
          url: String(row[1]).trim(),
          reasoning: row[2] ? String(row[2]).trim() : ''
        };
      });
  } catch (e) {
    Logger.log('Error in getRelevantResources: ' + e);
    throw e;
  }
}
