import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {WebSocket} from 'ws';
const takeoff=id=>({id,name:id,sheets:[{id:'s'+id,title:'Scope',rows:[{id:'r'+id,kind:'labor',name:'Crew',count:1,time:8,days:1,cost:50}]}]});
test('share links enforce view/edit, isolated scope, revisions, revocation, live broadcast and workbook deletion',async()=>{
 const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-share-')),production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;let ws;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Sharer',password:'1313'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
  const book={lists:[{id:'l',companies:[{id:'c',name:'Private client',projects:[{id:'p',takeoffs:[takeoff('one'),takeoff('two')]}]}]}]};
  const project=await(await call('/api/projects','POST',{name:'Workbook',book})).json(),admin='/api/projects/'+project.id+'/share-links';
  assert.equal((await fetch(base+admin)).status,401);
  assert.equal((await call(admin,'POST',{list:'l',takeoff:'one',permission:'owner'})).status,422);
  const make=async permission=>(await(await call(admin,'POST',{list:'l',takeoff:'one',permission})).json());
  const read=await make('read'),write=await make('write'),rk=read.path.split('#')[1],wk=write.path.split('#')[1];
  const guest=await(await call('/api/shared-takeoff','GET',undefined,rk)).json();assert.equal(guest.takeoff.id,'one');assert.ok(!JSON.stringify(guest).includes('Private client'));assert.ok(!JSON.stringify(guest).includes('stwo'));
  assert.equal((await call('/api/projects','GET',undefined,wk)).status,401);
  const body={revision:guest.revision,takeoff:structuredClone(guest.takeoff)};body.takeoff.name='Changed by link';
  assert.equal((await call('/api/shared-takeoff','PUT',body,rk)).status,403);
  assert.equal((await call('/api/shared-takeoff','PUT',{...body,takeoff:{...body.takeoff,id:'two'}},wk)).status,422);
  assert.equal((await call('/api/shared-takeoff','PUT',{...body,lists:[]},wk)).status,422);
  ws=new WebSocket(base.replace('http','ws')+'/live/'+project.id,{headers:{cookie}});await once(ws,'message');
  const update=new Promise(resolve=>ws.on('message',bytes=>{if(JSON.parse(bytes).type==='update')resolve();}));
  const saved=await(await call('/api/shared-takeoff','PUT',body,wk)).json();assert.equal(saved.saved,true);await update;
  assert.equal((await call('/api/shared-takeoff','PUT',body,wk)).status,409);
  assert.equal((await(await call('/api/shared-takeoff','GET',undefined,rk)).json()).takeoff.name,'Changed by link');
  saved.takeoff.name='Second save';assert.equal((await call('/api/shared-takeoff','PUT',{revision:saved.revision,takeoff:saved.takeoff},wk)).status,200);
  const exported=await(await call('/api/projects/'+project.id+'/export')).json();assert.deepEqual(exported.lists[0].companies[0].projects[0].takeoffs[1],book.lists[0].companies[0].projects[0].takeoffs[1]);
  const list=await(await call(admin+'?list=l&takeoff=one')).json();assert.equal(list.links.length,2);assert.ok(!JSON.stringify(list).includes(wk));
  await call(admin+'/'+write.id,'DELETE');assert.equal((await call('/api/shared-takeoff','GET',undefined,wk)).status,403);assert.equal((await call('/api/shared-takeoff','PUT',body,wk)).status,403);
  const page=await fetch(base+'/share');assert.equal(page.status,200);assert.match(await page.text(),/shared-view.js/);
  assert.equal((await call('/api/projects/'+project.id,'DELETE',{confirmation:'DELETE'})).status,200);assert.equal((await call('/api/shared-takeoff','GET',undefined,rk)).status,401);
 }finally{ws?.terminate();await app.close();}
});

test('shared presence is scoped, connects guests with estimators, and honors revocation',async()=>{
 const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-presence-')),production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');const base='http://127.0.0.1:'+app.server.address().port;const sockets=[];
 const wait=async fn=>{for(let i=0;i<200;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}assert.fail('Presence did not arrive');};
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Owner',password:'1313'})});const cookie=login.headers.get('set-cookie').split(';')[0];
  const call=(path,method='GET',body)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',cookie},body:body&&JSON.stringify(body)});
  const book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[takeoff('one'),takeoff('two')]}]}]}]};
  const project=await(await call('/api/projects','POST',{name:'Presence',book})).json();
  const admin='/api/projects/'+project.id+'/share-links';
  const grant=await(await call(admin,'POST',{list:'l',takeoff:'one',permission:'read'})).json();
  async function socket(path,options){const ws=new WebSocket(base.replace('http:','ws:')+path,options);sockets.push(ws);ws.messages=[];ws.on('message',m=>ws.messages.push(JSON.parse(m)));await once(ws,'open');return ws;}
  const owner=await socket('/live/'+project.id,{headers:{cookie}});await wait(()=>owner.messages.some(m=>m.type==='sync'));
  owner.send(JSON.stringify({type:'presence',presence:{list:'l',takeoff:'one',sheet:'sone',view:'sheet',anchor:'#title',x:.2,y:.4,visible:true}}));
  const guest=await socket('/share-live');guest.send(JSON.stringify({type:'auth',key:grant.path.split('#')[1]}));await wait(()=>guest.messages.some(m=>m.type==='presence'&&m.peers.some(p=>p.name==='Owner')));
  guest.send(JSON.stringify({type:'presence',presence:{list:'fake',takeoff:'two',sheet:'sone',view:'sheet',anchor:'#title',x:.5,y:.5,visible:true}}));
  await wait(()=>owner.messages.some(m=>m.type==='presence'&&m.peers.some(p=>p.name.startsWith('Guest')&&p.visible&&p.takeoff==='one')));
  assert(!guest.messages.some(m=>m.state||m.update||m.takeoff));
  await new Promise(r=>setTimeout(r,50));owner.send(JSON.stringify({type:'presence',presence:{list:'l',takeoff:'two',sheet:'stwo',view:'sheet'}}));
  await wait(()=>guest.messages.at(-1)?.type==='presence'&&!guest.messages.at(-1).peers.some(p=>p.name==='Owner'));
  const closed=once(guest,'close');await call(admin+'/'+grant.id,'DELETE');const [code]=await closed;assert.equal(code,4003);
  const bad=await socket('/share-live');const refused=once(bad,'close');bad.send(JSON.stringify({type:'auth',key:'0'.repeat(64)}));assert.equal((await refused)[0],4003);assert.equal(bad.messages.length,0);
 }finally{for(const ws of sockets)ws.terminate();await app.close();}
});
