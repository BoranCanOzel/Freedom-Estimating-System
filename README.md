# Freedom Estimating System

A shared estimating app using the existing HTML/JavaScript estimator, a Node.js/Express server, SQLite, and Yjs over WebSockets.

## Run locally

Use **Node.js 24 LTS or newer**:

```sh
npm ci --include=dev
npm start
```

Open `http://localhost:3000`. Enter your display name and the shared website password. Open a second browser session with another name, then open the same saved project to collaborate. The server binds to localhost by default.

This workspace also has an ignored portable Node runtime under `.tools` for local testing; it is not part of the deployment.

Website login always requires a password. Its scrypt hash is shipped in the server-only `server-auth.js` file, so authentication needs no `.env` settings. `APP_USERS` and `SITE_PASSWORD_HASH` environment variables are no longer used. To change the password, generate a hash with `npm run password -- "a new password of at least 12 characters"`, replace the value in `server-auth.js`, and restart Node. Changing authentication invalidates existing sessions. Signed-out visitors cannot access the estimator, its assets, data APIs, or WebSocket connections.

## aaPanel deployment

### Takeoff share links

Open a saved takeoff and choose **Share**. Select **View only** (default) or
**View and edit**, then **Create link** and **Copy link**. Anyone holding the link
can open that takeoff and its option pages, including prices and notes, without
signing in. Links remain active until revoked in the same dialog. Copy the link
when creating it; the server stores only its hash. Changing the site password
revokes existing links, and deleting the workbook removes its links.

Guests use the existing takeoff view. Edit links offer an explicit **Save changes**
button; stale revisions are rejected without discarding the local draft. Use
**Reload latest** to load current data. Guest saves update the saved workbook and
are broadcast to signed-in collaborators. Links never grant workbook, customer,
project, library, or WebSocket access. The shared-view shell and its limited
static assets are public; takeoff data requires the link key.

Run `npm run build` and restart Node after deploying this feature. The build now
includes both `app.js` and `shared-view.js`.

### AI takeoff access

Inside a takeoff, use **AI access → Generate access**. The connection package
contains a temporary Bearer key, REST endpoint, MCP endpoint, and OpenAPI schema
URL. Configure these in a tool-capable AI client; simply pasting the URL into a
chat does not create a connection. The hosted endpoint must be reachable over
HTTPS. This implementation provides Bearer authentication, not an OAuth flow;
clients that require OAuth need a separate integration. The MCP endpoint supports
the 2025-03-26, 2025-06-18, and 2025-11-25 Streamable HTTP versions.

Each key is bound to one takeoff and all of its option pages, expires after 30
minutes, and permits one successful save. Read/validate requests do not consume
it. Keys are stored hashed, displayed only when generated, and can be revoked
from the same panel. Changing the website password also revokes outstanding keys.

AI changes appear live in the estimate. The panel lists the changes and offers
**Undo AI change** when the takeoff has not changed since that save. Other
takeoffs can change independently. Undo never reactivates the key. AI access and
change history persist in the existing SQLite database; schema migration runs
automatically on server startup. Deploy all files, build, then restart Node.

See [the AI JSON editing guide](docs/ai-takeoff.md) for the request shapes, ID
rules, numeric inputs, sections, revision conflicts, and retry behavior.

### Server setup

The site now needs a running Node process. Serving `index.html` as a static site does not provide shared storage or collaboration.

1. Install/select **Node.js 24 LTS** in aaPanel's Node project manager.
2. Keep the existing Git checkout. Run `npm ci --include=dev` and `npm run build` after each pull.
3. Create a persistent data directory **outside the checkout**, for example `/www/server/freedom-estimating-data`. Give the Node process user read/write access. Do not place it under an Nginx public document root.
4. Copy `.env.example` to `.env` (ignored by Git), or configure equivalent environment variables in aaPanel. Set `NODE_ENV=production`, `HOST=127.0.0.1`, `PORT=3000`, `DATA_DIR`, and `TRUST_PROXY=true` when behind the trusted local proxy.
5. Website password protection is already configured in `server-auth.js`; no authentication environment setup is needed.
6. Start command: **`npm start`**, working directory: the repository. Enable restart on failure and boot. Use **one Node process**; multiple workers would need a shared realtime message bus.
7. Replace the old static-site location with a reverse proxy to `http://127.0.0.1:3000`. Enable HTTPS and WebSocket forwarding. See [deploy/nginx.conf](deploy/nginx.conf) for the location settings. Production session cookies require HTTPS.
8. After each Git deployment: install dependencies, build, then restart the Node process. Existing SQLite records and sessions persist in `DATA_DIR`.

If your process manager starts `server.js` directly instead of `npm start`, load the configured environment and build first, or use `node --env-file-if-exists=.env server.js`.

