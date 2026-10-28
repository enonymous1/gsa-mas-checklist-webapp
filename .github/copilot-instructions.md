# Copilot instructions for gsa-mas-checklist-webapp

This file gives focused, actionable guidance for AI coding agents working on this repository. Keep things concise: the goal is to make an agent immediately productive.

## Big picture
- This is a Google Apps Script webapp (V8 runtime) that serves a set of HTML client pages and server-side Apps Script functions. See `appsscript.json` and `main.js`.
- Client HTML files live next to their small JS helpers (e.g., `checklist_client.html`, `offeror_client.html`, `resources_client.html`). These files call server functions via `google.script.run`.
- Server-side logic is partitioned by feature: `checklist.js`, `offeror.js`, `sins.js`, `resources.js`. `util.js` provides user helpers; `config.js` reads configuration from Script Properties (there is no committed CONFIG object anymore).

## Primary workflows and commands
- Deploy: this project uses clasp to push to Google Apps Script. In this workspace there are VS Code tasks for `Push to Apps Script` (`clasp push`), `Run tests`, and `Syntax check`. Install clasp with `npm install` (pinned in package.json).
- Check: run `npm run check` (parses every server `.js` file and every `<script>` block in the HTML files) and `npm run test` (Node built-in test runner against in-memory GAS fakes in `tests/gas-mocks.mjs`). Both run in CI on Node 20/22. Run both before pushing.
- Debug: use `Logger.log()` in server code and open the script Editor (script.google.com) -> Executions / Logs to review; client-side errors appear in browser console. Do not add `console.log` spam; `console.error` for failures only.
- Permissions: `appsscript.json` declares explicit OAuth scopes (`spreadsheets`, `userinfo.email`) and is configured to `executeAs: USER_DEPLOYING` and `access: MYSELF`. Changing scopes requires redeploy + re-authorization. Be careful when testing with another user's identity — the app runs as the deployer.

## Important repository conventions and patterns
- Naming: spreadsheets with parsed data are prefixed with `Parsed`. The main checklist sheet is `Parsed Checklist Items`. New parsed sheets should follow this pattern.
- Config: spreadsheet IDs live in Script Properties (`CHECKLIST_SHEET_ID`, `SIN_SHEET_ID`; sheet-name overrides optional) and are read by `getConfig()` in `config.js`. NEVER hard-code a spreadsheet ID, script ID, or any identifier in the repository. `.clasp.json` is gitignored; `.clasp.json.example` shows its shape.
- Server → client communication: client code uses `google.script.run` to call server functions (e.g., `getAllParsedChecklists`, `appendCommentToSheet`, `saveCommentToSheet`, `getProgress`, `setProgress`). Keep server function names stable if referenced by clients.
- HTML includes: server `main.js` defines an `include(filename)` response used by Html templates via `<?!= include('template') ?>`. Use `include` for reusable template fragments (see `index.html` and included partials).
- Escaping: sheet, comment, glossary, and user-derived data must go through `escapeHtml` / `escapeAttr` (defined in `ui.html`) before reaching `innerHTML`, and links through `isSafeHttpUrl` (http/https only). SIN-picker actions use `data-*` attributes, never interpolated `onclick` strings. Tooltip content is built with text nodes, never HTML.
- Line endings are LF everywhere (`.gitattributes`).

## Data handling specifics to preserve
- Comments storage: comments for one LINE Number are a JSON array in the `User Comments` column. `saveCommentToSheet` replaces the whole list (edit/delete); `appendCommentToSheet` appends one comment inside the script lock (new comments). Both validate shape/length and return the stored list. `loadCommentsFromSheet` / the read path parse with a plain-text fallback for backwards compatibility — do not change that contract without a migration.
- `ensureUserCommentsColumn` auto-creates the `User Comments` column if missing — write paths only. The read path (`getAllParsedChecklists`) must never mutate a sheet; it reads each sheet once and merges comments from the same read.
- Progress: `getProgress` / `setProgress` store per-user ticks (keyed by email) in the `Checklist Progress` sheet, created lazily on first write. Reads never create it. Writes validate the sheet name against `getParsedSheetNames()` and hold the script lock.
- `getParsedSheetNames` is the allowlist for comment/progress writes. Never write to an arbitrary caller-supplied sheet name.

## How to add new endpoints or UI
1. Add a server-side function in a new or existing `.js` file (e.g., `function getFoo(){...}`). Use `getConfig()` for any spreadsheet access; validate inputs; hold the script lock for read-modify-write.
2. Use `google.script.run.withSuccessHandler(...).withFailureHandler(...).getFoo()` in the appropriate `*_client.html` file. Escape every server-provided value before rendering it.
3. Add/extend tests in `tests/` with the GAS fakes; run `npm run check` and `npm run test`.

## Example patterns from codebase
- Client fetch: `prefetchAllParsedChecklists()` in `checklist_client.html` calls `getAllParsedChecklists()` (comments already merged), then `loadChecklistProgress()` calls `getProgress()` and renders from the cache.
- Server build: `getOfferorInfo()` reads validations with `sheet.getDataRange().getDataValidations()` to render dropdowns on the client with acceptedValues.

## Integration points & testing notes
- Google Sheets are the primary backend — changing a sheet layout may require matching updates to header names in code (the server maps headers to object keys in several places).
- Ensure any new read/write column uses `ensureUserCommentsColumn` style safeguards or explicit creation to avoid runtime errors.
- Tests cannot reach Google services; cover new server logic with the fakes in `tests/gas-mocks.mjs` and verify the live path by deploying with real spreadsheets (see README.md, "Verify after deploying").

## Safety and edge-cases
- When adding a function that writes to a sheet, validate presence of expected headers and return useful errors with `throw new Error('...')` so client can show friendly messages. Validate the sheet name against the allowlist.
- Avoid referencing Spreadsheet IDs directly in client-side code — read server-side constants from `getConfig()`.
- When adding a function that writes to a sheet, hold the script lock (`withScriptLock_` in `checklist.js`) for the whole read-modify-write.

---
If anything here is unclear or you want more examples (calls, naming, tests), tell me which section to expand and I will update this file.
