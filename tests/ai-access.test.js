import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const takeoff=id=>({id,name:id,custom:{},sheets:[{id:'sheet-'+id,title:'Scope',fees:[],units:[],rows:[{id:'row-'+id,kind:'labor',name:'Cutting',cost:10,count:1,time:1,days:1}]}]});
test('AI grants enforce scope, one save, revisions, validation, live broadcast, audit, undo, expiry and revocation',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-ai-')),app=createApp({dataDir,production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  let ws,inspect;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'AI tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const book={lists:[{id:'list',companies:[{id:'co',name:'Private customer',projects:[{id:'pr',name:'Job',takeoffs:[takeoff('one'),takeoff('two')]}]}]}],libs:[]};
    const created=await (await call('/api/projects','POST',{name:'AI workbook',book})).json();
    const admin='/api/projects/'+created.id+'/ai-access',api='/api/ai/v1';
    const grant=async(id='one')=>{const response=await call(admin,'POST',{list:'list',takeoff:id});assert.equal(response.status,201);return response.json();};
    assert.equal((await fetch(base+admin,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await call(api+'/takeoff')).status,401);
    assert.equal((await call(admin,'POST',{list:'list',takeoff:'missing'})).status,404);
    const access=await grant(),key=access.key;
    assert.equal((await call('/api/projects','GET',undefined,key)).status,401);
    const instructions=await (await call(api+'/instructions','GET',undefined,key)).json();assert.ok(instructions.schema);assert.match(instructions.instructions,/ONE takeoff/);
    const spec=await (await call(api+'/openapi.json')).json();assert.ok(spec.paths['/save'].post.requestBody);
    const original=await (await call(api+'/takeoff','GET',undefined,key)).json();assert.equal(original.takeoff.id,'one');assert.ok(!JSON.stringify(original).includes('Private customer'));
    const change={revision:original.revision,takeoff:structuredClone(original.takeoff),requestId:'save-1'};change.takeoff.sheets[0].rows[0].cost=25;
    assert.equal((await call(api+'/validate','POST',{...change,takeoff:{...change.takeoff,id:'two'}},key)).status,422);
    assert.equal((await call(api+'/validate','POST',{...change,workbook:book},key)).status,422);
    assert.equal((await call(api+'/save','POST',{...change,revision:'stale'},key)).status,409);
    const invalid=structuredClone(change);invalid.takeoff.sheets[0].rows[0].cost='not money';assert.equal((await call(api+'/validate','POST',invalid,key)).status,422);
    assert.equal((await call(api+'/validate','POST',change,key)).status,200);
    ws=new WebSocket(base.replace('http','ws')+'/live/'+created.id,{headers:{cookie}});await once(ws,'message');
    const update=new Promise(resolve=>ws.on('message',bytes=>{const value=JSON.parse(bytes);if(value.type==='update')resolve(value);}));
    const saved=await call(api+'/save','POST',change,key);assert.equal(saved.status,200);const receipt=await saved.json();assert.ok(receipt.saved);await update;
    assert.equal((await call(api+'/takeoff','GET',undefined,key)).status,410);
    assert.deepEqual(await (await call(api+'/save','POST',change,key)).json(),receipt);
    assert.equal((await call(api+'/save','POST',{...change,requestId:'again'},key)).status,410);
    const exported=await (await call('/api/projects/'+created.id+'/export')).json();assert.deepEqual(exported.lists[0].companies[0].projects[0].takeoffs[1],book.lists[0].companies[0].projects[0].takeoffs[1]);
    const history=await (await call(admin+'?list=list&takeoff=one')).json();assert.equal(history.changes[0].id,receipt.changeId);assert.equal(history.changes[0].canUndo,true);assert.ok(!JSON.stringify(history).includes(key));
    const later=await grant(),read=await (await call(api+'/takeoff','GET',undefined,later.key)).json();read.takeoff.name='Edited again';
    const laterReceipt=await (await call(api+'/save','POST',{revision:read.revision,takeoff:read.takeoff,requestId:'later'},later.key)).json();
    assert.equal((await call(admin+'/changes/'+receipt.changeId+'/undo','POST')).status,409);
    assert.equal((await call(admin+'/changes/'+laterReceipt.changeId+'/undo','POST')).status,200);
    assert.equal((await call(admin+'/changes/'+receipt.changeId+'/undo','POST')).status,200);
    const fresh=await grant();assert.deepEqual((await (await call(api+'/takeoff','GET',undefined,fresh.key)).json()).takeoff,original.takeoff);
    const otherAccess=await grant('two');
    const otherRead=await (await call(api+'/takeoff','GET',undefined,otherAccess.key)).json();otherRead.takeoff.name='Other takeoff changed';
    assert.equal((await call(api+'/save','POST',{revision:otherRead.revision,takeoff:otherRead.takeoff,requestId:'other'},otherAccess.key)).status,200);
    // Changing another takeoff does not invalidate this takeoff's revision.
    assert.equal((await call(api+'/validate','POST',{revision:original.revision,takeoff:original.takeoff},fresh.key)).status,200);
    const rpc=async(method,params)=>{const response=await call(api+'/mcp','POST',{jsonrpc:'2.0',id:1,method,params},fresh.key);assert.equal(response.status,200);return response.json();};
    assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'})).result.protocolVersion,'2025-11-25');
    assert.equal((await rpc('tools/list')).result.tools.length,4);
    assert.equal(JSON.parse((await rpc('tools/call',{name:'read_takeoff',arguments:{}})).result.content[0].text).takeoff.id,'one');
    await call(admin+'/'+fresh.id,'DELETE');assert.equal((await call(api+'/takeoff','GET',undefined,fresh.key)).status,403);
    const expired=await grant();inspect=new DatabaseSync(join(dataDir,'projects.sqlite'));
    assert.equal(inspect.prepare('SELECT count(*) AS count FROM ai_grants WHERE key_hash=?').get(expired.key).count,0);
    inspect.prepare('UPDATE ai_grants SET expires_at=0 WHERE id=?').run(expired.id);
    assert.equal((await call(api+'/takeoff','GET',undefined,expired.key)).status,410);
  }finally{inspect?.close();ws?.terminate();await app.close();}
});

