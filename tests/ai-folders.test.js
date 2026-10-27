import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server.js';

test('HTTP and MCP AI access create, rename, reorder, move and delete folders with scoped and universal keys',async()=>{
  const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-ai-folders-')),production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'AI folder tester',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    const universal=await (await call('/api/ai-access/universal','POST')).json();
    let rpcId=0;
    for(const transport of ['http','mcp'])for(const access of ['scoped','universal']){
      const original={id:'t',name:'Estimate',sheets:[{id:'page',title:'Existing work',rows:[{id:'crew',kind:'labor',cost:100,count:2,time:8,days:1}]}],scopeData:{items:[{id:'measured',name:'Measured work',status:'included'}]},scopeAssignments:{measured:'page'},timeline:{tasks:[{id:'crew',startHour:0,durationHours:8,crew:2}]}};
      const sibling={id:'other',name:'Other estimate',folders:[{id:'foreign',name:'Other folder'}],sheets:[{id:'other-page',rows:[],folderId:'foreign'}]};
      const book={lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[original,sibling]}]}]}]};
      const created=await (await call('/api/projects','POST',{name:transport+' '+access,book})).json();
      const grant=access==='universal'?universal:await (await call('/api/projects/'+created.id+'/ai-access','POST',{list:'l',takeoff:'t'})).json();
      const target={workbook:created.id,list:'l',takeoff:'t'};
      const endpoint='/api/ai/v1';
      async function operation(name,args={}){
        const payload={...args,...(access==='universal'?{target}:{})};
        if(transport==='mcp'){
          const response=await call(endpoint+'/mcp','POST',{jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name,arguments:payload}},grant.key);
          assert.equal(response.status,200);
          const {result}=await response.json();assert.equal(result.isError,undefined,JSON.stringify(result));
          return JSON.parse(result.content[0].text);
        }
        const path={read_takeoff:'takeoff',validate_changes:'validate',save_takeoff:'save'}[name];
        const response=name==='read_takeoff'?await call(endpoint+'/'+path+(access==='universal'?'?'+new URLSearchParams(target):''),'GET',undefined,grant.key):await call(endpoint+'/'+path,'POST',payload,grant.key);
        assert.equal(response.status,200,await response.clone().text());return response.json();
      }
      const instructions=await (await call(endpoint+'/instructions','GET',undefined,grant.key)).json();
      assert.ok(instructions.schema.properties.folders);
      assert.ok(instructions.schema.properties.sheets.items.properties.folderId);
      assert.match(instructions.instructions,/## Takeoff folders/);
      const tools=await (await call(endpoint+'/mcp','POST',{jsonrpc:'2.0',id:++rpcId,method:'tools/list'},grant.key)).json();
      const schema=tools.result.tools.find(tool=>tool.name==='save_takeoff').inputSchema.properties.takeoff;
      assert.ok(schema.properties.folders);assert.ok(schema.properties.sheets.items.properties.folderId);
      let current=await operation('read_takeoff'),sequence=0;
      async function save(edit){
        const next=structuredClone(current.takeoff);edit(next);
        const payload={revision:current.revision,takeoff:next,requestId:transport+'-'+access+'-folder-'+(++sequence)};
        assert.equal((await operation('validate_changes',payload)).valid,true);
        assert.equal((await operation('save_takeoff',payload)).saved,true);
        current=await operation('read_takeoff');assert.deepEqual(current.takeoff,next);
        assert.deepEqual(current.takeoff.sheets[0].rows,original.sheets[0].rows);
        assert.deepEqual(current.takeoff.scopeAssignments,original.scopeAssignments);
        assert.deepEqual(current.takeoff.timeline,original.timeline);
      }
      await save(t=>{t.folders=[{id:'a',name:'Building A'},{id:'b',name:'Building B'}];t.sheets[0].folderId='a';t.sheets.push({id:'new-page',title:'New work',folderId:'b',rows:[]});});
      await save(t=>{t.folders[0].name='East building';t.folders.reverse();});
      await save(t=>{t.sheets[0].folderId='b';});
      // Reject references to another takeoff and deletion that strands pages.
      for(const edit of [t=>{t.sheets[0].folderId='foreign';},t=>{t.folders=[];}]){
        const next=structuredClone(current.takeoff);edit(next);
        const invalid=await call(endpoint+'/validate','POST',{revision:current.revision,takeoff:next,...(access==='universal'?{target}:{})},grant.key);
        assert.equal(invalid.status,422);
      }
      await save(t=>{t.folders=[];for(const page of t.sheets)delete page.folderId;});
      assert.equal(current.takeoff.sheets.length,2);
      const exported=await (await call('/api/projects/'+created.id+'/export')).json();
      assert.deepEqual(exported.lists[0].companies[0].projects[0].takeoffs[1],sibling);
    }
  }finally{await app.close();}
});
