import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync } from 'node:crypto';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../server.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readBook, writeBook } from '../shared/model.js';

test('authenticated projects, real-time changes, access dates, snapshots, and restart durability', async () => {
  const dataDir = await mkdtemp(join(tmpdir(),'freedom-test-'));
  let app = createApp({ dataDir, users: {}, production: false });
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  let base = 'http://127.0.0.1:' + app.server.address().port;
  const sockets = [];
  async function login(name) {
    const res = await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:"1313"})});
    assert.equal(res.status,200); return res.headers.get('set-cookie').split(';')[0];
  }
  async function request(path, cookie, method='GET',body) {
    return fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body: body && JSON.stringify(body)});
  }
  function connect(id,cookie) {
    const ws = new WebSocket(base.replace('http','ws')+'/live/'+id,{headers:{cookie}});
    sockets.push(ws); const messages = [], waiters = [];
    ws.on('message',data => { const m = JSON.parse(data); const i = waiters.findIndex(w=>w.type===m.type); if(i>=0)waiters.splice(i,1)[0].resolve(m);else messages.push(m); });
    return { ws, next(type) { const i=messages.findIndex(m=>m.type===type); if(i>=0)return Promise.resolve(messages.splice(i,1)[0]); return new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Timed out: '+type)),5000); waiters.push({type,resolve:m=>{clearTimeout(timer);resolve(m);}}); }); } };
  }
  try {
    assert.equal((await fetch(base+'/api/projects')).status,401);
    assert.equal((await fetch(base+'/api/preferences')).status,401);
    assert.equal((await fetch(base+'/.env')).status,404);
    const alice=await login('Alice'), bob=await login('Bob');
    const missing=await request('/api/unknown-route',alice);
    assert.equal(missing.status,404);assert.match(missing.headers.get('content-type'),/application\/json/);
    assert.match((await missing.json()).error,/API route not found/);
    assert.deepEqual(await (await request('/api/preferences',alice)).json(), {cursor:'classic',lastWorkbook:null});
    for (const cursor of ['classic','crosshair','ring','arrow']) {
      const saved = await request('/api/preferences',alice,'PUT',{cursor});
      assert.equal(saved.status,200,`Save shared cursor: ${cursor}`);
      assert.deepEqual(await saved.json(),{cursor});
      assert.equal((await (await request('/api/preferences',alice)).json()).cursor,cursor);
    }
    assert.equal((await request('/api/preferences',alice,'PUT',{cursor:'invalid'})).status,400);
    assert.deepEqual(await (await request('/api/preferences',bob)).json(), {cursor:'classic',lastWorkbook:null});
    const rejected=await request('/api/projects',alice,'POST',{name:'bad',book:{random:true}}); assert.equal(rejected.status,400);
    const created=await request('/api/projects',alice,'POST',{name:'Job 1',book:{sheets:[{id:'s',rows:[{id:'r',name:'Saw',count:1,cost:10}]}]}});
    assert.equal(created.status,201); const project=await created.json();
    const opened=await request('/api/projects/'+project.id+'/open',bob,'POST');
    assert.equal((await opened.json()).modified_at,project.modified_at);
    const a=connect(project.id,alice),b=connect(project.id,bob);
    const ad=new Y.Doc(), bd=new Y.Doc();
    Y.applyUpdate(ad,Buffer.from((await a.next('sync')).state,'base64'));
    Y.applyUpdate(bd,Buffer.from((await b.next('sync')).state,'base64'));
    let av=readBook(ad), bv=readBook(bd), an=structuredClone(av), bn=structuredClone(bv);
    an.sheets[0].rows[0].count=8; bn.sheets[0].rows[0].cost=55;
    writeBook(ad,av,an); writeBook(bd,bv,bn);
    a.ws.send(JSON.stringify({type:'update',seq:1,update:Buffer.from(Y.encodeStateAsUpdate(ad)).toString('base64')}));
    b.ws.send(JSON.stringify({type:'update',seq:1,update:Buffer.from(Y.encodeStateAsUpdate(bd)).toString('base64')}));
    await a.next('ack'); await b.next('ack');
    Y.applyUpdate(ad,Buffer.from((await a.next('update')).update,'base64'));
    Y.applyUpdate(bd,Buffer.from((await b.next('update')).update,'base64'));
    assert.deepEqual(readBook(ad),readBook(bd));
    assert.equal(readBook(ad).sheets[0].rows[0].count,8); assert.equal(readBook(ad).sheets[0].rows[0].cost,55);
    const exported=await (await request('/api/projects/'+project.id+'/export',alice)).json();
    assert.equal(exported.sheets[0].rows[0].cost,55);
    for (const ws of sockets) ws.close();
    await app.close();
    const saved=JSON.parse(await readFile(join(dataDir,'projects',project.id,'project.json'),'utf8'));
    assert.equal(saved.sheets[0].rows[0].count,8);
    app=createApp({dataDir,users:{},production:false}); app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
    base='http://127.0.0.1:'+app.server.address().port;
    assert.deepEqual(await (await request('/api/preferences',alice)).json(), {cursor:'arrow',lastWorkbook:null});
    assert.deepEqual(await (await request('/api/preferences',bob)).json(), {cursor:'classic',lastWorkbook:project.id});
    const list=await (await request('/api/projects',alice)).json();
    assert.equal(list[0].name,'Job 1');
    const restored=await (await request('/api/projects/'+project.id+'/export',bob)).json(); assert.equal(restored.sheets[0].rows[0].cost,55);
  } finally { for(const ws of sockets)ws.terminate(); await app.close(); await rm(dataDir,{recursive:true,force:true}); }
});

