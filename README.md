# Freedom Estimating System

A shared estimating app using the existing HTML/JavaScript estimator, a Node.js/Express server, SQLite, and Yjs over WebSockets.

## Run locally

Use **Node.js 24 LTS or newer**:

```sh
npm ci --include=dev
npm start
```

Open `http://localhost:3000`. In development, enter a display name. Open a second browser session with another name, then open the same saved project to collaborate. The server binds to localhost by default.

This workspace also has an ignored portable Node runtime under `.tools` for local testing; it is not part of the deployment.

## aaPanel deployment

The site now needs a running Node process. Serving `index.html` as a static site does not provide shared storage or collaboration.

1. Install/select **Node.js 24 LTS** in aaPanel's Node project manager.
2. Keep the existing Git checkout. Run `npm ci --include=dev` and `npm run build` after each pull.
3. Create a persistent data directory **outside the checkout**, for example `/www/server/freedom-estimating-data`. Give the Node process user read/write access. Do not place it under an Nginx public document root.
4. Copy `.env.example` to `.env` (ignored by Git), or configure equivalent environment variables in aaPanel. Set `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, `DATA_DIR`, and `TRUST_PROXY=true` when behind the trusted local proxy.
5. Generate a password hash for each user with `npm run password -- "a unique password of at least 12 characters"`. Set `APP_USERS` to a JSON object mapping usernames to generated hashes. For example: `{"boran":"scrypt:<salt>:<hash>","estimator":"scrypt:<salt>:<hash>"}`. Use the actual generated values, not these placeholders. Avoid leaving real passwords in shell history.
6. Start command: **`npm start`**, working directory: the repository. Enable restart on failure and boot. Use **one Node process**; multiple workers would need a shared realtime message bus.
7. Replace the old static-site location with a reverse proxy to `http://127.0.0.1:3000`. Enable HTTPS and WebSocket forwarding. See [deploy/nginx.conf](deploy/nginx.conf) for the location settings. Production session cookies require HTTPS.
8. After each Git deployment: install dependencies, build, then restart the Node process. Existing SQLite records and sessions persist in `DATA_DIR`.

If your process manager starts `server.js` directly instead of `npm start`, load the configured environment and build first, or use `node --env-file-if-exists=.env server.js`.

If `/api/preferences` returns an HTML `Cannot GET` page after a pull, the frontend was rebuilt while the old Node process is still running. Restart the Node project in aaPanel. The client tolerates a missing preferences route so existing workbooks remain accessible during this version mismatch; account settings need the updated server. API errors identify the route and HTTP status instead of exposing a JSON parsing error.

The app intentionally refuses to start in production without valid `APP_USERS`. Every configured account is a member of the same estimating team and can open/edit all projects. Per-project roles and account-management screens are not included.

## Projects and files

The top-left **Projects** drawer opens the company → project → takeoff hierarchy. Company/project actions have large, always-visible buttons, and **Collapse all** folds the tree for your session without affecting collaborators. The separate **Workbooks…** tab at the bottom opens workbook switching, creation, renaming, and closing. Those controls stay hidden in Projects and Recently viewed. The server remembers the last selected workbook per account and reopens it after a reload or sign-in, including from another browser. Closing a workbook or signing out does not erase that choice; selecting another workbook replaces it.

Company and project branches start collapsed when a workbook opens. Your last project, takeoff, and tab are restored separately from that tree state. The browser saves location changes immediately for refreshes, while the server's viewing history restores the last location on other browsers. Remembered locations are scoped to the user and workbook.

**Recently viewed** lists projects in the current workbook, newest first, with customer, takeoff, tab, viewer, and timestamp. **Viewed by** defaults to your account and can select another user or Everyone. A visit is recorded when the user changes location, not when they move their cursor. One latest location is kept per user/project; opening it returns to that takeoff and tab. History begins when this version is deployed and survives server restarts. Deleted projects/takeoffs are omitted.

Collaborator names appear on the customer, project, and takeoff they are viewing, including collapsed parent rows. Within the same takeoff, numbered tabs and other views are highlighted with viewer names. Header badges provide the full customer → project → takeoff → tab path on hover. The Workbooks tab also shows each user's location inside their workbook. Presence updates live within the open workbook; the workbook browser refreshes every ten seconds.

Each imported JSON becomes a server workbook, preserving its existing company → project → takeoff hierarchy and template libraries. A legacy single-sheet JSON is also supported. Companies, projects, takeoffs, named lists, and custom filters remain available inside the same drawer. Renaming a server workbook changes its name in the workbook selector; internal project names remain editable in the hierarchy.

Workspace controls are grouped by purpose:

