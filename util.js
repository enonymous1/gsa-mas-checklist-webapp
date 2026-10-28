function getLastUpdated() {
  var config = getConfig();
  var ss = SpreadsheetApp.openById(config.CHECKLIST_SHEET_ID);
  return ss.getLastUpdated().getTime();
}

function getCurrentUser() {
  try {
    var user = Session.getActiveUser();
    var email = user.getEmail();
    var name = email ? email.split('@')[0] : 'User'; // Extract name from email

    // Try to get a more friendly name if possible
    var displayName = name;
    if (email) {
      // Capitalize first letter and replace dots/underscores with spaces
      displayName = name.replace(/[._]/g, ' ')
                       .split(' ')
                       .map(function(word) { return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(); })
                       .join(' ');
    }

    return {
      email: email,
      name: name,
      displayName: displayName,
      hasEmail: !!email
    };
  } catch (e) {
    Logger.log('Error getting current user: ' + e);
    return {
      email: '',
      name: 'User',
      displayName: 'User',
      hasEmail: false
    };
  }
}
