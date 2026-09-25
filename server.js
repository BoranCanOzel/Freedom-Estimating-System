import express from 'express';
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, renameSync, readdirSync, unlinkSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import * as Y from 'yjs';
import { writeBook, readBook, validateBook } from './shared/model.js';
import { resolveLocation } from './shared/navigation.js';
import { cursorStyles, normalizeCursor, cursorColors, normalizeCursorColor } from './shared/cursors.js';
import { createDuels } from './server-duels.js';
import { mountAiAccess } from './server-ai-access.js';
import { mountShareAccess } from './server-share-access.js';
import { sitePasswordHash as configuredPasswordHash } from './server-auth.js';

const root = dirname(fileURLToPath(import.meta.url));
const encode = doc => Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64');
const now = () => new Date().toISOString();
const validId = id => /^[a-f0-9-]{36}$/.test(id);

export function createApp(options = {}) {
  const production = options.production ?? process.env.NODE_ENV === 'production';
  const users = options.users ?? {};
  const sitePasswordHash = options.sitePasswordHash ?? configuredPasswordHash;
  if (!sitePasswordHash && !Object.keys(users).length) throw new Error('A password is required. Configure server-auth.js.');
  if (sitePasswordHash && !/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(sitePasswordHash)) throw new Error('Invalid SITE_PASSWORD_HASH.');
  for (const hash of Object.values(users)) if (!/^scrypt:[a-f0-9]{32}:[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid APP_USERS password hash. Use npm run password.');
  const dataDir = resolve(options.dataDir || process.env.DATA_DIR || join(root, 'data'));
  mkdirSync(join(dataDir, 'projects'), { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'projects.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
      modified_at TEXT NOT NULL, accessed_at TEXT NOT NULL, modified_by TEXT NOT NULL,
      state BLOB NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, name TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS access (project_id TEXT NOT NULL REFERENCES projects(id), name TEXT NOT NULL,
      opened_at TEXT NOT NULL, PRIMARY KEY(project_id,name));
    CREATE TABLE IF NOT EXISTS user_preferences (name TEXT PRIMARY KEY, cursor TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS project_visits (
      workbook_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name TEXT NOT NULL,
      project_id TEXT NOT NULL, list_id TEXT NOT NULL, takeoff_id TEXT NOT NULL, sheet_id TEXT NOT NULL,
      view TEXT NOT NULL, viewed_at TEXT NOT NULL, PRIMARY KEY(workbook_id,name,project_id));`);
  if (!db.prepare('PRAGMA table_info(user_preferences)').all().some(column => column.name === 'color')) db.exec("ALTER TABLE user_preferences ADD COLUMN color TEXT NOT NULL DEFAULT ''");
  db.exec('CREATE TABLE IF NOT EXISTS auth_configuration (id INTEGER PRIMARY KEY, fingerprint TEXT NOT NULL)');
  const fingerprint = createHash('sha256').update(JSON.stringify(['mandatory-password-v1',sitePasswordHash,users])).digest('hex');
  const authChanged = db.prepare('SELECT fingerprint FROM auth_configuration WHERE id=1').get()?.fingerprint !== fingerprint;
  if (authChanged) {
    db.exec('DELETE FROM sessions');
    db.prepare('INSERT OR REPLACE INTO auth_configuration VALUES (1,?)').run(fingerprint);
  }
  const rooms = new Map(), loginAttempts = new Map();
  const duels = createDuels();
  const app = express(), server = createServer(app);
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Referrer-Policy', 'same-origin');
    res.set('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    // Cookie credentials are only accepted from this origin, including WS below.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) return res.status(403).json({ error: 'Cross-origin request refused.' });
    next();
  });
  app.get('/favicon.svg', (req, res) => res.sendFile(join(root, 'favicon.svg')));
  app.use(express.json({ limit: '25mb' }));
  function sameOrigin(req) {
    if (!req.headers.origin) return true;
    try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
  }
  function session(req) {
    const token = /(?:^|;\s*)freedom_session=([a-f0-9]+)/.exec(req.headers.cookie || '')?.[1];
    const found = token && db.prepare('SELECT name, token FROM sessions WHERE token=? AND expires>?').get(token, Date.now());
    return found && (sitePasswordHash || !Object.keys(users).length || Object.hasOwn(users, found.name)) ? found : null;
  }
  const publicProject = row => {
    const { state, ...metadata } = row;
    const room = rooms.get(row.id), book = room ? readBook(room.doc) : null;
    return { ...metadata, online: [...(rooms.get(row.id)?.clients || [])].map(ws => ws.name),
      locations: [...(room?.clients || [])].map(ws => ({name:ws.name,...(book && resolveLocation(book,ws.presence || {}) || {})})) };
  };
  function project(id) {
    return validId(id) && db.prepare('SELECT * FROM projects WHERE id=?').get(id);
  }
  function snapshot(id) {
    const row = project(id);
    if (!row) return;
    const doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(row.state));
    const dir = join(dataDir, 'projects', id), snapshots = join(dir, 'snapshots');
    mkdirSync(snapshots, { recursive: true });
    const payload = JSON.stringify({ _app: 'project-breakdown', _v: 3, ...readBook(doc) }, null, 2);
    writeFileSync(join(dir, 'project.json.tmp'), payload);
    renameSync(join(dir, 'project.json.tmp'), join(dir, 'project.json'));
    writeFileSync(join(dir, 'metadata.json'), JSON.stringify(publicProject(row), null, 2));
    writeFileSync(join(snapshots, now().replace(/:/g, '-') + '.json'), payload);
    const versions = readdirSync(snapshots).filter(f => f.endsWith('.json')).sort();
    for (const filename of versions.slice(0, -50)) unlinkSync(join(snapshots, filename));
    doc.destroy();
  }
  function getRoom(id) {
    if (!rooms.has(id)) {
      const row = project(id);
      if (!row) return null;
      const doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(row.state));
      rooms.set(id, { doc, clients: new Set(), timer: null });
    }
    return rooms.get(id);
  }
  mountAiAccess({app,db,session,project,rooms,snapshot,authChanged});
  mountShareAccess({app,db,session,project,rooms,snapshot,authChanged});
  app.get('/api/session', (req, res) => res.json({ user: session(req)?.name || null, passwordRequired: true }));
  app.post('/api/login', (req, res) => {
    const ip = req.ip, recent = (loginAttempts.get(ip) || []).filter(t => Date.now() - t < 60000);
    if (recent.length >= 10) return res.status(429).json({ error: 'Too many attempts. Try again in a minute.' });
    recent.push(Date.now()); loginAttempts.set(ip, recent);
    const name = String(req.body.name || '').trim().slice(0, 80), password = String(req.body.password || '');
    let allowed = false;
    const credential = sitePasswordHash || (Object.hasOwn(users,name) ? users[name] : '');
    if (credential) {
      const [, salt, hash] = credential.split(':');
      allowed = name.length > 0 && timingSafeEqual(scryptSync(password.slice(0, 1024), salt, 32), Buffer.from(hash, 'hex'));
    }
    if (!allowed) return res.status(401).json({ error: 'Incorrect name or password.' });
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, name, Date.now() + 7 * 86400000);
    res.cookie('freedom_session', token, { httpOnly: true, sameSite: 'lax', secure: production, maxAge: 7 * 86400000 });
    res.json({ user: name });
  });
  app.use('/api', (req, res, next) => {
    req.user = session(req);
    if (!req.user) return res.status(401).json({ error: 'Please sign in.' });
    next();
  });
  app.post('/api/logout', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token=?').run(req.user.token);
    for (const room of rooms.values()) for (const ws of room.clients) if (ws.token === req.user.token) ws.close(4001, 'Signed out');
    res.clearCookie('freedom_session'); res.json({ ok: true });
  });
  app.get('/api/preferences', (req, res) => {
    const last = db.prepare(`SELECT a.project_id FROM access a JOIN projects p ON p.id=a.project_id
      WHERE a.name=? ORDER BY a.opened_at DESC, a.project_id LIMIT 1`).get(req.user.name);
    const preferences = db.prepare('SELECT cursor,color FROM user_preferences WHERE name=?').get(req.user.name);
    res.json({cursor:normalizeCursor(preferences?.cursor), color:normalizeCursorColor(preferences?.color),
      lastWorkbook:last?.project_id || null});
  });
  app.put('/api/preferences', (req, res) => {
    const previous = db.prepare('SELECT cursor,color FROM user_preferences WHERE name=?').get(req.user.name);
    const cursor = req.body?.cursor ?? normalizeCursor(previous?.cursor);
    const color = req.body?.color === undefined ? normalizeCursorColor(previous?.color) : req.body.color;
    if (!cursorStyles.includes(cursor)) return res.status(400).json({error:'Choose a supported cursor style.'});
    if (typeof color !== 'string' || !Object.hasOwn(cursorColors,color)) return res.status(400).json({error:'Choose a supported shared cursor color.'});
    db.prepare('INSERT INTO user_preferences(name,cursor,color) VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET cursor=excluded.cursor,color=excluded.color').run(req.user.name, cursor, color);
    res.json({cursor,color});
  });
  app.get('/api/projects', (req, res) => {
    const rows = db.prepare(`SELECT p.*, a.opened_at AS my_opened_at FROM projects p
      LEFT JOIN access a ON p.id=a.project_id AND a.name=? ORDER BY COALESCE(a.opened_at,p.modified_at) DESC`).all(req.user.name);
    res.json(rows.map(publicProject));
  });
  app.get('/api/projects/:id/recent', (req, res) => {
    const row = project(req.params.id);
    if (!row) return res.status(404).json({error:'Workbook not found.'});
    const visits = db.prepare('SELECT * FROM project_visits WHERE workbook_id=? ORDER BY viewed_at DESC').all(row.id);
    const doc = new Y.Doc(); Y.applyUpdate(doc, row.state);
    const book = readBook(doc); doc.destroy();
    const names = [...new Set([req.user.name,...Object.keys(users),...visits.map(v=>v.name)])].sort();
    const selected = typeof req.query.user === 'string' ? req.query.user : '';
    const items = [];
    for (const visit of visits) {
      if (selected && visit.name !== selected) continue;
      const location = resolveLocation(book,{list:visit.list_id,takeoff:visit.takeoff_id,sheet:visit.sheet_id,view:visit.view});
      if (location && location.project === visit.project_id) items.push({...location,name:visit.name,viewed_at:visit.viewed_at});
      if (items.length >= 100) break;
    }
    res.json({users:names,items});
  });
  app.post('/api/projects', (req, res) => {
    const name = String(req.body.name || '').trim().slice(0, 160);
    if (!name) return res.status(400).json({ error: 'Enter a project name.' });
    try { validateBook(req.body.book); } catch (e) { return res.status(400).json({ error: e.message }); }
    const id = randomUUID(), time = now(), doc = new Y.Doc();
    writeBook(doc, {}, req.body.book);
    db.prepare('INSERT INTO projects VALUES (?,?,?,?,?,?,?)').run(id, name, time, time, time, req.user.name, Buffer.from(Y.encodeStateAsUpdate(doc)));
    doc.destroy(); snapshot(id);
    res.status(201).json(publicProject(project(id)));
  });
  app.post('/api/projects/:id/open', (req, res) => {
    if (!project(req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    const time = now();
    db.prepare('UPDATE projects SET accessed_at=? WHERE id=?').run(time, req.params.id);
    db.prepare('INSERT INTO access VALUES (?,?,?) ON CONFLICT(project_id,name) DO UPDATE SET opened_at=excluded.opened_at').run(req.params.id, req.user.name, time);
    const row = project(req.params.id);
    const visits = db.prepare('SELECT * FROM project_visits WHERE workbook_id=? AND name=? ORDER BY viewed_at DESC').all(row.id,req.user.name);
    let lastLocation = null;
    if (visits.length) {
      const doc = new Y.Doc(); Y.applyUpdate(doc,row.state); const book = readBook(doc); doc.destroy();
      for (const visit of visits) {
        lastLocation = resolveLocation(book,{list:visit.list_id,takeoff:visit.takeoff_id,sheet:visit.sheet_id,view:visit.view});
        if (lastLocation) break;
      }
    }
    res.json({...publicProject(row),lastLocation});
  });
  app.patch('/api/projects/:id', (req, res) => {
    if (!project(req.params.id)) return res.status(404).json({ error: 'Project not found.' });
    const name = String(req.body.name || '').trim().slice(0, 160);
    if (!name) return res.status(400).json({ error: 'Enter a project name.' });
    db.prepare('UPDATE projects SET name=?,modified_at=?,modified_by=? WHERE id=?').run(name, now(), req.user.name, req.params.id);
    snapshot(req.params.id); res.json(publicProject(project(req.params.id)));
  });
  app.get('/api/projects/:id/export', (req, res) => {
    const row = project(req.params.id);
    if (!row) return res.status(404).json({ error: 'Project not found.' });
    const doc = new Y.Doc(); Y.applyUpdate(doc, new Uint8Array(row.state));
    res.attachment('project-' + row.id + '.json').json({ _app: 'project-breakdown', _v: 3, ...readBook(doc) });
    doc.destroy();
  });
  app.delete('/api/projects/:id', (req,res)=>{
    const row=project(req.params.id);
    if(!row)return res.status(404).json({error:'Workbook not found.'});
    if(req.body?.confirmation!=='DELETE')return res.status(400).json({error:'Type DELETE exactly to delete this workbook.'});
    db.exec('BEGIN');
    try{
      db.prepare('DELETE FROM ai_changes WHERE workbook=?').run(row.id);
      db.prepare('DELETE FROM ai_grants WHERE workbook=?').run(row.id);
      db.prepare('DELETE FROM access WHERE project_id=?').run(row.id);
      db.prepare('DELETE FROM projects WHERE id=?').run(row.id);
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    const room=rooms.get(row.id);
    if(room){room.deleted=true;clearTimeout(room.timer);room.timer=null;for(const ws of room.clients)ws.close(4004,'Workbook deleted');}
    res.json({deleted:true});
  });
  app.use('/api', (_req, res) => res.status(404).json({error:'API route not found. Restart the Node project after deployment.'}));
  app.get('/', (req, res) => {
    res.set('Cache-Control','no-store');
    res.sendFile(join(root, session(req) ? 'index.html' : 'signin.html'));
  });
  app.use('/assets', (req,res,next) => {
    res.set('Cache-Control','no-store');
    if (!session(req)) return res.status(401).send('Please sign in.');
    next();
  }, express.static(join(root, 'dist')));
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use((err, _req, res, _next) => {
    console.error(err.message);
    res.status(err.status || 500).json({ error: err.status === 413 ? 'File exceeds the 25 MB limit.' : 'The server could not complete this request.' });
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 35 * 1024 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const user = session(req), url = new URL(req.url, 'http://localhost');
    const id = url.pathname.startsWith('/live/') ? url.pathname.slice(6) : '';
    if (!user || !sameOrigin(req) || !project(id)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      ws.name = user.name; ws.token = user.token; ws.peerId = randomUUID(); ws.alive = true;
      const room = getRoom(id); room.clients.add(ws);
      const send = (client, value) => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
      const presence = () => { const peers = [...room.clients].map(c => ({ id: c.peerId, name: c.name, ...(c.presence || {}) })); for (const c of room.clients) send(c, { type: 'presence', peers }); };
      send(ws, { type: 'sync', state: encode(room.doc), peerId: ws.peerId }); presence();
      ws.on('pong', () => { ws.alive = true; });
      ws.on('error', () => {});
      ws.on('message', bytes => {
        if(room.deleted){ws.close(4004,'Workbook deleted');return;}
        if (!session(req)) { ws.close(4001, 'Session expired'); return; }
        try {
          const msg = JSON.parse(bytes.toString());
          if (msg.type === 'duel') { duels.handle(ws, msg, room.clients); return; }
          if (msg.type === 'presence') {
            if (Date.now() - (ws.lastPresence || 0) < 35) return;
            ws.lastPresence = Date.now();
            const p = msg.presence || {};
            const locationKey = JSON.stringify([p.list,p.takeoff,p.sheet,p.view]);
            if (locationKey !== ws.locationKey) {
              ws.locationKey = locationKey;
              ws.location = resolveLocation(readBook(room.doc), p);
              if (ws.location) {
                const l = ws.location;
                db.prepare(`INSERT INTO project_visits VALUES (?,?,?,?,?,?,?,?)
                  ON CONFLICT(workbook_id,name,project_id) DO UPDATE SET list_id=excluded.list_id,
                  takeoff_id=excluded.takeoff_id,sheet_id=excluded.sheet_id,view=excluded.view,viewed_at=excluded.viewed_at`)
                  .run(id,ws.name,l.project,l.list,l.takeoff,l.sheet,l.view,now());
              }
            }
            ws.presence = {
              ...(ws.location || {}),
              view: String(p.view || '').slice(0, 100), sheet: String(p.sheet || '').slice(0, 100),
              takeoff: String(p.takeoff || '').slice(0, 100), field: String(p.field || '').slice(0, 500),
              anchor: String(p.anchor || '').slice(0, 500),
              cursor: normalizeCursor(p.cursor),
              color: normalizeCursorColor(p.color),
              x: Math.max(0, Math.min(1, Number(p.x) || 0)), y: Math.max(0, Math.min(1, Number(p.y) || 0)),
              visible: p.visible === true
            }; presence(); return;
          }
          if (msg.type !== 'update' || typeof msg.update !== 'string' || msg.update.length > 34 * 1024 * 1024) return;
          // Validate on a candidate document before either publishing or persisting.
          const candidate = new Y.Doc();
          try {
            Y.applyUpdate(candidate, Y.encodeStateAsUpdate(room.doc));
            Y.applyUpdate(candidate, Buffer.from(msg.update, 'base64'));
            validateBook(readBook(candidate));
            const state = Buffer.from(Y.encodeStateAsUpdate(candidate));
            if (state.length > 25 * 1024 * 1024) throw new Error('Project exceeds the 25 MB limit.');
            if (!state.equals(Buffer.from(Y.encodeStateAsUpdate(room.doc)))) {
              db.prepare('UPDATE projects SET state=?,modified_at=?,modified_by=? WHERE id=?').run(state, now(), ws.name, id);
              Y.applyUpdate(room.doc, Buffer.from(msg.update, 'base64'));
              for (const client of room.clients) if (client !== ws) send(client, { type: 'update', update: msg.update });
              if (!room.timer) room.timer = setTimeout(() => { room.timer = null; try { snapshot(id); } catch (e) { console.error('Snapshot failed:', e.message); } }, 2000);
            }
            send(ws, { type: 'ack', seq: msg.seq });
          } finally { candidate.destroy(); }
        } catch (e) { send(ws, { type: 'error', error: 'Edit was not saved: ' + e.message }); }
      });
      ws.on('close', () => {
        duels.disconnect(ws);
        room.clients.delete(ws); presence();
        if (!room.clients.size) {
          if (room.timer) { clearTimeout(room.timer); try { snapshot(id); } catch (e) { console.error(e.message); } }
          room.doc.destroy(); rooms.delete(id);
        }
      });
    });
  });
  const heartbeat = setInterval(() => {
    for (const room of rooms.values()) for (const ws of room.clients) {
      if (!ws.alive) ws.terminate(); else { ws.alive = false; ws.ping(); }
    }
    db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    for (const [ip, times] of loginAttempts) if (times.at(-1) < Date.now() - 60000) loginAttempts.delete(ip);
  }, 30000);
  heartbeat.unref();
  async function close() {
    clearInterval(heartbeat);
    for (const [id, room] of rooms) { clearTimeout(room.timer); snapshot(id); for (const ws of room.clients) ws.terminate(); }
    await new Promise(done => wss.close(done));
    await new Promise(done => server.close(done));
    db.close();
  }
  return { app, server, close, dataDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const instance = createApp();
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  instance.server.listen(port, host, () => console.log(`Freedom Estimating: http://${host}:${port}\nStorage: ${instance.dataDir}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => instance.close().then(() => process.exit(0)));
}
