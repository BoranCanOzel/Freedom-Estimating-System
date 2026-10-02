import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { mergeScope } from '../shared/scope.js';
import { zzProject, zzScope, scriptTool, scopeScript, zzTransportError, zzScopeError, scopePayload } from '../server-zztakeoff.js';

test('scope refresh preserves decisions by source ID and removes deleted source items',()=>{
  const old={source:'project',items:[{id:'a',name:'Old name',status:'excluded',showAi:false,note:'Night shift only'},{id:'b',name:'Removed',status:'duplicate'}]};
  const next=mergeScope(old,{source:'project',items:[{id:'a',name:'New name',measurements:'area: 160 SF'},{id:'c',name:'New'}]});
  assert.equal(next.items[0].note,'Night shift only');assert.equal(next.items[0].showAi,false);assert.equal(next.items[0].status,'excluded');assert.equal(next.items[0].measurements,'area: 160 SF');
  assert.equal(next.items[1].status,'included');assert.deepEqual(next.items.map(item=>item.id),['a','c']);
  assert.deepEqual(mergeScope(old,{source:'project',items:[]}).items,[]);
  const legacy={source:'project',items:[...old.items,{id:'legacy',name:'Previously removed',missing:true}]};
  assert.deepEqual(mergeScope(legacy,{source:'project',items:[]}).items,[]);
  const other=mergeScope(old,{source:'other',items:[{id:'a',name:'Different project'}]});assert.equal(other.items[0].note,undefined);assert.equal(other.items[0].status,'included');assert.equal(other.items.length,1);
  assert.throws(()=>mergeScope(old,{source:'project',items:[{id:'a',name:'One'},{id:'a',name:'Two'}]}),/unique/);
});

test('ZZTakeoff source URLs and read-only scope extraction preserve evaluated quantities',()=>{
  assert.equal(zzProject('www.zztakeoff.com/app/takeoff?projectId=abc123'),'abc123');
  for(const url of ['https://example.com/?projectId=x','javascript:alert(1)','https://www.zztakeoff.com/app','https://user:password@www.zztakeoff.com/?projectId=x'])assert.throws(()=>zzProject(url));
  const scope=zzScope([{_id:'folder',type:'folder',properties:{name:{value:'Concrete'}}},{_id:'item',parentId:'folder',properties:{name:{value:'Pourback'},area:{value:'10*16',result:160,formatted:'160 SF'},cost:{result:4000}}}],'abc');
  assert.deepEqual(scope.items,[{id:'item',name:'Pourback',group:'Concrete',measurements:'area: 160 SF'}]);
  assert.match(scopeScript('abc'),/Takeoffs\.list/);assert.doesNotMatch(scopeScript('abc'),/\.insert|\.update|\.delete/);
  assert.equal(scriptTool([{name:'get_script',description:'Read a script',inputSchema:{properties:{script:{type:'string'}}}}]),undefined);
  assert.equal(scriptTool([{name:'run_script',inputSchema:{required:['code','tabId'],properties:{code:{type:'string'}}}}]),undefined);
});

test('ZZTakeoff errors distinguish browser waits, DNS, TLS and interrupted connections without exposing secrets',()=>{
  const stage='reading scope items';
  assert.match(zzTransportError(new DOMException('private detail','TimeoutError'),stage).message,/timed out.*linked project.*reading scope items/);
  for(const [code,expected] of [['ENOTFOUND',/DNS/],['CERT_HAS_EXPIRED',/TLS/],['ECONNRESET',/interrupted/],['UND_ERR_CONNECT_TIMEOUT',/outbound HTTPS/]]){
    const error=new TypeError('private-test-token',{cause:Object.assign(new Error('private-test-token'),{code})});
    const failure=zzTransportError(error,stage);
    assert.match(failure.message,expected);assert.doesNotMatch(failure.message,/private-test-token/);
  }
});