test('recent project views are per user, resolve current names, and survive restart',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-visits-'));
  let app=createApp({dataDir,users:{},production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  let base='http://127.0.0.1:'+app.server.address().port;
  const sockets=[];
  const login=async name=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:"1313"})});return response.headers.get('set-cookie').split(';')[0];};
  const request=(path,cookie)=>fetch(base+path,{headers:{cookie}});
  try {
    const alice=await login('Alice'),bob=await login('Bob');
    const book={lists:[{id:'list',name:'Jobs',companies:[{id:'company',name:'Customer',projects:[{id:'job',name:'Concrete job',takeoffs:[{id:'takeoff',name:'Main takeoff',sheets:[{id:'sheet',num:2,rows:[]}]}]}]}]}]};
    const response=await fetch(base+'/api/projects',{method:'POST',headers:{cookie:alice,'Content-Type':'application/json'},body:JSON.stringify({name:'Visits workbook',book})});
    const project=await response.json(), path='/api/projects/'+project.id+'/recent';
    assert.equal((await fetch(base+path)).status,401);
    const connect=async cookie=>{const ws=new WebSocket(base.replace('http','ws')+'/live/'+project.id,{headers:{cookie}});sockets.push(ws);await once(ws,'open');return ws;};
    const a=await connect(alice),b=await connect(bob);
    const presence={list:'list',takeoff:'takeoff',sheet:'sheet',view:'sheet',companyName:'Spoof',project:'fake'};
    a.send(JSON.stringify({type:'presence',presence}));
    let history;
    for(let i=0;i<100;i++){history=await (await request(path+'?user=Alice',alice)).json();if(history.items.length)break;await delay(20);}
    assert.equal(history.items.length,1);assert.equal(history.items[0].companyName,'Customer');assert.equal(history.items[0].project,'job');assert.equal(history.items[0].tab,'Tab 2');
    const first=history.items[0].viewed_at;
    await delay(50);a.send(JSON.stringify({type:'presence',presence:{...presence,x:.3,visible:true}}));await delay(50);
    assert.equal((await (await request(path+'?user=Alice',alice)).json()).items[0].viewed_at,first);
    assert.equal((await (await request(path+'?user=Bob',alice)).json()).items.length,0);
    b.send(JSON.stringify({type:'presence',presence:{...presence,view:'summary'}}));
    for(let i=0;i<100;i++){history=await (await request(path,alice)).json();if(history.items.length===2)break;await delay(20);}
    assert.equal(history.items.length,2);assert.equal(history.items[0].name,'Bob');assert.equal(history.items[0].tab,'Summary');
    for(const ws of sockets)ws.terminate();await app.close();
    app=createApp({dataDir,users:{},production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;
    history=await (await request(path+'?user=Alice',bob)).json();assert.equal(history.items[0].viewed_at,first);
    assert.deepEqual(history.users,['Alice','Bob']);
  } finally {for(const ws of sockets)ws.terminate();await app.close();await rm(dataDir,{recursive:true,force:true});}
});

test('passwordless configuration is refused in every mode',()=>{
  for (const production of [false,true]) assert.throws(()=>createApp({production,users:{},sitePasswordHash:''}),/password is required/);
});

