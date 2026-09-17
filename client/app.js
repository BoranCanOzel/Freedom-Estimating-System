import * as Y from 'yjs';
import { readBook, writeBook, validateBook } from '../shared/model.js';
import './style.css';
import { setupWorkspace } from './workspace.js';
import { setupProjectPresence } from './project-presence.js';
import { resolveLocation } from '../shared/navigation.js';

const $ = id => document.getElementById(id);
const clone = value => structuredClone(value);
const encode = data => { let s = ''; for (let i = 0; i < data.length; i += 8192) s += String.fromCharCode(...data.subarray(i, i + 8192)); return btoa(s); };
const decode = data => Uint8Array.from(atob(data), c => c.charCodeAt(0));
let user, current, connection, projects = [], filter = '', busy = false, browsing = true;
let workspace, projectPresence, recentMode = false, recentRequest = 0, preferencesAvailable = true;
const bridge = window.estimator;
const cacheDB = new Promise((resolve, reject) => {
  const request = indexedDB.open('freedom-collaboration', 1);
  request.onupgradeneeded = () => request.result.createObjectStore('documents');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function cache(key, value) {
  const db = await cacheDB;
  return new Promise((resolve, reject) => {
    const tx = db.transaction('documents', value === undefined ? 'readonly' : 'readwrite');
    const store = tx.objectStore('documents'), request = value === undefined ? store.get(key) : store.put(value, key);
    tx.oncomplete = () => resolve(request.result); tx.onerror = () => reject(tx.error);
  });
}
async function api(path, options = {}) {
  const response = await fetch('/api' + path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const fail = text => Object.assign(new Error(text), {status:response.status,path});
  if (!(response.headers.get('content-type') || '').includes('application/json')) {
    throw fail(`The server returned a web page instead of API data for /api${path} (HTTP ${response.status}). Restart the Node project in aaPanel after deployment; if it continues, check the Nginx proxy.`);
  }
  let data;
  try { data = await response.json(); }
  catch { throw fail(`The server returned invalid JSON for /api${path} (HTTP ${response.status}).`); }
  if (!response.ok) throw fail(data.error || 'Request failed.');
  return data;
}
function message(text, bad = false) { $('server-message').textContent = text; $('server-message').classList.toggle('error', bad); }
function status(text, bad = false) {
  $('server-status').textContent = text; $('server-status').classList.toggle('error', bad);
  $('status').textContent = text; $('status').classList.toggle('bad', bad);
}
function element(tag, text, className) { const el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function date(value) { return value ? new Date(value).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Never'; }
function selector(el) {
  if (!(el instanceof Element) || el.closest('#server-bar, #server-drawer, dialog')) return '';
  if (el.id) return '#' + CSS.escape(el.id);
  const row = el.closest('[data-id]');
  if (row) {
    const root = row.closest('[id]');
    const base = (root ? '#' + CSS.escape(root.id) + ' ' : '') + '[data-id="' + CSS.escape(row.dataset.id) + '"]';
    if (row === el) return base;
    const parts = [];
    while (el !== row) { const index = [...el.parentElement.children].filter(x => x.tagName === el.tagName).indexOf(el) + 1; parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + index + ')'); el = el.parentElement; }
    return base + ' > ' + parts.join(' > ');
  }
  const root = el.closest('[id]');
  if (!root) return '';
  const parts = [];
  while (el !== root) { const index = [...el.parentElement.children].filter(x => x.tagName === el.tagName).indexOf(el) + 1; parts.unshift(el.tagName.toLowerCase() + ':nth-of-type(' + index + ')'); el = el.parentElement; }
  return '#' + CSS.escape(root.id) + ' > ' + parts.join(' > ');
}
function focused() {
  const el = document.activeElement;
  return { selector: selector(el), start: el.selectionStart, end: el.selectionEnd, value: el.value,
    scrolls: [...document.querySelectorAll('.scroll,.proj-body,.lib-body')].map(e => [e, e.scrollTop, e.scrollLeft]) };
}
function renderRemote(data, fresh = false, location) {
  const focus = focused();
  bridge.receive(data, fresh, location);
  if (!fresh && focus.selector) {
    const el = document.querySelector(focus.selector);
    if (el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) {
      el.focus({ preventScroll: true });
      if (typeof focus.start === 'number' && el.setSelectionRange && el.type !== 'number') {
        const delta = (el.value || '').length - (focus.value || '').length;
        try { el.setSelectionRange(Math.max(0, focus.start + delta), Math.max(0, focus.end + delta)); } catch {}
      }
    }
  }
  for (const [el, top, left] of focus.scrolls) if (el.isConnected) { el.scrollTop = top; el.scrollLeft = left; }
}

class LiveProject {
  constructor(project) {
    this.project = project; this.doc = new Y.Doc(); this.seq = 0; this.acked = 0;
    this.ready = false; this.closed = false; this.peers = []; this.persisting = Promise.resolve();
    this.cacheKey = user + ':' + project.id; this.baseline = {}; this.retry = 0;
    this.locationKey = 'freedom:location:' + this.cacheKey;
    this.resumeLocation = project.lastLocation;
    try { this.resumeLocation = JSON.parse(localStorage.getItem(this.locationKey)) || this.resumeLocation; } catch {}
  }
  async start() {
    const previous = await cache(this.cacheKey);
    if (previous) Y.applyUpdate(this.doc, previous, 'cache');
    this.doc.on('update', (_update, origin) => {
      const state = Y.encodeStateAsUpdate(this.doc);
      this.persisting = this.persisting.catch(() => {}).then(() => cache(this.cacheKey, state));
      this.persisting.catch(() => { this.cacheFailed = true; status('Device backup failed — keep this tab open', true); });
      if (origin === 'local') {
        this.seq++;
        if (this.socket?.readyState === WebSocket.OPEN && this.synced) this.sendUpdate(_update);
        this.paintStatus();
      }
    });
    this.connect();
  }
  connect() {
    if (this.closed) return;
    this.synced = false;
    this.socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/live/${this.project.id}`);
    status(this.ready ? 'Reconnecting…' : 'Opening project…');
    this.socket.onmessage = event => {
      if (this.closed) return;
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'sync' || msg.type === 'update') {
          if (this.ready) this.changed();
          Y.applyUpdate(this.doc, decode(msg.state || msg.update), 'remote');
          this.applying = true;
          try { renderRemote(readBook(this.doc), !this.ready, this.resumeLocation); this.baseline = clone(bridge.getShared()); }
          finally { this.applying = false; }
          if (msg.type === 'sync') {
            this.peerId = msg.peerId; this.synced = true; this.ready = true; this.retry = 0;
            document.body.classList.add('server-active');
            workspace.sync(); syncProjectPanel();
            // The merged state includes edits recovered from this browser after a disconnect.
            this.seq++; this.sendUpdate(Y.encodeStateAsUpdate(this.doc));
          }
          this.sendPresence(); this.paintPeers();
        } else if (msg.type === 'ack') {
          this.acked = Math.max(this.acked, msg.seq); this.paintStatus();
        } else if (msg.type === 'presence') { this.peers = msg.peers; this.paintPeers(); projectPresence.update(this.peers,this.peerId); }
        else if (msg.type === 'error') { this.failed = true; status(msg.error, true); message('Your changes are still in this browser. Export JSON before closing if the error persists.', true); }
      } catch (e) { status('Could not apply a shared update. Export your work before reloading.', true); console.error(e); }
    };
    this.socket.onclose = event => {
      if (this.closed) return;
      this.synced = false; this.peers = []; this.paintPeers(); projectPresence.clear();
      if (event.code === 4001) { status('Session expired — export pending changes and sign in again', true); return; }
      this.paintStatus();
      this.retryTimer = setTimeout(() => this.connect(), Math.min(1000 * 2 ** this.retry++, 10000));
    };
    this.socket.onerror = () => {};
  }
  sendUpdate(update) { this.socket.send(JSON.stringify({ type: 'update', update: encode(update), seq: this.seq })); }
  changed() {
    if (!this.ready || this.closed || this.applying) return;
    const next = bridge.getShared();
    writeBook(this.doc, this.baseline, next);
    this.baseline = clone(next);
    this.sendPresence();
  }
  paintStatus() {
    if (this.failed || this.cacheFailed) return;
    status(!this.synced ? 'Offline · reconnecting · edits kept on this device' : this.acked < this.seq ? 'Saving…' : 'All changes saved');
  }
  sendPresence(pointer) {
    if (this.ready) {
      const location = JSON.stringify(bridge.getLocation());
      if (location !== this.savedLocation) {
        try { localStorage.setItem(this.locationKey,location); this.savedLocation = location; } catch {}
      }
    }
    if (pointer) this.pointer = pointer;
    if (!this.synced || this.socket.readyState !== WebSocket.OPEN) return;
    clearTimeout(this.presenceTimer);
    this.presenceTimer = setTimeout(() => {
      if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: 'presence', presence: {
        ...bridge.getLocation(), field: selector(document.activeElement), ...(this.pointer || {visible:false})
      } }));
    }, 50);
  }
  paintPeers() {
    if (this.closed || this.peerFrame) return;
    this.peerFrame = requestAnimationFrame(() => {
      this.peerFrame = 0;
      if (!this.closed) this.updatePeers();
    });
  }
  updatePeers() {
    const peers = this.peers.filter(peer => peer.id !== this.peerId);
    this.peerNodes ||= new Map();
    if (!peers.length && !this.peerNodes.size) return;
    const here = bridge.getLocation();
    const zoom = Number.parseFloat(getComputedStyle(document.body).zoom) || 1;
    // Read all geometry before touching the DOM; scrolling only moves retained nodes.
    const geometry = new Map();
    const measure = selector => {
      if (!selector) return null;
      if (!geometry.has(selector)) {
        let rect = null;
        try {
          const target = document.querySelector(selector);
          if (target) {
            const bounds = target.getBoundingClientRect();
            if (bounds.width && bounds.height && bounds.bottom > 0 && bounds.top < innerHeight && bounds.right > 0 && bounds.left < innerWidth) rect = bounds;
          }
        } catch {}
        geometry.set(selector, rect);
      }
      return geometry.get(selector);
    };
    const positions = peers.map(peer => {
      const same = peer.view === here.view && peer.takeoff === here.takeoff && (here.view !== 'sheet' || peer.sheet === here.sheet);
      return { peer, same, cursor: same && peer.visible ? measure(peer.anchor) : null, field: same ? measure(peer.field) : null };
    });
    const active = new Set(peers.map(peer => peer.id));
    for (const [id, nodes] of this.peerNodes) if (!active.has(id)) {
      nodes.badge.remove(); nodes.cursor.remove(); nodes.field.remove(); this.peerNodes.delete(id);
    }
    for (const {peer, same, cursor, field} of positions) {
      let nodes = this.peerNodes.get(peer.id);
      if (!nodes) {
        let hash = 0; for (const c of peer.name) hash = (hash * 31 + c.charCodeAt(0)) | 0;
        const color = `hsl(${Math.abs(hash) % 360} 65% 42%)`;
        nodes = {badge:element('span', peer.name, 'server-person'), cursor:element('div', '➤ ' + peer.name, 'server-cursor'), field:element('div', '', 'server-field')};
        nodes.badge.style.setProperty('--peer', color); nodes.cursor.style.color = color; nodes.field.style.borderColor = color;
        nodes.cursor.style.left = nodes.cursor.style.top = nodes.field.style.left = nodes.field.style.top = '0px';
        $('server-people').append(nodes.badge); $('server-cursors').append(nodes.cursor, nodes.field);
        this.peerNodes.set(peer.id, nodes);
      }
      const location = resolveLocation({lists:bridge.getProjectLists()},peer);
      const title = location ? `${location.companyName} → ${location.projectName} → ${location.takeoffName} → ${location.tab}` : 'Opening a project';
      const label = location ? `${peer.name} · ${location.projectName}` : peer.name;
      if (nodes.badge.textContent !== label) nodes.badge.textContent = label;
      if (nodes.badge.title !== title) nodes.badge.title = title;
      if (nodes.cursor.hidden !== !cursor) nodes.cursor.hidden = !cursor;
      if (nodes.field.hidden !== !field) nodes.field.hidden = !field;
      if (cursor) nodes.cursor.style.transform = `translate3d(${(cursor.left + peer.x * cursor.width) / zoom}px,${(cursor.top + peer.y * cursor.height) / zoom}px,0)`;
      if (field) {
        nodes.field.style.transform = `translate3d(${field.left / zoom}px,${field.top / zoom}px,0)`;
        nodes.field.style.width = field.width / zoom + 'px'; nodes.field.style.height = field.height / zoom + 'px';
      }
    }
  }
  async close() {
    this.changed();
    await this.persisting;
    this.closed = true; clearTimeout(this.retryTimer); clearTimeout(this.presenceTimer);
    cancelAnimationFrame(this.peerFrame);
    this.socket?.close(); this.doc.destroy();
    $('server-people').replaceChildren(); $('server-cursors').replaceChildren();
    projectPresence.clear();
  }
}

function syncProjectPanel() {
  const browse = browsing || !current;
  $('server-workbooks').hidden = !browse;
  $('server-hierarchy').hidden = browse || recentMode || !document.body.classList.contains('server-active');
  $('server-recent').hidden = browse || !recentMode;
  $('server-tab-projects').disabled = $('server-tab-recent').disabled = !current;
  $('server-tab-projects').setAttribute('aria-pressed',String(!browse && !recentMode));
  $('server-tab-recent').setAttribute('aria-pressed',String(!browse && recentMode));
  $('server-tab-workbooks').setAttribute('aria-pressed',String(browse));
  $('server-back').hidden = !current || !browse;
  $('server-open').textContent = current ? current.name + ' \u25be' : 'Browse saved workbooks';
  $('server-open').title = 'Switch saved workbook';
  $('server-workbook-actions').hidden = !current;
  workspace?.sync();
  requestAnimationFrame(() => bridge.relayout());
}
function panel(open = true) {
  $('server-drawer').hidden = !open;
  document.body.classList.toggle('workspace-projects-open', open);
  $('server-projects').setAttribute('aria-expanded', String(open));
  if (open) { syncProjectPanel(); bridge.refreshProjects(); if (user) { refresh().catch(e => message(e.message, true)); if (recentMode && !browsing) refreshRecent(); } }
  requestAnimationFrame(() => bridge.relayout());
}

async function refresh() { projects = await api('/projects'); renderProjects(); }
function renderProjects() {
  const host = $('server-list'); host.replaceChildren();
  const visible = projects.filter(p => p.name.toLowerCase().includes(filter));
  if (!visible.length) host.append(element('p', filter ? 'No matching projects.' : 'Create a workbook or import JSON from the File menu.', 'server-empty'));
  for (const project of visible) {
    const item = element('button', '', 'server-project' + (current?.id === project.id ? ' selected' : ''));
    item.type = 'button';
    item.append(element('strong', project.name));
    item.append(element('span', 'Opened ' + date(project.my_opened_at || project.accessed_at)));
    item.append(element('span', 'Edited ' + date(project.modified_at) + ' · ' + project.modified_by));
    for (const visitor of project.locations || []) item.append(element('span', '● ' + visitor.name +
      (visitor.projectName ? ' · ' + visitor.companyName + ' → ' + visitor.projectName + ' → ' + visitor.takeoffName + ' · ' + visitor.tab : ''), 'server-online'));
    item.onclick = () => run(() => openProject(project)); host.append(item);
  }
}
async function refreshRecent() {
  if (!current) return;
  const request = ++recentRequest, workbookId = current.id;
  const selected = $('server-recent-user').value || ($('server-recent-user').options.length ? '' : user);
  try {
    const result = await api('/projects/' + workbookId + '/recent?user=' + encodeURIComponent(selected));
    if (request !== recentRequest || current?.id !== workbookId) return;
    const select = $('server-recent-user');
    select.replaceChildren(new Option('Everyone',''), ...result.users.map(name=>new Option(name===user ? name+' (you)' : name,name)));
    select.value = selected;
    const host = $('server-recent-list'); host.replaceChildren();
    if (!result.items.length) host.append(element('p','No projects viewed by this user yet. New visits appear here automatically.','server-empty'));
    for (const item of result.items) {
      const button = element('button','','recent-project'); button.type = 'button';
      button.append(element('strong',item.projectName),element('span',item.companyName + ' · ' + item.listName),
        element('span',item.takeoffName + ' · ' + item.tab),element('span',item.name + ' · ' + date(item.viewed_at)));
      button.onclick = () => {
        if (!bridge.openLocation(item)) { message('This project is no longer available.',true); refreshRecent(); return; }
        browsing = recentMode = false; syncProjectPanel(); connection?.sendPresence();
      };
      host.append(button);
    }
  } catch(error) { if (request === recentRequest) message(error.message,true); }
}
async function closeProject() {
  await connection?.close(); connection = null; current = null;
  document.body.classList.remove('server-active');
  $('server-title').textContent = 'Freedom Estimating';
  $('server-close').disabled = $('server-edit').disabled = $('server-export').disabled = true;
  browsing = true; recentMode = false; bridge.closeEditor(); syncProjectPanel(); status('No project open'); panel();
}
async function openProject(project) {
  if (current?.id === project.id && connection?.ready) { browsing = recentMode = false; syncProjectPanel(); panel(false); return; }
  await connection?.close(); connection = null;
  document.body.classList.remove('server-active');
  current = await api('/projects/' + project.id + '/open', { method: 'POST' });
  $('server-title').textContent = current.name;
  $('server-close').disabled = $('server-edit').disabled = $('server-export').disabled = false;
  browsing = recentMode = false; syncProjectPanel();
  $('server-recent-user').replaceChildren();
  try { localStorage.setItem('freedom:last-workbook:' + user,current.id); } catch {}
  connection = new LiveProject(current); await connection.start(); panel(false);
}
async function createProject(name, book) {
  const project = await api('/projects', { method: 'POST', body: JSON.stringify({ name, book }) });
  await openProject(project); await refresh(); message('');
}
async function run(action) {
  if (busy) return;
  busy = true;
  try { await action(); } catch (e) { message(e.message, true); } finally { busy = false; }
}
function nameDialog(title, value, action) {
  $('server-name-title').textContent = title; $('server-name-input').value = value;
  $('server-name-dialog').showModal(); $('server-name-input').focus();
  $('server-name-form').onsubmit = event => {
    event.preventDefault(); const name = $('server-name-input').value.trim();
    if (name) { $('server-name-dialog').close(); run(() => action(name)); }
  };
}
function exportLocal() {
  const data = { _app: 'project-breakdown', _v: 3, ...bridge.exportBook() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = (current?.name || 'estimate').replace(/[<>:"/\\|?*]/g, '-') + '.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.body.insertAdjacentHTML('afterbegin', `
  <header id="server-bar">
    <button id="server-projects" type="button" aria-expanded="true" aria-controls="server-drawer">☰ Projects</button>
    <nav id="workspace-menus" aria-label="Workspace menus"></nav>
    <strong id="server-title">Freedom Estimating</strong><div id="server-people" aria-label="Collaborators"></div>
    <span id="server-status" role="status">Connecting…</span><button id="server-signout" type="button">Sign out</button>
  </header>
  <aside id="server-drawer" aria-label="Projects">
    <div class="server-drawer-head"><strong>Projects</strong><button id="server-hide" aria-label="Hide projects">&times;</button></div>
    <nav class="project-navigation" aria-label="Project views">
      <button id="server-tab-projects" type="button" aria-pressed="false">Projects</button>
      <button id="server-tab-recent" type="button" aria-pressed="false">Recently viewed</button>
    </nav>
    <section id="server-workbooks" aria-label="Workbooks">
    <div class="workbook-controls">
      <span class="workbook-label">Saved workbook</span>
      <div class="workbook-picker"><button id="server-open" type="button">Browse saved workbooks</button>
        <details id="server-workbook-actions" class="workspace-menu" hidden>
          <summary aria-label="Workbook actions">&ctdot;</summary>
          <div class="workspace-menu-content"><button id="server-edit" disabled>Rename workbook</button><button id="server-close" disabled>Close workbook</button></div>
        </details>
      </div>
      <div class="workbook-toolbar"><button id="server-new" type="button">+ New workbook</button><button id="server-back" type="button" hidden>Back to current</button></div>
    </div>
    <section id="server-browser" aria-label="Saved workbooks">
      <label class="server-search">Find a workbook<input id="server-search" type="search" placeholder="Search saved workbooks…"></label>
      <div id="server-list"></div>
    </section>
    </section>
    <div id="server-hierarchy" hidden></div>
    <section id="server-recent" aria-label="Recently viewed projects" hidden>
      <label class="recent-filter" for="server-recent-user">Viewed by<select id="server-recent-user"></select></label>
      <div id="server-recent-list" aria-live="polite"></div>
    </section>
    <footer class="project-navigation-footer"><button id="server-tab-workbooks" type="button" aria-pressed="true">Workbooks…</button></footer>
  </aside>
  <div id="server-welcome"><h1>Your projects, together.</h1><p>Create a workbook here, or use File &rarr; Import JSON to bring in existing work.</p><p>Browse companies, projects and takeoffs in one place. Open the same workbook on another browser to collaborate.</p></div>
  <div id="server-message" role="alert"></div><div id="server-cursors" aria-hidden="true"></div>
  <input id="server-import-file" type="file" accept=".json,application/json" multiple hidden>
  <dialog id="server-login"><form id="server-login-form"><h2>Freedom Estimating</h2><p id="server-login-hint">Sign in to your shared projects.</p>
    <label>Name<input id="server-login-name" autocomplete="username" required maxlength="80"></label>
    <label id="server-password-label">Password<input id="server-login-password" type="password" autocomplete="current-password"></label>
    <p id="server-login-error" role="alert"></p><button type="submit">Sign in</button></form></dialog>
  <dialog id="server-name-dialog"><form id="server-name-form"><h2 id="server-name-title"></h2>
    <label>Project name<input id="server-name-input" required maxlength="160"></label><div class="server-dialog-actions"><button type="button" id="server-name-cancel">Cancel</button><button type="submit">Save</button></div>
  </form></dialog>`);
document.body.classList.add('server-mode');
workspace = setupWorkspace();
projectPresence = setupProjectPresence(bridge);
$('workspace-cursor').onchange = async event => {
  const control = event.target, previous = document.body.dataset.cursor || 'system';
  control.disabled = true; workspace.setCursor(control.value);
  try { await api('/preferences', {method:'PUT',body:JSON.stringify({cursor:control.value})}); }
  catch (error) { workspace.setCursor(previous); message('Cursor setting was not saved: ' + error.message, true); }
  finally { control.disabled = false; }
};
syncProjectPanel();
$('server-projects').onclick = () => { if (current && ($('server-drawer').hidden || browsing)) { browsing = recentMode = false; panel(); } else panel($('server-drawer').hidden); };
$('server-hide').onclick = () => panel(false);
$('server-open').onclick = () => { browsing = true; panel(); $('server-search').focus(); };
$('server-back').onclick = () => { browsing = recentMode = false; syncProjectPanel(); bridge.refreshProjects(); };
$('server-tab-projects').onclick = () => { browsing = recentMode = false; panel(); };
$('server-tab-recent').onclick = () => { browsing = false; recentMode = true; panel(); };
$('server-tab-workbooks').onclick = () => { browsing = true; panel(); };
$('server-recent-user').onchange = () => refreshRecent();
$('server-search').oninput = event => { filter = event.target.value.toLowerCase(); renderProjects(); };
$('server-new').onclick = () => nameDialog('New workbook', '', name => createProject(name, bridge.blank(name)));
$('server-edit').onclick = () => nameDialog('Rename workbook', current.name, async name => {
  current = await api('/projects/' + current.id, { method: 'PATCH', body: JSON.stringify({ name }) });
  $('server-title').textContent = current.name; syncProjectPanel(); await refresh();
});
$('server-name-cancel').onclick = () => $('server-name-dialog').close();
$('server-close').onclick = () => { $('server-workbook-actions').open = false; run(closeProject); };
$('server-export').onclick = exportLocal;
$('server-import').onclick = () => $('server-import-file').click();
$('server-import-file').onchange = event => run(async () => {
  const files = [...event.target.files]; event.target.value = '';
  for (const file of files) {
    if (file.size > 25 * 1024 * 1024) throw new Error(file.name + ' exceeds the 25 MB limit.');
    const raw = validateBook(JSON.parse(await file.text()));
    await createProject(file.name.replace(/\.json$/i, ''), bridge.prepare(raw));
  }
});
// Existing file controls use the server project workflow as well.
for (const id of ['loadFile', 'loadFile2']) {
  $(id).textContent = 'Import project';
  $(id).addEventListener('click', event => { event.stopImmediatePropagation(); $('server-import-file').click(); }, true);
}
for (const id of ['saveFile', 'saveFile2']) {
  $(id).textContent = 'Export JSON';
  $(id).addEventListener('click', event => { event.stopImmediatePropagation(); exportLocal(); }, true);
}
$('server-signout').onclick = () => run(async () => { await closeProject(); await api('/logout', { method: 'POST' }); location.reload(); });
window.freedomSession = { changed: () => connection?.changed(), notify: text => message(text) };
window.addEventListener('beforeunload', event => { if (connection && connection.seq > connection.acked) { event.preventDefault(); event.returnValue = ''; } });
let lastPointer = 0;
document.addEventListener('pointermove', event => {
  if (!connection?.ready || Date.now() - lastPointer < 60) return;
  lastPointer = Date.now();
  const target = event.target.closest('[data-id], [id]');
  const anchor = selector(target);
  if (!anchor) return connection.sendPresence({ visible: false });
  const rect = target.getBoundingClientRect();
  connection.sendPresence({ visible: true, anchor, x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height });
});
document.addEventListener('pointerleave', () => connection?.sendPresence({ visible: false }));
document.addEventListener('focusin', () => connection?.sendPresence());
document.addEventListener('scroll', () => connection?.paintPeers(), {capture:true, passive:true});
window.addEventListener('resize', () => connection?.paintPeers());
document.addEventListener('visibilitychange', () => { if (document.hidden) connection?.sendPresence({ visible: false }); });
async function signedIn(name) {
  user = name; $('server-signout').textContent = name + ' · Sign out';
  let preferences = {cursor:'system',lastWorkbook:null};
  try { preferences = await api('/preferences'); }
  catch (error) {
    if (error.status !== 404) throw error;
    preferencesAvailable = false;
    message('Server update pending: restart the Node project in aaPanel to enable account settings. Your workbooks are still available.',true);
  }
  workspace.setCursor(preferences.cursor); $('workspace-cursor').disabled = !preferencesAvailable;
  await refresh(); syncProjectPanel();
  let remembered;
  try { remembered = localStorage.getItem('freedom:last-workbook:' + user); } catch {}
  const last = projects.find(p=>p.id===preferences.lastWorkbook) || projects.find(p=>p.id===remembered)
    || projects.find(p=>p.my_opened_at);
  if (last) { status('Opening project…'); await openProject(last); }
  else status('No project open');
  $('server-login').close();
}
async function boot() {
  await bridge.ready;
  const session = await api('/session');
  if (session.user) await signedIn(session.user);
  else {
    $('server-password-label').hidden = !session.passwordRequired;
    $('server-login-hint').textContent = session.passwordRequired ? 'Sign in to your shared projects.' : 'Enter your name for this local development session.';
    $('server-login').showModal();
    $('server-login').addEventListener('cancel', event => event.preventDefault());
    $('server-login-form').onsubmit = async event => {
      event.preventDefault();
      try {
        const result = await api('/login', { method: 'POST', body: JSON.stringify({ name: $('server-login-name').value, password: $('server-login-password').value }) });
        await signedIn(result.user);
      } catch (e) { $('server-login-error').textContent = e.message; }
    };
  }
  setInterval(() => { if (user && !$('server-drawer').hidden) { refresh().catch(() => {}); if (recentMode && !browsing) refreshRecent(); } }, 10000);
}
boot().catch(e => { status('Could not open the workspace', true); message(e.message, true); });
