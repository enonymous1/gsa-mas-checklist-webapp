function doGet(e) {
  try {
    return HtmlService.createTemplateFromFile('index').evaluate();
  } catch (err) {
    Logger.log("Error in doGet: " + err);
    throw err;
  }
}
function include(filename) {
  try {
    return HtmlService.createHtmlOutputFromFile(filename).getContent();
  } catch (err) {
    Logger.log("Error in include for " + filename + ": " + err);
    throw err;
  }
}