| Location | Controls |
| --- | --- |
| File | JSON import/export, estimate Excel export, printing, company and project directory exports |
| View | Theme, zoom, account cursor style, pictures, sheet details, summary details, and calculator folding, according to the active view |
| Estimate | Current option rounding, embedded load calculator, hidden column restoration, reset and delete |
| Projects → Project settings | Custom fields by company/project/takeoff, project statuses, and available filters |
| Item column header or calculator heading | Common add-item, add-section, add-option, and add-labor-group actions |
| Scope of Work header | Larger Detail opener and a copy of Collapse/Expand all detail, synchronized with View |

Project settings save automatically. Renaming a custom field retains existing detail values and its filter configuration. Theme and zoom are personal browser preferences that persist across workbook changes. The Scopes tab replaces the former gear icon for the option overview. Destructive estimate actions retain their two-click confirmation.

View → Cursor style offers system default, large dark/light arrows, and crosshair. This setting is stored per signed-in account in SQLite and loaded on sign-in across browsers; it does not change shared workbooks. Text fields and resize handles retain their functional cursors.

Scrolling reuses collaborator markers and batches their position updates once per animation frame. Medieval theme textures are pre-rendered PNGs with the same appearance as the original SVG filters. They are committed in `client/textures/` and bundled by `npm run build`; deployment does not require a browser. To regenerate them after editing the original texture definitions, run `node scripts/rasterize-textures.mjs` on a development machine with Microsoft Edge installed.

Storage layout:

```text
DATA_DIR/
  projects.sqlite          # project state, metadata, sessions, access history, user preferences
  projects.sqlite-wal      # SQLite-managed, present while running
  projects.sqlite-shm
  projects/
    <project-uuid>/
      project.json         # latest JSON snapshot
      metadata.json
      snapshots/
        <timestamp>.json   # most recent 50 snapshots
```

Edits are acknowledged only after SQLite writes succeed. JSON snapshots are generated within roughly two seconds of edits, and on clean shutdown/last-client disconnect. Existing inline images and attachments remain in the workbook JSON; they are not extracted into separate files in this version. Imports and saved collaborative state are limited to 25 MB.

For a full backup, stop the process and copy all of `DATA_DIR`, or use SQLite's supported online backup facilities. Do not copy only `projects.sqlite` while the database is running in WAL mode. The JSON snapshot history is a convenience, not a substitute for an independent backup. Never edit a snapshot to change an open project; import it as a new workbook instead.

## Collaboration behavior

- Fields update live; colored pointers and outlines identify another person's location and active field.
- Text uses Yjs collaborative text; concurrent scalar edits (such as the same numeric field) resolve to one deterministic value. Different fields merge independently.
- Rows use stable IDs. Reordering a row does not move somebody else's edit onto another row. Concurrent row additions are retained; deletion wins over a concurrent edit to the deleted row.
- Selected takeoff, sheet, view, theme, zoom, and several layout preferences are local to each browser session. They do not force other users to navigate.
- Existing detail/template editor forms apply edits when **Save** is pressed. Remote changes rebase onto untouched draft fields; locally edited fields remain in the draft. Live estimate cells broadcast as you type.
- A temporary connection loss keeps editing available in an already-open project. IndexedDB retains the collaborative state in that browser; reconnecting merges changes. Reopen the same project with the same account/browser to recover pending edits after reloading. First-time opening and project management require the server.
- “All changes saved” means the server acknowledged the edits. A storage or validation failure is shown visibly. Export JSON if you need an additional copy while a connection problem is unresolved.
- Pointer data is temporary and is never written to project snapshots.

## Checks

```sh
npm test
npm run build
npm run test:browser
```

Browser tests use installed Microsoft Edge by default. Set `BROWSER_CHANNEL=chrome` to use installed Chrome. The tests cover two independent sessions, live edits/presence, focus preservation, personal navigation, offline merging, and reopening. Node tests cover concurrent text and row edits, authentication boundaries, persistence, and restart recovery.

## Implementation notes

- `server.js`: authenticated project API, SQLite persistence, snapshot rotation, WebSocket rooms.
- `shared/model.js`: stable-ID workbook mapping to Yjs shared text and scalar fields.
- `client/app.js`: project browser, presence, reconnect, device recovery, and UI integration.
- `client/workspace.js` and `client/project-settings.js`: contextual menus, the combined project drawer, and project definitions.
- `index.html`: existing estimator and a small adapter separating shared data from personal navigation.
- `main.py` is the pre-existing empty placeholder; this implementation does not use Python.

References: [Yjs document updates](https://docs.yjs.dev/api/document-updates), [Node SQLite](https://nodejs.org/api/sqlite.html), [Express API](https://expressjs.com/en/5x/api/).