test('shipped password works without auth environment and ignores stale environment settings',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-default-auth-'));
  const previous={APP_USERS:process.env.APP_USERS,SITE_PASSWORD_HASH:process.env.SITE_PASSWORD_HASH};
  try {
    for (const stale of [false,true]) {
      if (stale) { process.env.APP_USERS='invalid old configuration';process.env.SITE_PASSWORD_HASH=''; }
      else { delete process.env.APP_USERS;delete process.env.SITE_PASSWORD_HASH; }
      const app=createApp({dataDir});
      app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
      const base='http://127.0.0.1:'+app.server.address().port;
      try {
        assert.equal((await fetch(base+'/api/session').then(r=>r.json())).passwordRequired,true);
        assert.equal((await fetch(base+'/server-auth.js')).status,404);
        assert.equal((await fetch(base+'/api/projects')).status,401);
        for (const password of ['', 'wrong', '1313']) {
          const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Tester',password})});
          assert.equal(response.status,password==='1313'?200:401);
        }
      } finally { await app.close(); }
    }
  } finally {
    for (const [key,value] of Object.entries(previous)) { if(value===undefined) delete process.env[key];else process.env[key]=value; }
    await rm(dataDir,{recursive:true,force:true});
  }
});

test('shared password gates the page, assets, reads, writes and old sessions',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-site-lock-'));
  const salt='0123456789abcdef0123456789abcdef';
  const password='shared-test-password';
  const hash='scrypt:'+salt+':'+scryptSync(password,salt,32).toString('hex');
  let app=createApp({dataDir,users:{},production:false});
  async function listen(){app.server.listen(0,'127.0.0.1');await once(app.server,'listening');return 'http://127.0.0.1:'+app.server.address().port;}
  let base=await listen();
  const login=async(name,password)=>fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password})});
  try {
    const old=(await login('Previous visitor','1313')).headers.get('set-cookie').split(';')[0];
    await app.close();
    app=createApp({dataDir,users:{},sitePasswordHash:hash,production:false});base=await listen();
    assert.equal((await fetch(base+'/api/session').then(r=>r.json())).passwordRequired,true);
    assert.equal((await fetch(base+'/api/projects',{headers:{cookie:old}})).status,401);
    const locked=await fetch(base+'/').then(r=>r.text());
    assert.match(locked,/server-login-password/);assert.doesNotMatch(locked,/sheetCard|window.estimator/);
    assert.equal((await fetch(base+'/assets/app.js')).status,401);
    assert.equal((await fetch(base+'/api/projects')).status,401);
    assert.equal((await fetch(base+'/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await fetch(base+'/.env')).status,404);
    for (const wrong of ['', 'wrong']) assert.equal((await login('Estimator',wrong)).status,401);
    assert.equal((await login('',password)).status,401);
    const signedIn=await login('Estimator',password);
    assert.equal(signedIn.status,200);
    const cookie=signedIn.headers.get('set-cookie').split(';')[0];
    assert.equal((await fetch(base+'/api/projects',{headers:{cookie}})).status,200);
    assert.match(await fetch(base+'/',{headers:{cookie}}).then(r=>r.text()),/sheetCard/);
    const protectedPage=await fetch(base+'/',{headers:{cookie}});
    await protectedPage.text();
    assert.equal(protectedPage.headers.get('cache-control'),'no-store');
    await fetch(base+'/api/logout',{method:'POST',headers:{cookie}});
    assert.equal((await fetch(base+'/assets/app.js',{headers:{cookie}})).status,401);
    assert.doesNotMatch(await fetch(base+'/',{headers:{cookie}}).then(r=>r.text()),/sheetCard/);
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
});

test('password accounts reject bad credentials and cross-origin writes',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-auth-'));
  const salt='0123456789abcdef0123456789abcdef';
  const hash='scrypt:'+salt+':'+scryptSync('test-password-123',salt,32).toString('hex');
  const app=createApp({dataDir,users:{Alice:hash},sitePasswordHash:'',production:false});
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try {
    for (const password of ['wrong','test-password-123']) {
      const res=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Alice',password})});
      assert.equal(res.status,password==='wrong'?401:200);
      if(res.status===200) {
        const cookie=res.headers.get('set-cookie').split(';')[0];
        const blocked=await fetch(base+'/api/projects',{method:'POST',headers:{cookie,origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify({name:'Bad',book:{sheets:[]}})});
        assert.equal(blocked.status,403);
        const logout=await fetch(base+'/api/logout',{method:'POST',headers:{cookie}});assert.equal(logout.status,200);
        assert.equal((await fetch(base+'/api/projects',{headers:{cookie}})).status,401);
      }
    }
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
});