test('generated scope code executes as a synchronous script, checks the project and fetches every page',()=>{
  const script=new Script('(function () {\n'+scopeScript('source')+'\n})()');
  const calls=[];
  const context={Pages:{list:()=>({records:[]})},DrawObjects:{list:()=>({records:[]})},Projects:{getCurrent:()=>({_id:'source'})},Takeoffs:{list(query,options){
    calls.push(options.skip);
    return {records:[{_id:options.skip?'second':'first'}],pagination:{more:options.skip===0,skip:100,limit:100}};
  }}};
  const result=script.runInNewContext(context,{timeout:1000});
  assert.deepEqual(scopePayload({content:[{type:'text',text:result}]},'source'),{projectId:'source',records:[{_id:'first'},{_id:'second'}]});
  assert.deepEqual(calls,[0,100]);
  assert.equal(result.then,undefined);
  assert.throws(()=>script.runInNewContext({...context,Pages:{list:()=>({records:[]})},DrawObjects:{list:()=>({records:[]})},Projects:{getCurrent:()=>({_id:'wrong'})}}),/connected ZZTakeoff tab is on project wrong, but the saved link is for project source/);
  assert.deepEqual(calls,[0,100]);
  assert.throws(()=>script.runInNewContext({...context,Takeoffs:{list:()=>({records:[],pagination:{more:true,skip:0}})}}),/did not advance/);
});

test('scope reads the current project separately from drawing context and refuses an unopened project',()=>{
  const script=new Script('(function () {\n'+scopeScript('source')+'\n})()');
  const drawingContext={activeTool:null,page:{_id:'page'},cursor:null,zoom:1,selectedTakeoff:null,selectedDrawObjects:[]};
  const result=script.runInNewContext({
    getContext:()=>assert.fail('Drawing context cannot identify the project'),
    Pages:{list:()=>({records:[]})},DrawObjects:{list:()=>({records:[]})},Projects:{getCurrent:()=>({_id:'source',properties:{name:{value:'Concrete'}}})},
    Takeoffs:{list:()=>({records:[],pagination:{more:false}})}
  });
  assert.equal(scopePayload({content:[{type:'text',text:result}]},'source').projectId,'source');
  for(const value of [null,{},drawingContext]){
    assert.throws(()=>script.runInNewContext({Pages:{list:()=>({records:[]})},DrawObjects:{list:()=>({records:[]})},Projects:{getCurrent:()=>value},Takeoffs:{list:()=>assert.fail('Must not read unverified project')}}),error=>{
      assert.match(error.message,/ZZ_SCOPE_CONTEXT/);
      assert.match(zzScopeError(error.message),/No project is open/);return true;
    });
  }
  assert.equal(zzScopeError('private upstream log'),'');
});

test('scope accepts ZZTakeoff execution envelopes and rejects failed or mismatched results',()=>{
  const payload={projectId:'source',records:[]};
  for(const value of [payload,{success:true,result:payload,logs:[],elapsed:10}]){
    for(const response of [{structuredContent:value},{content:[{type:'text',text:JSON.stringify(value)}]}]){
      assert.deepEqual(scopePayload(response,'source'),payload);
    }
  }
  for(const value of [{success:true,logs:[]},{success:true,result:{projectId:'wrong',records:[]}},{projectId:'source',records:{}},{projectId:'source',records:Array(10001).fill({})}]){
    assert.throws(()=>scopePayload({structuredContent:value},'source'),/unsupported scope response/);
  }
  assert.throws(()=>scopePayload({content:[{type:'text',text:JSON.stringify({success:false,error:'ZZ_SCOPE_PROJECT: Wrong project.',result:payload})}]},'source'),/Wrong project/);
  assert.throws(()=>scopePayload({structuredContent:{success:false,error:'private upstream data'}},'source'),error=>{
    assert.doesNotMatch(error.message,/private upstream data/);return true;
  });
});

test('scope unwraps nested and JSON-encoded MCP results without importing logs or failed envelopes',()=>{
  const payload={projectId:'source',records:[{_id:'a'}]};
  for(const wrapped of [
    {result:{success:true,result:payload}},
    {success:true,result:JSON.stringify(payload)},
    {data:{output:{returnValue:payload}}},
    {content:[{type:'text',text:'```json\n'+JSON.stringify({success:true,result:payload})+'\n```'}]}
  ]){
    assert.deepEqual(scopePayload({structuredContent:wrapped},'source'),payload);
    assert.deepEqual(scopePayload({content:[{type:'text',text:JSON.stringify(wrapped)}]},'source'),payload);
  }
  for(const response of [
    {structuredContent:{success:true,logs:[JSON.stringify(payload)]}},
    {structuredContent:payload,content:[{type:'text',text:JSON.stringify({success:false,error:'private detail'})}]},
    {structuredContent:{result:{projectId:'wrong',records:[]}}}
  ])assert.throws(()=>scopePayload(response,'source'));
  assert.throws(()=>scopePayload({structuredContent:{secret:'private value',result:null},content:[{type:'text',text:'private token'}]},'source'),error=>{
    assert.match(error.message,/reader v3.*result:null/);
    assert.doesNotMatch(error.message,/private|secret/);return true;
  });
});

