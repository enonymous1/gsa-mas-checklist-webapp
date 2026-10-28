// Configuration for the GSA MAS Offer Checklist Tool.
//
// Spreadsheet IDs are NOT stored in this repository. They live in the
// script's Script Properties (Apps Script editor > Project Settings >
// Script Properties), so a clone contains no identifiers for the
// deployer's spreadsheets. See README.md ("Setup") for the keys.
//
// Required properties:
//   CHECKLIST_SHEET_ID  - spreadsheet holding the Parsed checklist sheets
//   SIN_SHEET_ID        - spreadsheet holding the SIN list and Glossary
// Optional properties (defaults are the historical sheet names):
//   CHECKLIST_SHEET, OFFEROR_INFO_SHEET, RELEVANT_RESOURCES_SHEET,
//   SIN_SHEET, PROGRESS_SHEET

function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var checklistSheetId = props.getProperty('CHECKLIST_SHEET_ID');
  var sinSheetId = props.getProperty('SIN_SHEET_ID');
  if (!checklistSheetId) {
    throw new Error(
      'Missing Script Property CHECKLIST_SHEET_ID. ' +
      'Set it in Project Settings > Script Properties (see README.md).'
    );
  }
  if (!sinSheetId) {
    throw new Error(
      'Missing Script Property SIN_SHEET_ID. ' +
      'Set it in Project Settings > Script Properties (see README.md).'
    );
  }
  return {
    CHECKLIST_SHEET_ID: checklistSheetId,
    SIN_SHEET_ID: sinSheetId,
    CHECKLIST_SHEET: props.getProperty('CHECKLIST_SHEET') || 'Parsed Checklist Items',
    OFFEROR_INFO_SHEET: props.getProperty('OFFEROR_INFO_SHEET') || 'Offeror Info',
    RELEVANT_RESOURCES_SHEET: props.getProperty('RELEVANT_RESOURCES_SHEET') || 'Relevant Resources',
    // NOTE: the historical SIN sheet name ends with a trailing space.
    // getSheetByName needs the exact name; if you rename the sheet,
    // set the SIN_SHEET property to the new exact name.
    SIN_SHEET: props.getProperty('SIN_SHEET') || 'Special Item Number (SIN) List ',
    PROGRESS_SHEET: props.getProperty('PROGRESS_SHEET') || 'Checklist Progress'
  };
}