test('AI keys survive restart and concurrent saves consume a grant only once',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-ai-restart-'));
  let app,base;
  const start=async()=>{app=createApp({dataDir,production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;};
  await start();
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Restart tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const book={lists:[{id:'list',companies:[{id:'co',projects:[{id:'pr',takeoffs:[takeoff('one')]}]}]}]};
    const created=await (await fetch(base+'/api/projects',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({name:'Restart AI',book})})).json();
    const access=await (await fetch(base+'/api/projects/'+created.id+'/ai-access',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({list:'list',takeoff:'one'})})).json();
    await app.close();await start();
    const headers={Authorization:'Bearer '+access.key,'Content-Type':'application/json'};
    const read=await (await fetch(base+'/api/ai/v1/takeoff',{headers})).json();assert.equal(read.takeoff.id,'one');
    read.takeoff.name='Saved once';
    const changes=[1,2].map(n=>({revision:read.revision,takeoff:read.takeoff,requestId:'concurrent-'+n}));
    const saves=await Promise.all(changes.map(body=>fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(body)})));
    assert.deepEqual(saves.map(response=>response.status).sort(),[200,410]);
    const winner=saves.findIndex(response=>response.status===200),receipt=await saves[winner].json();
    await app.close();await start();
    const retry=await fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(changes[winner])});assert.equal(retry.status,200);assert.deepEqual(await retry.json(),receipt);
    assert.equal((await fetch(base+'/api/ai/v1/takeoff',{headers})).status,410);
  }finally{await app.close();}
});
