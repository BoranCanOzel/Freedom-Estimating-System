import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';
import {validateTakeoff,takeoffSchema} from '../shared/ai-takeoff.js';

const line=()=>({id:'load',name:'Slab',ct:1,l:27,w:10,d:12,fluff:30,lt:10});
const takeoff=()=>({id:'t',name:'Estimate',sheets:[{id:'page',rows:[],loadOn:false,loadCalc:[line()]},{id:'other',rows:[],loadCalc:[{...line(),id:'other-load',l:54}]}]});
test('AI load calculator schema and validation cover page inputs and malformed quantities',()=>{
  const schema=takeoffSchema.properties.sheets.items.properties;
  for(const field of ['ct','l','w','d','fluff','lt'])assert.ok(schema.loadCalc.items.properties[field]);
  assert.equal(schema.loadOn.type,'boolean');
  const before=takeoff(),next=takeoff();
  next.sheets[0].loadCalc=[{id:'group',type:'section',name:'Concrete',shut:true},{...line(),ct:'2',lt:''}];
  assert.equal(validateTakeoff(next,before),next);
  for(const invalid of [null,{},[null],[{}],[line(),line()],[{...line(),d:'12 inches'}],[{...line(),l:Infinity}],[{...line(),type:'sectionEnd'}],[{...line(),name:3}],[{...line(),shut:'yes'}]]){
    const bad=takeoff();bad.sheets[0].loadCalc=invalid;assert.throws(()=>validateTakeoff(bad,before));
  }
  const bad=takeoff();bad.sheets[0].loadOn='yes';assert.throws(()=>validateTakeoff(bad,before));
});

test('AI reads, validates and saves per-page load calculators over HTTP and MCP',async()=>{
  const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-ai-load-')),production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Load tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[takeoff()]}]}]}]};
    const created=await (await call('/api/projects','POST',{name:'Loads',book})).json();
    const grant=await (await call('/api/projects/'+created.id+'/ai-access','POST',{list:'l',takeoff:'t'})).json();
    const endpoint='/api/ai/v1';
    const instructions=await (await call(endpoint+'/instructions','GET',undefined,grant.key)).json();
    assert.ok(instructions.schema.properties.sheets.items.properties.loadCalc);assert.match(instructions.instructions,/### Per-page load calculator/);
    let rpcId=0;
    const mcp=async(name,args={})=>{
      const result=await (await call(endpoint+'/mcp','POST',{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:args}},grant.key)).json();
      assert.equal(result.result.isError,undefined,JSON.stringify(result));return JSON.parse(result.result.content[0].text);
    };
    let current=await (await call(endpoint+'/takeoff','GET',undefined,grant.key)).json();
    assert.deepEqual(current.takeoff.sheets[0].loadCalc,[line()]);
    const sibling=structuredClone(current.takeoff.sheets[1]);
    current.takeoff.sheets[0].loadOn=true;current.takeoff.sheets[0].loadCalc[0].ct=2;
    const payload={revision:current.revision,takeoff:current.takeoff,requestId:'loads-http'};
    assert.equal((await call(endpoint+'/validate','POST',payload,grant.key)).status,200);
    assert.equal((await call(endpoint+'/save','POST',payload,grant.key)).status,200);
    current=await mcp('read_takeoff');assert.equal(current.takeoff.sheets[0].loadCalc[0].ct,2);
    assert.deepEqual(current.takeoff.sheets[1],sibling);
    current.takeoff.sheets[0].loadCalc[0].lt='20';current.takeoff.sheets[0].loadOn=false;
    const update={revision:current.revision,takeoff:current.takeoff,requestId:'loads-mcp'};
    assert.equal((await mcp('validate_changes',update)).valid,true);assert.equal((await mcp('save_takeoff',update)).saved,true);
    const saved=await (await call(endpoint+'/takeoff','GET',undefined,grant.key)).json();
    assert.deepEqual(saved.takeoff,current.takeoff);assert.deepEqual(saved.takeoff.sheets[0].rows,[]);
  }finally{await app.close();}
});