If `/api/preferences` returns an HTML `Cannot GET` page after a pull, the frontend was rebuilt while the old Node process is still running. Restart the Node project in aaPanel. The client tolerates a missing preferences route so existing workbooks remain accessible during this version mismatch; account settings need the updated server. API errors identify the route and HTTP status instead of exposing a JSON parsing error.

The app refuses to start with a passwordless configuration in any mode. Everyone who signs in with the shared password can open/edit all projects. Per-project roles and account-management screens are not included.

## Projects and files

The top-left **Projects** drawer opens the company → project → takeoff hierarchy. Company/project actions have large, always-visible buttons, and **Collapse all** folds the tree for your session without affecting collaborators. The separate **Workbooks…** tab at the bottom opens workbook switching, creation, renaming, and closing. Those controls stay hidden in Projects and Recently viewed. The server remembers the last selected workbook per account and reopens it after a reload or sign-in, including from another browser. Closing a workbook or signing out does not erase that choice; selecting another workbook replaces it.

Company and project branches start collapsed when a workbook opens. Your last project, takeoff, and tab are restored separately from that tree state. The browser saves location changes immediately for refreshes, while the server's viewing history restores the last location on other browsers. Remembered locations are scoped to the user and workbook.

**Recently viewed** lists projects in the current workbook, newest first, with customer, takeoff, tab, viewer, and timestamp. **Viewed by** defaults to your account and can select another user or Everyone. A visit is recorded when the user changes location, not when they move their cursor. One latest location is kept per user/project; opening it returns to that takeoff and tab. History begins when this version is deployed and survives server restarts. Deleted projects/takeoffs are omitted.

The current customer, project, and takeoff are highlighted without adding location rows. Your path uses amber; collaborators use their cursor colors, with a segmented marker when several people share a row. Hover a highlighted row for names and locations, including collapsed parents. Within the same takeoff, numbered tabs and other views are highlighted with viewer names. Header badges provide the full customer → project → takeoff → tab path on hover. The Workbooks tab also shows each user's location inside their workbook. Presence updates live within the open workbook; the workbook browser refreshes every ten seconds.

Each imported JSON becomes a server workbook, preserving its existing company → project → takeoff hierarchy and template libraries. A legacy single-sheet JSON is also supported. Companies, projects, takeoffs, named lists, and custom filters remain available inside the same drawer. Renaming a server workbook changes its name in the workbook selector; internal project names remain editable in the hierarchy.

Workspace controls are grouped by purpose:

Use **Ctrl+Z** to undo and **Ctrl+Y** or **Ctrl+Shift+Z** to redo (Command shortcuts also work on Mac). The top toolbar has Undo and Redo buttons. History covers saved workbook edits, including rows, sections, moves between options, library folders/templates, and project details. Open detail editors keep a separate history for unsaved changes; saving an editor becomes a workbook undo step. Search boxes and temporary naming fields retain their normal text undo. Each browser tracks only its own edits, including offline edits; history resets when you reload or close/switch the workbook. Navigation and appearance preferences are not workbook undo steps.

| Location | Controls |
| --- | --- |
| File | JSON import/export, estimate Excel export, printing, company and project directory exports |
| View | Theme, zoom, account cursor style, pictures, sheet details, summary details, and calculator folding, according to the active view |
| Estimate | Current option rounding, embedded load calculator, hidden column restoration, and reset |
| Option tabs | × deletes that option; empty options close immediately, while options with content open a confirmation dialog. The last remaining option is kept. |
| Projects → Project settings | Custom fields by company/project/takeoff, project statuses, and available filters |
| Item column header or calculator heading | Common add-item, add-section, add-option, and add-labor-group actions |
| Scope of Work header | Larger Detail opener and a copy of Collapse/Expand all detail, synchronized with View |

Project settings save automatically. Renaming a custom field retains existing detail values and its filter configuration. Theme and zoom are personal browser preferences that persist across workbook changes. The Scopes tab replaces the former gear icon for the option overview. Destructive actions that require confirmation use a modal dialog with Cancel and an action button; Escape cancels.

View → Shared cursor offers Classic (original), Pointer arrow, Crosshair, and Ring. It controls the cursor other collaborators see, leaving your local mouse pointer unchanged. This setting is stored per signed-in account in SQLite and loaded on sign-in across browsers; it does not change shared workbooks. After deploying this change, restart the Node project as well as building the client. An older running server rejects the new cursor options with “Choose a supported cursor style.”

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

## Nested takeoff sections

Use **+ Subsection** on a section header to add a child. Indentation and branch lines show the hierarchy; each section collapses independently and its subtotal includes all descendants. Moving or duplicating a section carries its entire subtree. Removing a section header keeps its contents at the parent level.

Drag library sections onto the lower half of a section header to place them inside it, or between rows to choose another position. Saving a section to the library preserves its nested sections, and dropping that template restores the tree. Nested templates can also be expanded and dragged individually from the library. While dragging, translucent rows show the actual placement, nesting, and totals before release, including after a section subtotal. Press Escape to cancel.

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
