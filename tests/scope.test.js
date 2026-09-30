import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { mergeScope } from '../shared/scope.js';
import { zzProject, zzScope, scriptTool, scopeScript, zzTransportError } from '../server-zztakeoff.js';

test('scope refresh preserves decisions by source ID and retains missing items for review',()=>{
  const old={source:'project',items:[{id:'a',name:'Old name',status:'excluded'},{id:'b',name:'Removed',status:'duplicate'}]};
  const next=mergeScope(old,{source:'project',items:[{id:'a',name:'New name',measurements:'area: 160 SF'},{id:'c',name:'New'}]});
  assert.equal(next.items[0].status,'excluded');assert.equal(next.items[0].measurements,'area: 160 SF');
  assert.equal(next.items[1].status,'included');assert.equal(next.items[2].missing,true);assert.equal(next.items[2].status,'duplicate');
  const other=mergeScope(old,{source:'other',items:[{id:'a',name:'Different project'}]});assert.equal(other.items[0].status,'included');assert.equal(other.items.length,1);
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
  const script=new Script(scopeScript('source'));
  const calls=[];
  const context={getContext:()=>({projectId:'source'}),Takeoffs:{list(query,options){
    calls.push(options.skip);
    return {records:[{_id:options.skip?'second':'first'}],pagination:{more:options.skip===0,skip:100,limit:100}};
  }}};
  const result=script.runInNewContext(context,{timeout:1000});
  assert.deepEqual(JSON.parse(JSON.stringify(result)),{projectId:'source',records:[{_id:'first'},{_id:'second'}]});
  assert.deepEqual(calls,[0,100]);
  assert.equal(result.then,undefined);
  assert.throws(()=>script.runInNewContext({...context,getContext:()=>({projectId:'wrong'})}),/Open the linked project/);
  assert.deepEqual(calls,[0,100]);
  assert.throws(()=>script.runInNewContext({...context,Takeoffs:{list:()=>({records:[],pagination:{more:true,skip:0}})}}),/did not advance/);
});
