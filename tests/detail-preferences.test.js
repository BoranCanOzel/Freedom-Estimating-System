import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {createDetailPreferences} from '../client/detail-preferences.js';

test('detail choices default collapsed, survive offline reload and sync without crossing users or takeoffs',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  let offline=false,remote=[];
  const api=async(_path,options)=>{
    if(offline)throw Error('offline');
    if(options?.method==='PUT'){const item=JSON.parse(options.body);remote=remote.filter(r=>r.list!==item.list||r.takeoff!==item.takeoff).concat(item);return item;}
    return remote;
  };
  const make=(user='Alice')=>createDetailPreferences({api,user,workbook:'w',storage});
  let prefs=make();await prefs.load();assert.equal(prefs.collapsed('l','t'),true);
  await prefs.set('l','t',false);assert.equal(prefs.collapsed('l','other'),true);
  offline=true;await prefs.set('l','t',true);prefs=make();await prefs.load();assert.equal(prefs.collapsed('l','t'),true);
  assert.equal(make('Bob').collapsed('l','t'),true);
  offline=false;await prefs.load();await prefs.set('l','other',false);
  assert.equal(remote.find(r=>r.takeoff==='t').detailsCollapsed,true);
  assert.equal(remote.find(r=>r.takeoff==='other').detailsCollapsed,false);
});

test('server keeps detail preferences personal and durable without modifying workbook data',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-detail-prefs-'));let app,base;
  const start=async()=>{app=createApp({dataDir,production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;};
  await start();
  try{
    const login=async name=>(await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:'1313'})})).headers.get('set-cookie').split(';')[0];
    const alice=await login('Detail Alice'),bob=await login('Detail Bob');
    const call=(path,method='GET',body,cookie=alice)=>fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    const book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[{id:'t',name:'First',sheets:[{id:'s',rows:[]}]},{id:'other',name:'Other',sheets:[{id:'s2',rows:[]}]}]}]}]}]};
    const workbook=await (await call('/api/projects','POST',{name:'Preferences',book})).json();
    const path='/api/projects/'+workbook.id+'/takeoff-preferences';
    assert.equal((await fetch(base+path)).status,401);
    assert.deepEqual(await (await call(path)).json(),[]);
    const before=await (await call('/api/projects/'+workbook.id+'/export')).json();
    assert.equal((await call(path,'PUT',{list:'l',takeoff:'t',detailsCollapsed:false})).status,200);
    assert.equal((await call(path,'PUT',{list:'l',takeoff:'other',detailsCollapsed:true})).status,200);
    assert.deepEqual(await (await call(path,'GET',undefined,bob)).json(),[]);
    assert.equal((await call(path,'PUT',{list:'l',takeoff:'t',detailsCollapsed:'false'})).status,400);
    assert.equal((await call(path,'PUT',{list:'l',takeoff:'missing',detailsCollapsed:false})).status,404);
    assert.deepEqual(await (await call('/api/projects/'+workbook.id+'/export')).json(),before);
    await app.close();await start();
    const saved=await (await call(path)).json();assert.equal(saved.find(r=>r.takeoff==='t').detailsCollapsed,false);
    assert.equal(saved.find(r=>r.takeoff==='other').detailsCollapsed,true);
  }finally{await app.close();}
});
