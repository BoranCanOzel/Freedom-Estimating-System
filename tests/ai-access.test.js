import * as Y from 'yjs';
import { readBook, writeBook } from '../shared/model.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { createApp } from '../server.js';

const takeoff=id=>({id,name:id,custom:{},sheets:[{id:'sheet-'+id,title:'Scope',fees:[],units:[],rows:[{id:'row-'+id,kind:'labor',name:'Cutting',cost:10,count:1,time:1,days:1}]}]});
test('AI grants enforce scope, repeated saves, revisions, validation, live broadcast, audit, undo and manual revocation',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-ai-')),app=createApp({dataDir,production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  let ws,inspect;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'AI tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const scopeData={source:'zz-project',fetchedAt:'2026-10-01T10:00:00Z',items:['included','excluded','ignored','duplicate'].map((status,i)=>({id:'scope-'+i,name:'Measured '+status,note:'Use night shift crew',group:'Concrete',measurements:'160 SF',status,missing:i===3}))};
    scopeData.items.push({id:'hidden-scope',name:'Hidden scope secret',note:'Hidden scope note',showAi:false,status:'included',measurements:'900 SF'});
    const shownScope={...scopeData,items:scopeData.items.filter(item=>!item.missing&&item.showAi!==false)};
    const scoped={...takeoff('one'),scopeLink:'https://www.zztakeoff.com/app/takeoff?projectId=zz-project',scopeData};
    const book={lists:[{id:'list',companies:[{id:'co',name:'Private customer',projects:[{id:'pr',name:'Job',takeoffs:[scoped,takeoff('two')]}]}]}],libs:[]};
    const created=await (await call('/api/projects','POST',{name:'AI workbook',book})).json();
    const admin='/api/projects/'+created.id+'/ai-access',api='/api/ai/v1';
    const grant=async(id='one')=>{const response=await call(admin,'POST',{list:'list',takeoff:id});assert.equal(response.status,201);return response.json();};
    assert.equal((await fetch(base+admin,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
    assert.equal((await call(api+'/takeoff')).status,401);
    assert.equal((await call(admin,'POST',{list:'list',takeoff:'missing'})).status,404);
    const access=await grant(),key=access.key;assert.equal(access.expiresAt,null);
    assert.equal((await fetch(base+'/api/ai-information')).status,401);
    assert.equal((await fetch(base+'/api/ai-information/estimates')).status,401);
    assert.equal((await call('/api/ai-information/estimates','GET',undefined,key)).status,401);
    const empty=await (await call('/api/ai-information')).json();
    const items=[{id:'rates',parent:'',kind:'folder',title:'Production rates',text:''},{id:'cut',parent:'rates',kind:'entry',title:'Concrete cutting',text:'Use 15 LF per crew hour.'}];
    const library=await call('/api/ai-information','PUT',{revision:empty.revision,items});assert.equal(library.status,200);
    const stored=await library.json();
    assert.equal((await call('/api/ai-information','PUT',{revision:empty.revision,items:[]})).status,409);
    assert.equal((await call('/api/ai-information','PUT',{revision:stored.revision,items:[{...items[0],parent:'rates'}]})).status,422);
    assert.equal((await call('/api/ai-information','PUT',{revision:stored.revision,items:[{...items[0],file:'upload.pdf'}]})).status,422);
    assert.equal((await call('/api/ai-information','PUT',{revision:stored.revision,items:[]},key)).status,401);
    assert.deepEqual((await (await call(api+'/information','GET',undefined,key)).json()).items,items);

    assert.equal((await call('/api/projects','GET',undefined,key)).status,401);
    const instructions=await (await call(api+'/instructions','GET',undefined,key)).json();assert.deepEqual(instructions.aiInformation.items,items);assert.ok(instructions.schema);assert.match(instructions.instructions,/ONE takeoff/);
    const spec=await (await call(api+'/openapi.json')).json();assert.ok(spec.paths['/save'].post.requestBody);
    const original=await (await call(api+'/takeoff','GET',undefined,key)).json();assert.equal(original.takeoff.id,'one');assert.ok(!JSON.stringify(original).includes('Private customer'));
    const scopeRead=await (await call(api+'/scope','GET',undefined,key)).json();
    assert.deepEqual(scopeRead.scopeData,shownScope);assert.equal(scopeRead.readOnly,true);assert.deepEqual(original.takeoff.scopeData,shownScope);
    assert.equal(instructions.scopeAvailable,true);assert.equal(instructions.schema.properties.scopeData.readOnly,true);
    assert.equal((await fetch(base+api+'/scope')).status,401);
    for(const field of ['scopeData','scopeLink']){
      const modified=structuredClone(original.takeoff);delete modified[field];
      assert.equal((await call(api+'/validate','POST',{revision:original.revision,takeoff:modified},key)).status,422);
    }
    const change={revision:original.revision,takeoff:structuredClone(original.takeoff),requestId:'save-1'};change.takeoff.sheets[0].rows[0].cost=25;
    assert.equal((await call(api+'/validate','POST',{...change,takeoff:{...change.takeoff,id:'two'}},key)).status,422);
    assert.equal((await call(api+'/validate','POST',{...change,workbook:book},key)).status,422);
    assert.equal((await call(api+'/save','POST',{...change,revision:'stale'},key)).status,409);
    const invalid=structuredClone(change);invalid.takeoff.sheets[0].rows[0].cost='not money';assert.equal((await call(api+'/validate','POST',invalid,key)).status,422);
    assert.equal((await call(api+'/validate','POST',change,key)).status,200);
    ws=new WebSocket(base.replace('http','ws')+'/live/'+created.id,{headers:{cookie}});await once(ws,'message');
    const update=new Promise(resolve=>ws.on('message',bytes=>{const value=JSON.parse(bytes);if(value.type==='update')resolve(value);}));
    const saved=await call(api+'/save','POST',change,key);assert.equal(saved.status,200);const receipt=await saved.json();assert.ok(receipt.saved);await update;
    assert.equal((await call(api+'/takeoff','GET',undefined,key)).status,200);
    assert.equal(receipt.accessConsumed,false);
    assert.equal((await call(api+'/instructions','GET',undefined,key)).status,200);
    assert.deepEqual(await (await call(api+'/save','POST',change,key)).json(),receipt);
    assert.equal((await call(api+'/save','POST',{...change,requestId:'again'},key)).status,409);
    const collision=structuredClone(change);collision.takeoff.name='Different payload';
    assert.equal((await call(api+'/save','POST',collision,key)).status,409);
    const exported=await (await call('/api/projects/'+created.id+'/export')).json();assert.deepEqual(exported.lists[0].companies[0].projects[0].takeoffs[0].scopeData,scopeData);assert.deepEqual(exported.lists[0].companies[0].projects[0].takeoffs[1],book.lists[0].companies[0].projects[0].takeoffs[1]);
    const history=await (await call(admin+'?list=list&takeoff=one')).json();assert.equal(history.changes[0].id,receipt.changeId);assert.equal(history.changes[0].canUndo,true);assert.ok(!JSON.stringify(history).includes(key));
    const later=access,read=await (await call(api+'/takeoff','GET',undefined,later.key)).json();read.takeoff.name='Edited again';
    const laterReceipt=await (await call(api+'/save','POST',{revision:read.revision,takeoff:read.takeoff,requestId:'later'},later.key)).json();
    assert.equal(laterReceipt.accessConsumed,false);
    assert.ok(laterReceipt.changeId);
    assert.notEqual(laterReceipt.changeId,receipt.changeId);
    assert.deepEqual(await (await call(api+'/save','POST',change,key)).json(),receipt);
    assert.equal((await call(admin+'/changes/'+receipt.changeId+'/undo','POST')).status,409);
    assert.equal((await call(admin+'/changes/'+laterReceipt.changeId+'/undo','POST')).status,200);
    assert.equal((await call(admin+'/changes/'+receipt.changeId+'/undo','POST')).status,200);
    const fresh=await grant();assert.deepEqual((await (await call(api+'/takeoff','GET',undefined,fresh.key)).json()).takeoff,original.takeoff);
    const otherAccess=await grant('two');
    assert.equal((await (await call(api+'/scope','GET',undefined,otherAccess.key)).json()).scopeData,null);
    const otherRead=await (await call(api+'/takeoff','GET',undefined,otherAccess.key)).json();otherRead.takeoff.name='Other takeoff changed';
    assert.equal((await call(api+'/save','POST',{revision:otherRead.revision,takeoff:otherRead.takeoff,requestId:'other'},otherAccess.key)).status,200);
    // Changing another takeoff does not invalidate this takeoff's revision.
    assert.equal((await call(api+'/validate','POST',{revision:original.revision,takeoff:original.takeoff},fresh.key)).status,200);
    const rpc=async(method,params)=>{const response=await call(api+'/mcp','POST',{jsonrpc:'2.0',id:1,method,params},fresh.key);assert.equal(response.status,200);return response.json();};
    assert.equal((await rpc('initialize',{protocolVersion:'2025-11-25'})).result.protocolVersion,'2025-11-25');
    assert.equal((await rpc('tools/list')).result.tools.length,8);
    assert.equal(JSON.parse((await rpc('tools/call',{name:'read_takeoff',arguments:{}})).result.content[0].text).takeoff.id,'one');
    assert.deepEqual(JSON.parse((await rpc('tools/call',{name:'read_scope',arguments:{}})).result.content[0].text).scopeData,shownScope);
    await call(admin+'/'+fresh.id,'DELETE');assert.equal((await call(api+'/scope','GET',undefined,fresh.key)).status,403);assert.equal((await call(api+'/takeoff','GET',undefined,fresh.key)).status,403);
    const permanent=await grant();inspect=new DatabaseSync(join(dataDir,'projects.sqlite'));
    assert.equal(inspect.prepare('SELECT count(*) AS count FROM ai_grants WHERE key_hash=?').get(permanent.key).count,0);
    inspect.prepare('UPDATE ai_grants SET expires_at=1 WHERE id=?').run(permanent.id);
    const forever=await (await call(api+'/takeoff','GET',undefined,permanent.key)).json();
    assert.equal(forever.takeoff.id,'one');assert.equal(forever.expiresAt,null);
    await call(admin+'/'+access.id,'DELETE');
    assert.equal((await call(api+'/save','POST',change,key)).status,403);
  }finally{inspect?.close();ws?.terminate();await app.close();}
});

test('permanent AI keys migrate legacy receipts, survive restarts and serialize concurrent revisions',async()=>{
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
    const initialLibrary=await (await fetch(base+'/api/ai-information',{headers:{cookie}})).json();
    const referenceItems=[{id:'standard',parent:'',kind:'entry',title:'Company standard',text:'Include mobilization separately.'}];
    assert.equal((await fetch(base+'/api/ai-information',{method:'PUT',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({revision:initialLibrary.revision,items:referenceItems})})).status,200);
    await app.close();await start();
    const headers={Authorization:'Bearer '+access.key,'Content-Type':'application/json'};
    const read=await (await fetch(base+'/api/ai/v1/takeoff',{headers})).json();assert.equal(read.takeoff.id,'one');
    assert.deepEqual(read.aiInformation.items,referenceItems);
    read.takeoff.name='Saved once';
    const changes=[1,2].map(n=>({revision:read.revision,takeoff:read.takeoff,requestId:'concurrent-'+n}));
    const saves=await Promise.all(changes.map(body=>fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(body)})));
    assert.deepEqual(saves.map(response=>response.status).sort(),[200,409]);
    const winner=saves.findIndex(response=>response.status===200),receipt=await saves[winner].json();
    const revoked=await (await fetch(base+'/api/projects/'+created.id+'/ai-access',{method:'POST',headers:{cookie,'Content-Type':'application/json'},body:JSON.stringify({list:'list',takeoff:'one'})})).json();
    await fetch(base+'/api/projects/'+created.id+'/ai-access/'+revoked.id,{method:'DELETE',headers:{cookie}});
    await app.close();
    // Simulate an old, consumed and expired grant with its receipt in the legacy columns.
    const inspect=new DatabaseSync(join(dataDir,'projects.sqlite'));
    try{
      inspect.prepare('DELETE FROM ai_save_requests WHERE grant_id=?').run(access.id);
      inspect.prepare('UPDATE ai_grants SET expires_at=1,request_id=?,request_hash=?,receipt=? WHERE id=?').run(changes[winner].requestId,createHash('sha256').update(JSON.stringify(changes[winner])).digest('hex'),JSON.stringify({...receipt,accessConsumed:true}),access.id);
      inspect.exec("UPDATE auth_configuration SET fingerprint='old-password'");
    }finally{inspect.close();}
    await start();
    assert.equal((await fetch(base+'/api/ai/v1/takeoff',{headers:{Authorization:'Bearer '+revoked.key}})).status,403);
    const retry=await fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(changes[winner])});assert.equal(retry.status,200);assert.deepEqual(await retry.json(),receipt);
    const second=await (await fetch(base+'/api/ai/v1/takeoff',{headers})).json();
    assert.equal(second.expiresAt,null);second.takeoff.name='Saved twice';
    const next={revision:second.revision,takeoff:second.takeoff,requestId:'second-save'};
    const duplicate=await Promise.all([1,2].map(()=>fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(next)})));
    assert.deepEqual(duplicate.map(response=>response.status),[200,200]);
    const receipts=await Promise.all(duplicate.map(response=>response.json()));assert.deepEqual(receipts[0],receipts[1]);
    await app.close();await start();
    const oldRetry=await fetch(base+'/api/ai/v1/save',{method:'POST',headers,body:JSON.stringify(changes[winner])});
    assert.deepEqual(await oldRetry.json(),receipt);
    const latest=await (await fetch(base+'/api/ai/v1/takeoff',{headers})).json();assert.equal(latest.takeoff.name,'Saved twice');
    const audit=new DatabaseSync(join(dataDir,'projects.sqlite'));
    try{assert.equal(audit.prepare('SELECT count(*) AS count FROM ai_changes WHERE grant_id=?').get(access.id).count,2);}finally{audit.close();}
  }finally{await app.close();}
});

