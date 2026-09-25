import test from 'node:test';
import assert from 'node:assert/strict';
import {applyTakeoffDraft} from '../shared/takeoff-draft.js';
test('guest edits preserve untouched omitted fields and normalized numbers while applying additions, removals and order',()=>{
 const original={id:'t',sheets:[{id:'s',hiddenCols:['time'],rows:[{id:'a',cost:'50',collapsed:true},{id:'b',cost:20},{id:'c',cost:30}]}]};
 const before={id:'t',sheets:[{id:'s',rows:[{id:'a',cost:50,type:'item'},{id:'b',cost:20,type:'item'},{id:'c',cost:30,type:'item'}]}]};
 const after=structuredClone(before);after.sheets[0].rows=[after.sheets[0].rows[2],{...after.sheets[0].rows[0],name:'New label'},{id:'d',cost:40}];
 const result=applyTakeoffDraft(original,before,after);
 assert.deepEqual(result.sheets[0].hiddenCols,['time']);assert.deepEqual(result.sheets[0].rows,[{id:'c',cost:30},{id:'a',cost:'50',collapsed:true,name:'New label'},{id:'d',cost:40}]);
 assert.deepEqual(applyTakeoffDraft(original,before,before),original);
});
