import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeScope } from '../shared/scope.js';
import { zzProject, zzScope, scriptTool, scopeScript } from '../server-zztakeoff.js';

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