test('AI keys read only enabled reference JSONs across workbooks and lose access when unchecked',async()=>{
  const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-ai-data-')),production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  let ws,doc;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Reference tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const create=async(items)=>(await (await call('/api/projects','POST',{name:'References',book:{lists:[{id:'list',companies:[{id:'co',projects:[{id:'pr',takeoffs:items}]}]}]}})).json()).id;
    const target=await create([takeoff('target')]);
    const admin='/api/projects/'+target+'/ai-access';
    const grant=await (await call(admin,'POST',{list:'list',takeoff:'target'})).json();
    // A key created before the reference exists can discover it without regeneration.
    const reference={...takeoff('reference'),aiData:true,aiDataMethod:'unit-price',aiDataWorkTypes:['concrete-pour','demo'],note:'Reference scope',scopeData:{source:'zz',items:[{id:'visible',name:'Visible scope'},{id:'hidden',name:'Secret scope',showAi:false}]}};
    const visibleReference={...reference,scopeData:{...reference.scopeData,items:[reference.scopeData.items[0]]}};
    const workbook=await create([reference,takeoff('private')]);
    const api='/api/ai/v1',args={workbook,list:'list',takeoff:'reference'},path=api+'/ai-data/takeoff?'+new URLSearchParams(args);
    assert.equal((await fetch(base+api+'/ai-data')).status,401);
    const index=await (await call(api+'/ai-data','GET',undefined,grant.key)).json();
    assert.deepEqual(index.estimates.map(e=>e.takeoff),['reference']);
    assert.equal(index.estimates[0].aiDataMethod,'unit-price');
    assert.deepEqual(index.estimates[0].aiDataWorkTypes,['concrete-pour','demo']);
    assert.equal(index.estimates[0].aiDataMethodLabel,'Unit price (SF / LF / EA)');
    assert.deepEqual((await (await call(api+'/instructions','GET',undefined,grant.key)).json()).aiData,index);
    const read=await (await call(path,'GET',undefined,grant.key)).json();assert.deepEqual(read.takeoff,visibleReference);assert.equal(read.readOnly,true);
    assert.equal((await call(path.replace('takeoff=reference','takeoff=private'),'GET',undefined,grant.key)).status,404);
    assert.equal((await call(api+'/ai-data/takeoff','GET',undefined,grant.key)).status,422);
    const rpc=async(name,arguments_={})=>(await (await call(api+'/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:arguments_}},grant.key)).json()).result;
    assert.deepEqual(JSON.parse((await rpc('read_ai_data',args)).content[0].text).takeoff,visibleReference);
    assert.deepEqual(JSON.parse((await rpc('list_ai_data')).content[0].text),index);
    const original=await (await call(api+'/takeoff','GET',undefined,grant.key)).json();
    assert.equal((await call(api+'/save','POST',{revision:original.revision,takeoff:reference,requestId:'cannot-edit-reference'},grant.key)).status,422);
    const spec=await (await call(api+'/openapi.json')).json();assert.equal(spec.paths['/ai-data/takeoff'].get.parameters.length,3);
    ws=new WebSocket(base.replace('http','ws')+'/live/'+workbook,{headers:{cookie}});
    const [bytes]=await once(ws,'message');doc=new Y.Doc();Y.applyUpdate(doc,Buffer.from(JSON.parse(bytes.toString()).state,'base64'));
    const before=readBook(doc),after=structuredClone(before);after.lists[0].companies[0].projects[0].takeoffs[0].aiData=false;
    const vector=Y.encodeStateVector(doc);writeBook(doc,before,after);
    const ack=new Promise(resolve=>ws.on('message',bytes=>{if(JSON.parse(bytes.toString()).type==='ack')resolve();}));
    ws.send(JSON.stringify({type:'update',seq:1,update:Buffer.from(Y.encodeStateAsUpdate(doc,vector)).toString('base64')}));await ack;
    assert.equal((await call(path,'GET',undefined,grant.key)).status,404);
    assert.deepEqual((await (await call(api+'/ai-data','GET',undefined,grant.key)).json()).estimates,[]);
    assert.equal((await rpc('read_ai_data',args)).isError,true);
    await call(admin+'/'+grant.id,'DELETE');
    assert.equal((await call(api+'/ai-data','GET',undefined,grant.key)).status,403);
  }finally{ws?.terminate();doc?.destroy();await app.close();}
});

test('Explicitly disabled Scope stays private across AI reads and hidden data survives AI saves',async()=>{
  const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-private-scope-')),production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Scope tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const hidden={...takeoff('one'),aiData:true,scopeAiAccess:false,scopeLink:'https://private-scope-link',scopeData:{source:'private-source',items:[{id:'secret',name:'private-scope-name',status:'included'}]}};
    const book={lists:[{id:'list',companies:[{id:'co',projects:[{id:'pr',takeoffs:[hidden]}]}]}]};
    const workbook=await (await call('/api/projects','POST',{name:'Private Scope',book})).json();
    const grant=await (await call('/api/projects/'+workbook.id+'/ai-access','POST',{list:'list',takeoff:'one'})).json();
    const api='/api/ai/v1';
    for(const path of ['/takeoff','/instructions','/ai-data/takeoff?'+new URLSearchParams({workbook:workbook.id,list:'list',takeoff:'one'})]){
      const res=await call(api+path,'GET',undefined,grant.key);assert.equal(res.status,200);assert.doesNotMatch(await res.text(),/private-scope|private-source/);
    }
    assert.equal((await call(api+'/scope','GET',undefined,grant.key)).status,403);
    const rpc=await (await call(api+'/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'read_scope'}},grant.key)).json();assert.equal(rpc.result.isError,true);
    const read=await (await call(api+'/takeoff','GET',undefined,grant.key)).json();
    for(const extra of [{scopeAiAccess:true},{scopeData:hidden.scopeData},{scopeLink:hidden.scopeLink}])assert.equal((await call(api+'/validate','POST',{revision:read.revision,takeoff:{...read.takeoff,...extra}},grant.key)).status,422);
    read.takeoff.name='Normal AI edit';
    const saved=await call(api+'/save','POST',{revision:read.revision,takeoff:read.takeoff,requestId:'private-scope-save'},grant.key);assert.equal(saved.status,200);
    const receipt=await saved.json(),again=await (await call(api+'/takeoff','GET',undefined,grant.key)).json();assert.equal(receipt.revision,again.revision);assert.equal(again.takeoff.scopeData,undefined);
    const exported=await (await call('/api/projects/'+workbook.id+'/export')).json(),actual=exported.lists[0].companies[0].projects[0].takeoffs[0];
    assert.deepEqual(actual.scopeData,hidden.scopeData);assert.equal(actual.scopeLink,hidden.scopeLink);assert.equal(actual.name,'Normal AI edit');
  }finally{await app.close();}
});
