import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {readFileSync,existsSync} from 'node:fs';
import * as Y from 'yjs';
import {readBook,writeBook,validateBook} from './shared/model.js';
import {locateTakeoff,findTakeoff,revision,validateTakeoff} from './shared/ai-takeoff.js';

const hash=v=>createHash('sha256').update(v).digest('hex');
const fail=(status,message)=>{throw Object.assign(Error(message),{status});};
export function mountShareAccess({app,db,session,project,rooms,snapshot,authChanged}){
  db.exec(`CREATE TABLE IF NOT EXISTS takeoff_links (
    id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, workbook TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope TEXT NOT NULL, permission TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
    revoked INTEGER NOT NULL DEFAULT 0);`);
  if(authChanged)db.exec('UPDATE takeoff_links SET revoked=1');
  const route=fn=>(req,res)=>{try{fn(req,res);}catch(e){res.status(e.status||422).json({error:e.message});}};
  const signed=req=>{const user=session(req);if(!user)fail(401,'Please sign in.');return user;};
  function source(id){
    const row=project(id);if(!row)fail(404,'Workbook no longer exists.');
    const doc=new Y.Doc();Y.applyUpdate(doc,rooms.has(id)?Y.encodeStateAsUpdate(rooms.get(id).doc):row.state);
    return doc;
  }
  function access(req){
    const key=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'')?.[1];
    const link=key&&db.prepare('SELECT * FROM takeoff_links WHERE key_hash=?').get(hash(key));
    if(!link)fail(401,'This share link is invalid.');
    if(link.revoked)fail(403,'This share link has been revoked.');
    return link;
  }
  const admin='/api/projects/:id/share-links';
  app.post(admin,route((req,res)=>{
    const user=signed(req),permission=req.body?.permission;
    if(!['read','write'].includes(permission))fail(422,'Choose view only or view and edit.');
    const doc=source(req.params.id);
    try{
      const scope=locateTakeoff(readBook(doc),req.body.list,req.body.takeoff);if(!scope)fail(404,'Takeoff not found.');
      const key=randomBytes(32).toString('hex'),id=randomUUID();
      db.prepare('INSERT INTO takeoff_links(id,key_hash,workbook,scope,permission,created_by,created_at) VALUES(?,?,?,?,?,?,?)').run(id,hash(key),req.params.id,JSON.stringify(scope),permission,user.name,Date.now());
      res.status(201).json({id,permission,path:'/share#'+key});
    }finally{doc.destroy();}
  }));
  app.get(admin,route((req,res)=>{
    signed(req);const doc=source(req.params.id);
    try{
      const scope=locateTakeoff(readBook(doc),req.query.list,req.query.takeoff);if(!scope)fail(404,'Takeoff not found.');
      res.json({links:db.prepare('SELECT id,permission,created_by,created_at,revoked FROM takeoff_links WHERE workbook=? AND scope=? ORDER BY created_at DESC').all(req.params.id,JSON.stringify(scope))});
    }finally{doc.destroy();}
  }));
  app.delete(admin+'/:link',route((req,res)=>{
    signed(req);const result=db.prepare('UPDATE takeoff_links SET revoked=1 WHERE id=? AND workbook=?').run(req.params.link,req.params.id);
    if(!result.changes)fail(404,'Share link not found.');res.json({revoked:true});
  }));
  app.get('/api/shared-takeoff',route((req,res)=>{
    const link=access(req),doc=source(link.workbook);
    try{const takeoff=findTakeoff(readBook(doc),JSON.parse(link.scope));if(!takeoff)fail(404,'Shared takeoff no longer exists.');res.json({takeoff,revision:revision(takeoff),permission:link.permission});}
    finally{doc.destroy();}
  }));
  app.put('/api/shared-takeoff',route((req,res)=>{
    const link=access(req);if(link.permission!=='write')fail(403,'This link allows viewing only.');
    if(!req.body||Object.keys(req.body).some(k=>!['takeoff','revision'].includes(k)))fail(422,'Send only takeoff and revision.');
    const doc=source(link.workbook);
    try{
      const book=readBook(doc),scope=JSON.parse(link.scope),before=findTakeoff(book,scope);
      if(!before)fail(404,'Shared takeoff no longer exists.');
      if(req.body.revision!==revision(before))fail(409,'This takeoff changed since you loaded it. Reload the latest version before saving. Your draft has not been saved.');
      validateTakeoff(req.body.takeoff,before);
      const next=structuredClone(book),target=findTakeoff(next,scope);
      Object.keys(target).forEach(k=>delete target[k]);Object.assign(target,req.body.takeoff);validateBook(next);
      const vector=Y.encodeStateVector(doc);writeBook(doc,book,next,'share');
      const saved=findTakeoff(readBook(doc),scope);
      if(revision(saved)!==revision(target))fail(422,'This takeoff structure cannot be saved.');
      const state=Buffer.from(Y.encodeStateAsUpdate(doc));if(state.length>25*1024*1024)fail(413,'Workbook exceeds storage limit.');
      db.prepare('UPDATE projects SET state=?,modified_at=?,modified_by=? WHERE id=?').run(state,new Date().toISOString(),'Share link via '+link.created_by,link.workbook);
      const room=rooms.get(link.workbook),update=Y.encodeStateAsUpdate(doc,vector);
      if(room){Y.applyUpdate(room.doc,update,'share');for(const ws of room.clients)if(ws.readyState===1)ws.send(JSON.stringify({type:'update',update:Buffer.from(update).toString('base64')}));}
      try{snapshot(link.workbook);}catch{console.error('Shared takeoff saved; snapshot failed.');}
      res.json({saved:true,takeoff:saved,revision:revision(saved),permission:link.permission});
    }finally{doc.destroy();}
  }));
  const html=readFileSync(new URL('./index.html',import.meta.url),'utf8')
    .replace('/assets/app.js','/assets/shared-view.js')
    .replace('<div class="sheet">','<link rel="stylesheet" href="/assets/shared-view.css"><body class="shared-view shared-loading"><div class="sheet">')
    .replace('window.estimator.ready = load().then(showView);','window.estimator.ready = Promise.resolve();')
    .replaceAll('/assets/','/share-assets/');
  app.get('/share-assets/:file',(_req,res)=>{
    const name=_req.params.file;
    if(!['app.css','shared-view.css','shared-view.js'].includes(name)&&!/^tx-[a-z0-9-]+\.png$/i.test(name))return res.sendStatus(404);
    const file=new URL('./dist/'+name,import.meta.url);if(!existsSync(file))return res.status(404).send('Build the application first.');
    res.set('Cache-Control','no-store');
    res.type(name.endsWith('.css')?'css':name.endsWith('.js')?'js':'png').send(name.endsWith('.css')?readFileSync(file,'utf8').replaceAll('/assets/','/share-assets/'):readFileSync(file));
  });
  app.get('/share',(_req,res)=>{res.set({'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow'});res.type('html').send(html);});
}
