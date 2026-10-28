# gsa-mas-checklist-webapp: GSA MAS Offer Checklist Tool

A Google Apps Script (GAS) web application for working through a GSA
Multiple Award Schedule (MAS) offer checklist. It presents parsed
checklist items from Google Sheets, lets reviewers add per-line
comments, shows offeror information and resources, and provides a
searchable Special Item Number (SIN) picker with glossary tooltips.

This is a modernized export (v1.0.0, 2026-10-28) of a web app first
built July 2025–February 2026. It was renamed from `ss-gapps` because
that name also belonged to an unrelated Python Apps Script auditor;
see [CHANGELOG.md](CHANGELOG.md) for exactly what changed. It is a
different project from the static, no-backend
`gsa-mas-offer-checklist` checklist site: this one is Sheets-backed,
with shared comments and per-user progress.

## What it does

- **Interactive checklist**: every sheet whose name starts with
  `Parsed` in the checklist spreadsheet becomes a tab; items are
  grouped by section, with a completion progress bar.
- **Comments**: reviewers add, edit, and delete comments on any
  checklist line. Comments are stored as a JSON array in a `User
  Comments` column on that row, with plain-text fallback for rows
  written before the JSON format. Appends are serialized with the
  script lock, so two reviewers commenting at once cannot lose each
  other's comments.
- **Progress that survives reload**: completion ticks are stored per
  user (by email) in a `Checklist Progress` sheet in the same
  spreadsheet, created lazily on the first tick.
- **Offeror info**: key/value rows from the `Offeror Info` sheet,
  rendered as text fields, dropdowns (from data validation), or
  commodity-type pills; the SINs Offered field opens the SIN picker.
- **SIN lookup & glossary**: searchable SIN list and glossary from a
  second spreadsheet.
- **Resources**: title/link/reasoning rows from the `Relevant
  Resources` sheet.

## Architecture

Google Apps Script, V8 runtime, flat file layout (required by clasp —
all `.js` files share one global namespace, so keep function names
unique across files).

| File | Role |
|---|---|
| `main.js` | `doGet` / `include` web-app entry points |
| `config.js` | Reads configuration from Script Properties |
| `util.js` | Current-user helpers, last-updated |
| `checklist.js` | Checklist read, comments, progress |
| `offeror.js` | Offeror Info sheet |
| `sins.js` | SIN list and glossary |
| `resources.js` | Relevant Resources sheet |
| `index.html` | Layout, Bootstrap shell, script includes |
| `*_client.html` | Client logic, via `google.script.run` |
| `theme.html`, `ui.html`, `tooltip_util.html` | Theme toggle, shared helpers (incl. HTML escaping), sticky tooltips |
| `appsscript.json` | Manifest: V8, explicit OAuth scopes, web app settings |

Client–server calls use `google.script.run`. Server function names
are part of the client contract — renaming one requires updating the
`*_client.html` file that calls it.

Data flow on load: `getAllParsedChecklists()` reads each `Parsed`
sheet once and merges that row's comments in the same read (the read
path never writes to a sheet), then `getProgress()` merges the
current user's ticks. Saving a comment or a tick re-reads inside the
script lock and writes one cell/row.

## Setup

You need a Google account, the two spreadsheets below, and
[clasp](https://github.com/google/clasp) (`npm install` in this
directory installs the pinned version locally; or
`npm install -g @google/clasp@3.4.1`).

1. **Create the Apps Script project** (or reuse the existing one):
   `clasp create --title "GSA MAS Offer Checklist Tool" --type webapp`,
   then copy `.clasp.json.example` to `.clasp.json` and put the new
   script ID in it. `.clasp.json` is gitignored and must never be
   committed.
