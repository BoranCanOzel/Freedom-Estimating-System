import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';

test('human notes persist, are shared with signed-in teammates, reject stale saves and stay outside AI access',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-human-info-'));let app,base;
  const start=async()=>{app=createApp({dataDir,production:false});app.server.listen(0,'127.0.0.1');await once(app.server,'listening');base='http://127.0.0.1:'+app.server.address().port;};
  await start();
  try{
    const login=async name=>(await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:'1313'})})).headers.get('set-cookie').split(';')[0];
    const alice=await login('Notes Alice'),bob=await login('Notes Bob');
    const call=(path,method='GET',body,headers={cookie:alice})=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
    const endpoint='/api/human-information';
    assert.equal((await call(endpoint,'GET',undefined,{})).status,401);
    assert.equal((await call(endpoint,'PUT',{items:[]},{})).status,401);
    const initial=await (await call(endpoint)).json();assert.deepEqual(initial.items,[]);
    const aiBefore=await (await call('/api/ai-information')).json();
    const items=[{id:'folder',parent:'',kind:'folder',title:'Team reminders',text:''},{id:'note',parent:'folder',kind:'entry',title:'Human-only reminder',text:'Internal note 7c21: call the supplier on Friday.'}];
    const saved=await call(endpoint,'PUT',{revision:initial.revision,items});assert.equal(saved.status,200);const current=await saved.json();
    assert.deepEqual(await (await call(endpoint,'GET',undefined,{cookie:bob})).json(),current);
    assert.equal((await call(endpoint,'PUT',{revision:initial.revision,items:[]},{cookie:bob})).status,409);
    for(const invalid of [[{...items[0],parent:'folder'}],[{...items[1],parent:'missing'}],[{...items[1],parent:'',file:'x'}],[{...items[1],parent:'',title:''}]])assert.equal((await call(endpoint,'PUT',{revision:current.revision,items:invalid})).status,422);
    assert.deepEqual(await (await call('/api/ai-information')).json(),aiBefore);
    const key=(await (await call('/api/ai-access/universal','POST')).json()).key,headers={Authorization:'Bearer '+key};
    assert.equal((await call(endpoint,'GET',undefined,headers)).status,401);
    assert.equal((await call(endpoint,'PUT',{revision:current.revision,items:[]},headers)).status,401);
    for(const path of ['/instructions','/information','/ai-data']){
      const response=await call('/api/ai/v1'+path,'GET',undefined,headers);assert.equal(response.status,200);assert(!(await response.text()).includes('Internal note 7c21'));
    }
    const tools=await (await call('/api/ai/v1/mcp','POST',{jsonrpc:'2.0',id:1,method:'tools/list'},headers)).json();assert(!JSON.stringify(tools).includes('human'));
    await app.close();await start();
    assert.deepEqual(await (await call(endpoint)).json(),current);
    assert.equal((await call(endpoint,'PUT',{revision:current.revision,items:[]})).status,200);
    assert.deepEqual((await (await call(endpoint)).json()).items,[]);
  }finally{await app.close();}
});
