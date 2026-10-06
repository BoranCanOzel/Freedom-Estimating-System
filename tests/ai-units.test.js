import test from 'node:test';
import assert from 'node:assert/strict';
import {validateTakeoff,takeoffSchema} from '../shared/ai-takeoff.js';
const takeoff=()=>({id:'takeoff',name:'Estimate',sheets:[{id:'page',units:[{id:'up',qty:1000,label:'SF'}],rows:[
  {id:'parent',type:'section',units:{up:{qty:120,label:'LF'}}},
  {id:'child',type:'section',units:{up:{qty:'3',label:'EA'}}},
  {id:'work',kind:'labor',cost:300,count:1,time:1,days:1},
  {id:'child-end',type:'sectionEnd',sid:'child'},
  {id:'parent-end',type:'sectionEnd',sid:'parent'}
]}]});
test('AI schema exposes page columns and nested section quantity and label overrides',()=>{
 const schema=takeoffSchema.properties.sheets.items.properties;
 assert.ok(schema.units.items.properties.qty);
 assert.ok(schema.units.items.properties.label);
 assert.ok(schema.rows.items.properties.units.additionalProperties.properties.qty);
 assert.ok(schema.rows.items.properties.units.additionalProperties.properties.label);
 for(const override of [{qty:12,label:'LF'},{qty:'2',label:'EA'},{qty:'',label:''},{qty:0},{}]){
  const before=takeoff(),next=takeoff();next.sheets[0].rows[1].units.up=override;
  assert.equal(validateTakeoff(next,before),next);
 }
});
test('AI rejects malformed or unlinked section UP overrides',()=>{
 for(const units of [[],null,5,{missing:{qty:3,label:'EA'}},{up:null},{up:[]},{up:{qty:'$3'}},{up:{qty:'1,000'}},{up:{label:5}}]){
  const before=takeoff(),next=takeoff();next.sheets[0].rows[1].units=units;
  assert.throws(()=>validateTakeoff(next,before));
 }
 for(const units of [{up:{qty:3}},[null],[{id:'up',label:5}],[{id:'up',qty:Infinity}]]){
  const before=takeoff(),next=takeoff();next.sheets[0].units=units;
  assert.throws(()=>validateTakeoff(next,before));
 }
});
