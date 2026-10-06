import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveTimeline,validateTimeline,workDate,timelinePeakCrew} from '../shared/timeline.js';
import {scopeLanes} from '../client/timeline-chart.js';
const labor=(id,count=2,time=8,days=2)=>({id,kind:'labor',name:id,count,time,days,cost:100});
const section=id=>({id,type:'section',name:id});
const end=id=>({id:id+'-end',type:'sectionEnd',sid:id});
const takeoff=()=>({id:'t',name:'Job',sheets:[{id:'a',title:'Demo',color:'teal',rows:[section('parent'),labor('crew'),section('child'),labor('operator',1,4,1),end('child'),end('parent')]},{id:'b',title:'Pour',rows:[labor('pour',3,8,1)]}]});
const plan=()=>({tasks:[{id:'parent',startHour:0,durationHours:16,crew:2},{id:'child',startHour:16,durationHours:4,crew:1},{id:'pour',startHour:20,durationHours:8,crew:3}]});

test('opening a populated estimate never creates or schedules tasks, including legacy sequence settings',()=>{
  for(const timeline of [undefined,{}, {hoursPerDay:8}, {mode:'sequential'}, {mode:'parallel-pages',tasks:[]}]){
    const source={...takeoff(),timeline},before=structuredClone(source),result=deriveTimeline(source);
    assert.deepEqual(result.tasks,[]);assert.equal(result.hasPlan,false);assert.equal(result.days,0);assert.equal(result.peakCrew,0);
    assert.equal(result.availableWork.length,3);assert.equal(result.laborHours,60);assert.deepEqual(source,before);
  }
});
test('explicit plans render saved timing and crews without changing estimate quantities',()=>{
  const source={...takeoff(),timeline:plan()},before=structuredClone(source);validateTimeline(source);
  const result=deriveTimeline(source);assert.equal(result.endHour,28);assert.equal(result.days,4);assert.equal(result.peakCrew,3);
  assert.deepEqual(result.tasks.map(t=>[t.startHour,t.durationHours,t.crew]),[[0,16,2],[16,4,1],[20,8,3]]);
  assert.equal(result.tasks[0].color,'teal');assert.deepEqual(source,before);
  source.timeline.tasks[0].crew=4;assert.equal(deriveTimeline(source).tasks[0].durationHours,16);
  source.sheets[0].rows[1].days=100;source.sheets[1].rows.push(labor('new-work'));
  const changed=deriveTimeline(source);assert.equal(changed.tasks.length,3);assert.equal(changed.tasks[0].durationHours,16);assert.equal(changed.tasks[1].startHour,16);
});
test('incomplete saved entries are preserved but never filled from estimate or previous tasks',()=>{
  const source={...takeoff(),timeline:{mode:'sequential',tasks:[{id:'parent',crew:2},{id:'child',startHour:8,durationHours:4}]}};
  let result=deriveTimeline(source);assert.equal(result.unscheduled,2);assert.equal(result.days,0);
  assert.match(result.tasks[0].status,/start, duration/);assert.match(result.tasks[1].status,/crew/);
  source.timeline.tasks[0]={id:'parent',startHour:0,durationHours:8,crew:2};result=deriveTimeline(source);
  assert.equal(result.tasks[0].scheduled,true);assert.equal(result.tasks[1].scheduled,false);assert.equal(result.tasks.length,2);
});
test('exclusions and removing tasks never regenerate missing work',()=>{
  const source={...takeoff(),timeline:plan()};source.timeline.tasks[0].excluded=true;
  let result=deriveTimeline(source);assert.equal(result.tasks[0].scheduled,false);assert.equal(result.tasks[1].startHour,16);
  source.timeline.tasks=[];result=deriveTimeline(source);assert.equal(result.hasPlan,false);assert.equal(result.tasks.length,0);
});
test('estimate reference facts are separate from the plan and include parent scope IDs',()=>{
  const source=takeoff();source.sheets[0].rows.unshift(section('scope'));source.sheets[0].rows.push(end('scope'));
  let result=deriveTimeline(source);assert.equal(result.availableWork[0].id,'scope');assert.equal(result.availableWork[0].laborHours,0);
  assert.equal(result.availableWork[1].scopeId,'scope');assert.equal(result.laborHours,60);
  source.timeline={tasks:[{id:'scope',startHour:0,durationHours:24,crew:3}]};result=deriveTimeline(source);
  assert.equal(result.tasks.length,1);assert.equal(result.tasks[0].scheduled,true);
});
test('deleted or restructured sources remain flagged instead of generating replacement tasks',()=>{
  const source={...takeoff(),timeline:plan()};source.sheets[1].rows=[];
  const result=deriveTimeline(source);assert.equal(result.tasks.length,3);assert.equal(result.tasks[2].status,'Source needs review');assert.equal(result.tasks[2].scheduled,false);
});
test('calendar dates skip weekends and use saved working hours',()=>{
  assert.equal(workDate('2026-10-09',1),'2026-10-12');assert.equal(workDate('2026-10-10',0),'2026-10-12');
  assert.equal(workDate('2026-10-09',6),'2026-10-19');assert.equal(workDate('2026-10-09',1,false),'2026-10-10');assert.equal(workDate('2026-02-30',0),'');
  assert.equal(deriveTimeline({...takeoff(),timeline:{...plan(),startDate:'2026-10-09'}}).finishDate,'2026-10-14');
});
test('invalid plan settings, duplicate source IDs and invalid numeric fields are rejected',()=>{
  for(const timeline of [null,[],{hoursPerDay:0},{hoursPerDay:25},{mode:'magic'},{startDate:'2026-02-30'},{skipWeekends:'yes'},{surprise:1},{tasks:[{id:'missing',crew:2}]},{tasks:[{id:'parent',durationHours:0}]},{tasks:[{id:'parent',startHour:-1}]},{tasks:[{id:'parent',crew:Infinity}]},{tasks:[{id:'parent'},{id:'parent'}]}])assert.throws(()=>validateTimeline({...takeoff(),timeline}));
});
test('scope lanes group nested planned tasks and separate overlaps without moving them',()=>{
  const source={...takeoff(),timeline:{tasks:[{id:'parent',startHour:8,durationHours:8,crew:2},{id:'child',startHour:0,durationHours:12,crew:1},{id:'pour',startHour:24,durationHours:8,crew:3}]}};
  const result=deriveTimeline(source),before=structuredClone(result),groups=scopeLanes(result.tasks,0,24);
  assert.equal(groups.length,1);assert.equal(groups[0].id,'parent');assert.equal(groups[0].lanes,2);
  assert.deepEqual(groups[0].tasks.map(t=>[t.id,t.lane]),[['child',0],['parent',1]]);assert.deepEqual(result,before);
  assert.equal(scopeLanes(result.tasks,24,32)[0].id,'b');assert.equal(timelinePeakCrew(result.tasks,0,24),3);
});
test('generic Labor names retain actual work context within their main scope',()=>{
  const source={sheets:[{id:'a',title:'A001',rows:[{id:'demo',type:'section',name:'Interior demolition'},
    {id:'walls',type:'section',name:'Remove walls'},{id:'labor',type:'section',name:'Labor'},labor('crew'),end('labor'),end('walls'),end('demo'),
    {id:'trench',type:'section',name:'Plumbing trench'},labor('operator'),end('trench')]}],timeline:{tasks:[{id:'labor',startHour:0,durationHours:8,crew:2},{id:'trench',startHour:8,durationHours:4,crew:2}]}};
  const result=deriveTimeline(source);assert.equal(result.tasks[0].name,'Remove walls');assert.equal(result.tasks[0].sourceName,'Labor');
  assert.deepEqual(scopeLanes(result.tasks,0,24).map(g=>g.name),['Interior demolition','Plumbing trench']);
});

