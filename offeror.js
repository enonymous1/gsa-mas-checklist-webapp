function getOfferorInfo() {
  try {
    var config = getConfig();
    var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
    var sheet = ss.getSheetByName(config.OFFEROR_INFO_SHEET);
    if (!sheet) throw new Error('Sheet not found: ' + config.OFFEROR_INFO_SHEET);
    var data = sheet.getDataRange().getValues();
    if (!data.length) return [];
    var validations = sheet.getDataRange().getDataValidations();
    var rows = data.slice(1);

    return rows
      .map(function(row, i) {
        var key = row[0] ? String(row[0]).trim() : '';
        var rawValue = (row[1] !== undefined && row[1] !== null) ? String(row[1]).trim() : '';
        var description = row[2] ? String(row[2]).trim() : '';
        var validationRow = validations[i + 1] || [];
        var cellValidation = validationRow[1];
        var acceptedValues = null, value = '';

        if (cellValidation && cellValidation.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
          acceptedValues = cellValidation.getCriteriaValues()[0];
          value = (rawValue && acceptedValues.indexOf(rawValue) !== -1) ? rawValue : '';
        } else if (rawValue && rawValue.split(',').length > 1) {
          acceptedValues = rawValue.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
          value = '';
        } else {
          value = rawValue;
        }
        return key ? { key: key, value: value, acceptedValues: acceptedValues, description: description } : null;
      })
      .filter(Boolean);
  } catch (e) {
    Logger.log('Error in getOfferorInfo: ' + e);
    throw e;
  }
}