2. **Set Script Properties** in the Apps Script editor
   (Project Settings → Script Properties). These are required:

   | Property | Value |
   |---|---|
   | `CHECKLIST_SHEET_ID` | ID of the spreadsheet with the `Parsed Checklist Items` sheet |
   | `SIN_SHEET_ID` | ID of the spreadsheet with the SIN list sheet |

   Optional properties override the default sheet names:
   `CHECKLIST_SHEET` (default `Parsed Checklist Items`),
   `OFFEROR_INFO_SHEET` (`Offeror Info`),
   `RELEVANT_RESOURCES_SHEET` (`Relevant Resources`),
   `SIN_SHEET` (default `Special Item Number (SIN) List ` — note the
   trailing space; the name must match the sheet exactly),
   `PROGRESS_SHEET` (`Checklist Progress`).
3. **Push and deploy**: `clasp push`, then in the editor
   Deploy → New deployment → Web app. The manifest ships as
   `executeAs: USER_DEPLOYING`, `access: MYSELF` — see
   [Access and identity](#access-and-identity) before widening that.
4. **Authorize** when prompted. The manifest declares exactly two
   scopes: `spreadsheets` (read/write — comments and progress write
   back to the sheets) and `userinfo.email` (to attribute comments
   and key progress to the signed-in user). Changing the scopes in
   `appsscript.json` requires redeploying and re-authorizing.

No other setup is needed. The `User Comments` column and the
`Checklist Progress` sheet are created automatically, on first write
only.

## Access and identity

- `executeAs: USER_DEPLOYING` means the script always runs with the
  deployer's permissions, whoever opens the web app. Anyone who can
  open the app can therefore read the configured spreadsheets and
  write comments/progress into them, as the deployer. Keep `access:
  MYSELF` unless you have a reason to widen it, and understand that
  widening access to a domain or to anyone widens that write access
  with it.
- `Session.getActiveUser()` returns the visitor's email only when the
  access setting allows identifying them; when it returns blank, the
  app shows `User` for comments and refuses to save progress.
- There is no per-sheet authorization beyond the checklist-sheet
  allowlist: comment and progress writes are restricted to sheets
  returned by `getParsedSheetNames()`. Anyone with the web-app URL can
  call those functions with any line number in those sheets — that is
  the intended behavior for a shared review tool, not a permission
  boundary.

## Development

```sh
npm run check   # syntax-check server .js + HTML <script> blocks
npm run test    # Node test suite (built-in runner, no dependencies)
```

Tests in `tests/` run the server code against in-memory fakes for
`SpreadsheetApp`, `Session`, `PropertiesService`, and `LockService`
(see `tests/gas-mocks.mjs`), and compile-check the client helpers
from `ui.html` / `checklist_client.html`. They do not touch Google
services. CI runs the same two commands on Node 20 and 22.

Rules that keep the app safe (also in
`.github/copilot-instructions.md`):

- Never interpolate sheet, comment, glossary, or user-derived data
  into `innerHTML` without `escapeHtml` / `escapeAttr`. Links go
  through `isSafeHttpUrl` (http/https only).
- Never hard-code a spreadsheet or script ID in the repository.
  Configuration lives in Script Properties.
- Writes that read-modify-write a cell must hold the script lock
  (`withScriptLock_` in `checklist.js`) and validate their inputs.
- The read path must not mutate a sheet. Column/sheet creation
  belongs on write paths only.
- Preserve the comment storage contract: JSON array in `User
  Comments`, plain-text fallback on read. Changing it needs a
  migration for existing rows.

## Verify after deploying

The build machine has no access to the deployer's spreadsheets, so
the live path was not verified for this export. After deploying with
your own spreadsheets, check:

1. The cover page loads, the checklist tabs render, and a reload
   keeps your completion ticks.
2. Adding a comment from two different users does not drop either
   comment, and editing/deleting a comment persists.
3. The SIN picker opens, filters, and applies selected SINs back
   into the Offeror Info field.
4. Opening the app as a second user (if you widen access) shows that
   user's own progress, not yours.

## License

MIT — see [LICENSE](LICENSE).