test('equipment is reference-only until AI assigns it, and daily costs are explicit allowances',()=>{
  const source=takeoff();source.sheets[0].rows.splice(2,0,{id:'excavator',name:'Mini excavator',kind:'equip',count:1,time:8,days:2,cost:95,note:'Use narrow bucket'});
  let result=deriveTimeline(source);assert.equal(result.hasPlan,false);assert.equal(result.availableResources.find(r=>r.id==='excavator').estimateRate,95);
  source.timeline={tasks:[{id:'parent',startHour:0,durationHours:8,crew:2,notes:'Protect occupied areas.',resources:[{id:'excavator',quantity:1,notes:'Trench excavation only.'}]}],costs:[
    {id:'trip',day:1,kind:'travel',amount:120,taskId:'parent',notes:'Crew transport'},
    {id:'stay',day:3,kind:'hotel',label:'Two rooms',amount:300},
    {id:'unknown',day:3,kind:'meals'}
  ]};
  const before=structuredClone(source);validateTimeline(source);result=deriveTimeline(source);
  assert.equal(result.tasks[0].resources[0].name,'Mini excavator');assert.equal(result.tasks[0].resources[0].kind,'equip');assert.equal(result.tasks[0].notes,'Protect occupied areas.');
  assert.equal(result.costs[1].amount,300);assert.equal(result.costs[2].amount,undefined);assert.equal(result.days,3);assert.deepEqual(source,before);
  source.sheets[0].rows=source.sheets[0].rows.filter(r=>r.id!=='excavator');assert.equal(deriveTimeline(source).tasks[0].resources[0].missing,true);
});
test('invalid resources and travel or hotel costs cannot reference other takeoffs or tasks',()=>{
  const source={...takeoff(),timeline:{tasks:[{id:'parent',startHour:0,durationHours:8,crew:2}]}};
  for(const resource of [{id:'elsewhere'},{id:'crew',quantity:-1},{id:'crew',notes:2},{id:'crew',invented:true}]){
    const copy=structuredClone(source);copy.timeline.tasks[0].resources=[resource];assert.throws(()=>validateTimeline(copy));
  }
  for(const cost of [{id:'c',day:0,kind:'hotel'},{id:'c',day:1.5,kind:'hotel'},{id:'c',day:1,kind:'unknown'},{id:'c',day:1,kind:'hotel',amount:-5},{id:'c',day:1,kind:'hotel',taskId:'elsewhere'},{id:'c',day:1,kind:'travel',sourceRowId:'elsewhere'},{id:'c',day:1,kind:'hotel',amount:Infinity}]){
    assert.throws(()=>validateTimeline({...source,timeline:{...source.timeline,costs:[cost]}}));
  }
  const copy=structuredClone(source);copy.timeline.tasks[0].resources=[{id:'crew'},{id:'crew'}];assert.throws(()=>validateTimeline(copy));
});
test('a cost-only plan displays its assigned days without inventing work',()=>{
  const result=deriveTimeline({...takeoff(),timeline:{costs:[{id:'hotel',day:4,kind:'hotel',amount:200}]}});
  assert.equal(result.hasPlan,true);assert.equal(result.days,4);assert.deepEqual(result.tasks,[]);
});
