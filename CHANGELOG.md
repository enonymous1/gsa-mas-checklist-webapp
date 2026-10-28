# Changelog

All notable changes to this project are documented here. Dates use the
date the export was prepared, not backdated to the original work.

## 1.0.0 — 2026-10-28

Modernized export of the original GSA MAS Offer Checklist Tool
(Google Apps Script web app, first built July 2025–February 2026 as
`ss-gapps`). Renamed to `gsa-mas-checklist-webapp` to distinguish it
from the unrelated Python Apps Script auditor (`gas-auditor`) that
shared the old name. No original history is carried over: this is a
single clean commit. Behavior is preserved except where noted below.

### Fixed

- Completion ticks are now persisted per user (new `setProgress` /
  `getProgress`, stored in a `Checklist Progress` sheet). Previously
  `checked` lived only in browser memory and was reset on every tab
  switch and reload.
- Comments no longer race: `appendCommentToSheet` appends inside the
  script lock, and all comment writes are validated and locked.
  `saveCommentToSheet` (replace, for edit/delete) now returns the
  stored list instead of `true`.
- Sheet and comment data is escaped before it reaches `innerHTML`
  (`escapeHtml` / `escapeAttr` in `ui.html`); resource links are
  restricted to http(s) URLs, and SIN-picker actions use `data-*`
  attributes instead of interpolated `onclick` strings.
- The read path no longer mutates sheets: `getAllParsedChecklists`
  reads each sheet once and merges comments from the same read. The
  `User Comments` column is only created on a write.
- `getSINGlossary` returns `{}` when the Glossary sheet is missing
  instead of throwing; `getSINList` / `getOfferorInfo` /
  `getRelevantResources` handle empty sheets without crashing.

### Changed

- Spreadsheet IDs moved out of `config.js` into Script Properties
  (`CHECKLIST_SHEET_ID`, `SIN_SHEET_ID`; see README). No spreadsheet
  or script identifier is committed anywhere in this repository.
- `appsscript.json` now declares its OAuth scopes explicitly
  (`spreadsheets`, `userinfo.email`). Re-authorization is required
  after redeploying.
- `.clasp.json` is no longer tracked; copy `.clasp.json.example` to
  `.clasp.json` and fill in your script ID.
- Line endings are LF everywhere (`.gitattributes`); the original
  history mixed CRLF and LF.
- Removed `console.log` spam from the tooltip and SIN client code.

### Added

- Node test suite (`node --test`) with in-memory fakes for the
  Apps Script services, covering config, comments, progress, and
  client escaping helpers.
- Syntax gate (`npm run check`) that also parses the `<script>` blocks
  inside the HTML files.
- GitHub Actions CI (Node 20 / 22), MIT LICENSE, and this changelog.
- Setup and deployment documentation in README.md, including the
  `USER_DEPLOYING` / `MYSELF` access notes and the re-authorization
  requirement.

### Not verified here

- No live deployment against real spreadsheets was run for this
  export (no Sheets access from the build machine). Deploy and click
  through with your own spreadsheets before relying on it; see
  README.md ("Verify after deploying").
