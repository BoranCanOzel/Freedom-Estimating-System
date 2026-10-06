import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTimeline,validateTimeline,workDate,timelinePeakCrew} from '../shared/timeline.js';
const labor=(id,count=2,time=8,days=2)=>({id,kind:'labor',name:id,count,time,days,cost:100});
const section=id=>({id,type:'section',name:id});
const end=id=>({id:id+'-end',type:'sectionEnd',sid:id});
const takeoff=()=>({id:'t',name:'Job',sheets:[{id:'a',title:'Demo',color:'teal',rows:[section('parent'),labor('crew'),{id:'saw',kind:'equip',name:'Saw',count:1,time:8,days:2},section('child'),labor('operator',1,4,1),end('child'),end('parent')]},{id:'b',title:'Pour',rows:[labor('pour',3,8,1)]}]});
test('timeline uses direct labor once, groups section rows and sequences 8-hour workdays',()=>{
  const source=takeoff(),before=structuredClone(source),draft=deriveTimeline(source);
  assert.deepEqual(draft.tasks.map(t=>t.id),['parent','child','pour']);
  assert.deepEqual(draft.tasks.map(t=>[t.startHour,t.durationHours]),[[0,16],[16,4],[20,8]]);
  assert.equal(draft.laborHours,60);assert.equal(draft.endHour,28);assert.equal(draft.days,4);assert.equal(draft.peakCrew,3);
  assert.deepEqual(source,before);assert.equal(draft.tasks[0].color,'teal');
});
test('labor in the same section overlaps instead of doubling elapsed duration',()=>{
  const source=takeoff();source.sheets[0].rows.splice(2,0,labor('helper',1,8,2));
  const task=deriveTimeline(source).tasks[0];assert.equal(task.durationHours,16);assert.equal(task.laborHours,48);assert.equal(task.crew,3);
});
test('crew, duration and start overrides affect planning only and remain linked to IDs',()=>{
  const source=takeoff();source.timeline={hoursPerDay:10,tasks:[{id:'parent',crew:4},{id:'child',startHour:0,durationHours:6}]};
  validateTimeline(source);const result=deriveTimeline(source);
  assert.equal(result.tasks[0].durationHours,8);assert.equal(result.tasks[1].startHour,0);assert.equal(result.tasks[1].durationHours,6);assert.equal(result.peakCrew,5);
  assert.equal(source.sheets[0].rows[1].count,2);assert.equal(source.sheets[0].rows[1].days,2);
});
test('parallel pages overlap independent page crews, and exclusions do not consume time',()=>{
  const source=takeoff();source.timeline={mode:'parallel-pages',tasks:[{id:'child',excluded:true}]};
  const result=deriveTimeline(source);assert.equal(result.tasks[2].startHour,0);assert.equal(result.endHour,16);assert.equal(result.peakCrew,5);assert.equal(result.tasks[1].scheduled,false);
  assert.equal(timelinePeakCrew(result.tasks,8,16),2);
});
test('non-labor and incomplete labor need review and block automatic successors until scheduled',()=>{
  const source=takeoff();source.sheets[0].rows.unshift({id:'mobilize',kind:'equip',name:'Mobilization',time:8,days:2,count:1});
  let result=deriveTimeline(source);assert.equal(result.tasks[0].status,'Needs duration');assert.equal(result.tasks[1].status,'Waiting for prior duration');
  source.timeline={tasks:[{id:'mobilize',durationHours:4}]};result=deriveTimeline(source);assert.equal(result.tasks[1].startHour,4);
  source.sheets[0].rows[2].time='';assert.equal(deriveTimeline(source).tasks[1].status,'Needs duration');
  source.timeline.tasks.push({id:'parent',durationHours:8});assert.equal(deriveTimeline(source).tasks[1].scheduled,true);
});
test('calendar dates skip weekends without timezone shifts and use complete working days',()=>{
  assert.equal(workDate('2026-10-09',0),'2026-10-09');assert.equal(workDate('2026-10-09',1),'2026-10-12');
  assert.equal(workDate('2026-10-10',0),'2026-10-12');assert.equal(workDate('2026-10-09',6),'2026-10-19');
  assert.equal(workDate('2026-10-09',1,false),'2026-10-10');assert.equal(workDate('2026-02-30',0),'');
  const source=takeoff();source.timeline={startDate:'2026-10-09'};assert.equal(deriveTimeline(source).finishDate,'2026-10-14');
});
test('invalid schedule settings, duplicate task IDs and invalid overrides are rejected',()=>{
  for(const timeline of [null,[],{hoursPerDay:0},{hoursPerDay:25},{mode:'magic'},{startDate:'2026-02-30'},{skipWeekends:'yes'},{surprise:1},{tasks:[{id:'missing',crew:2}]},{tasks:[{id:'parent',durationHours:0}]},{tasks:[{id:'parent',startHour:-1}]},{tasks:[{id:'parent',crew:Infinity}]},{tasks:[{id:'parent'},{id:'parent'}]}])assert.throws(()=>validateTimeline({...takeoff(),timeline}));
});
test('empty estimates do not create fake work or dates',()=>{
  const result=deriveTimeline({sheets:[{id:'a',rows:[{...labor('blank'),name:'',cost:''}]}]});
  assert.equal(result.tasks.length,0);assert.equal(result.days,0);assert.equal(result.finishDate,'');
});