test('scope extracts its encoded payload from prose without losing names or quantities',()=>{
  const records=[{_id:'a',properties:{name:{value:'Slab "A"\nCaf\u00e9 / 50% :END_FREEDOM_SCOPE_V1'},area:{formatted:'160 SF'}}}];
  const script=new Script('(function () {\n'+scopeScript('source')+'\n})()');
  const output=script.runInNewContext({Pages:{list:()=>({records:[]})},DrawObjects:{list:()=>({records:[]})},Projects:{getCurrent:()=>({_id:'source'})},Takeoffs:{list:()=>({records,pagination:{more:false}})}});
  const expected={projectId:'source',records};
  for(const text of [output,'Script completed.\nResult: '+output+'\nElapsed: 12ms','Result:\n```\n'+output+'\n```',JSON.stringify({success:true,result:output})]){
    assert.deepEqual(scopePayload({isError:false,content:[{type:'text',text}]},'source'),expected);
  }
  for(const text of [output.slice(0,-10),'FREEDOM_SCOPE_V1:%ZZ:END_FREEDOM_SCOPE_V1',JSON.stringify({success:false,result:output})]){
    assert.throws(()=>scopePayload({content:[{type:'text',text}]},'source'));
  }
  assert.throws(()=>scopePayload({isError:true,content:[{type:'text',text:output}]},'source'));
  assert.throws(()=>scopePayload({content:[{type:'text',text:output}]},'another-project'));
});

test('scope imports ZZ measurement slots and units instead of assembly dimensions',()=>{
  const records=[
    {_id:'ramp',properties:{name:{value:'Construct Ramp'},length:{result:5},'measurement 1':{key:'area',result:160,formatted:'160.00',units:'SF'},'measurement 2':{key:'volume',result:3,formatted:'3 CY',units:'CY'}}},
    {_id:'linear',properties:{'measurement 1':{key:'length',result:80,units:'LF'}}},
    {_id:'count',properties:{'measurement 1':{key:'count',result:0,formatted:'0',units:'EA'}}},
    {_id:'empty',properties:{length:{result:10},'measurement 1':{key:'area'}}},
    {_id:'item',properties:{qty:{result:4,formatted:'4',units:'EA'}}}
  ];
  const items=zzScope(records,'source').items;
  assert.equal(items[0].measurements,'area: 160.00 SF\nvolume: 3 CY');
  assert.equal(items[1].measurements,'length: 80 LF');
  assert.equal(items[2].measurements,'count: 0 EA');
  assert.equal(items[3].measurements,'');
  assert.equal(items[4].measurements,'qty: 4 EA');
});

test('scope maps drawing pages and assembly children without repeating shared quantities',()=>{
  const script=new Script('(function () {\n'+scopeScript('source')+'\n})()');
  const result=script.runInNewContext({
    Projects:{getCurrent:()=>({_id:'source'})},
    Pages:{list:()=>({records:[{_id:'p2',order:2,properties:{number:{value:'A2'},name:{value:'Details'}}},{_id:'p1',order:1,properties:{number:{value:'A1'},name:{value:'Plan'}}}]})},
    DrawObjects:{list:(_query,{skip})=>skip?{records:[{_id:'d2',takeoffId:'assembly',pageId:'p2'}]}:{records:[{_id:'d1',takeoffId:'assembly',pageId:'p1'},{_id:'cut',takeoffId:'assembly',pageId:'ignored',cutoutForId:'d1'}],pagination:{more:true,skip:2}}},
    Takeoffs:{list:()=>({records:[{_id:'assembly',properties:{name:{value:'Slab'},'measurement 1':{key:'area',result:160,units:'SF'}}},{_id:'child',parentId:'assembly',properties:{name:{value:'Concrete'}}},{_id:'unassigned',properties:{}}]})}
  });
  const payload=scopePayload({content:[{type:'text',text:result}]},'source');
  const scope=zzScope(payload.records,'source');
  assert.equal(scope.items.length,3);
  assert.deepEqual(scope.items[0].pages,[{id:'p1',name:'A1 - Plan'},{id:'p2',name:'A2 - Details'}]);
  assert.deepEqual(scope.items[1].pages,scope.items[0].pages);
  assert.equal(scope.items[0].measurements,'area: 160 SF');
  assert.equal(scope.items[2].pages,undefined);
  const merged=mergeScope({source:'source',items:[{...scope.items[0],status:'excluded'}]},scope);
  assert.deepEqual(merged.items[0].pages,scope.items[0].pages);assert.equal(merged.items[0].status,'excluded');
});
