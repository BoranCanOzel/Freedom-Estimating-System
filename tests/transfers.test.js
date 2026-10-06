import test from 'node:test';
import assert from 'node:assert/strict';
import {transferChoices,exportTransfer,importTransfer,detectTransfer} from '../shared/transfers.js';
const takeoff={id:'t',name:'Estimate',sheets:[{id:'s',rows:[{id:'section',type:'section',name:'Labor'},{id:'r',kind:'labor',cost:'75',count:2,time:8,days:1},{id:'end',type:'sectionEnd',sid:'section'}]}]};
const project={id:'p',name:'Vons',takeoffs:[takeoff]};
const customer={id:'c',name:'Centennial',projects:[project]};
const book={lists:[{id:'l',name:'Projects',companies:[customer]}]};
test('detects workbook, customer, project and legacy estimate imports',()=>{
 for(const [raw,kind]of [[book,'workbook'],[customer,'customer'],[project,'project'],[takeoff,'takeoff'],[{sheets:takeoff.sheets},'takeoff'],[exportTransfer(book,'project',project),'project']])assert.equal(detectTransfer(raw),kind);
 assert.throws(()=>detectTransfer({bad:true}));
});
test('extract customer, project and takeoff from legacy workspace without duplicating aliases',()=>{
 const legacy={...book,companies:[customer],sheets:takeoff.sheets};
 for(const kind of ['customer','project','takeoff'])assert.equal(transferChoices(legacy,kind).length,1);
 assert.equal(transferChoices(legacy,'project')[0].data.name,'Vons');
 assert.equal(transferChoices({_app:'project-breakdown',sheets:takeoff.sheets},'takeoff','Old estimate')[0].data.name,'Old estimate');
});
test('scoped round trips append copies with fresh IDs and matching section references',()=>{
 for(const [kind,record,target]of [['customer',customer,'l'],['project',project,'c'],['takeoff',takeoff,'p']]){
  const snapshot=JSON.stringify(book),exported=exportTransfer(book,kind,record);
  const parsed=transferChoices(exported,kind)[0].data;
  const next=importTransfer(book,kind,parsed,target,exported.dependencies);
  assert.equal(JSON.stringify(book),snapshot);
  const parent=kind==='customer'?next.lists[0]:kind==='project'?next.lists[0].companies[0]:next.lists[0].companies[0].projects[0];
  const added=parent[kind==='customer'?'companies':kind==='project'?'projects':'takeoffs'].at(-1);
  assert.notEqual(added.id,record.id);
  const t=kind==='customer'?added.projects[0].takeoffs[0]:kind==='project'?added.takeoffs[0]:added;
  assert.equal(t.sheets[0].rows[1].cost,'75');
  assert.equal(t.sheets[0].rows[2].sid,t.sheets[0].rows[0].id);
 }
});
test('reject unsafe files and missing destinations without modifying workbook',()=>{
 assert.throws(()=>transferChoices(JSON.parse('{"projects":[],"__proto__":{}}'),'customer'),/invalid property/);
 assert.throws(()=>transferChoices({hello:true},'takeoff'),/No customers/);
 assert.throws(()=>importTransfer(book,'takeoff',takeoff,'missing'),/destination/);
});

test('scoped transfers carry dropdown definitions without replacing destination fields',()=>{
 const source={...book,customFields:{company:['Account'],project:['Region'],takeoff:['Estimator']},
  customFieldSettings:{company:{Account:{type:'dropdown',options:['Commercial','Residential']}},
   project:{Region:{type:'dropdown',options:['North','South']}},takeoff:{Estimator:{type:'dropdown',options:['Alex','Sam']}}}};
 const exported=exportTransfer(source,'project',{...project,custom:{Region:'North'}});
 const next=importTransfer(book,'project',exported.data,'c',exported.dependencies);
 assert.deepEqual(next.customFieldSettings,source.customFieldSettings);
 assert.equal(next.lists[0].companies[0].projects.at(-1).custom.Region,'North');
 const destination={...book,customFields:{project:['Region'],takeoff:['Estimator']},customFieldSettings:{project:{Region:{type:'dropdown',options:['West']}}}};
 const merged=importTransfer(destination,'project',exported.data,'c',exported.dependencies);
 assert.deepEqual(merged.customFieldSettings.project.Region.options,['West']);
 assert.equal(merged.customFieldSettings.takeoff,undefined); // Existing legacy text field stays a text field.
 assert.deepEqual(merged.customFieldSettings.company,source.customFieldSettings.company);
});

test('copied takeoffs keep Scope assignments linked to their copied pages',()=>{
 const source={...takeoff,scopeData:{source:'zz',items:[{id:'measured',name:'Cutting'}]},scopeAssignments:{measured:'s'}};
 const next=importTransfer(book,'takeoff',source,'p');
 const copy=next.lists[0].companies[0].projects[0].takeoffs.at(-1);
 assert.equal(copy.scopeAssignments[copy.scopeData.items[0].id],copy.sheets[0].id);
 assert.notEqual(copy.sheets[0].id,'s');
 assert.equal(copy.scopeData.items[0].id,'measured');
});

test('copied takeoffs keep timeline tasks, resources and costs linked to copied source rows',()=>{
 const source=structuredClone(takeoff);
 source.timeline={hoursPerDay:8,tasks:[{id:source.sheets[0].rows[0].id,startHour:8,crew:2,resources:[{id:source.sheets[0].rows[1].id,quantity:2}]}],costs:[{id:'hotel-cost',day:1,kind:'hotel',amount:200,taskId:source.sheets[0].rows[0].id,sourceRowId:source.sheets[0].rows[1].id}]};
 const snapshot=JSON.stringify(source);
 const next=importTransfer(book,'takeoff',source,'p');
 const copy=next.lists[0].companies[0].projects[0].takeoffs.at(-1);
 assert.notEqual(copy.timeline.tasks[0].id,source.timeline.tasks[0].id);
 assert.equal(copy.timeline.tasks[0].id,copy.sheets[0].rows[0].id);
 assert.equal(copy.timeline.tasks[0].crew,2);
 assert.equal(copy.timeline.tasks[0].resources[0].id,copy.sheets[0].rows[1].id);
 assert.equal(copy.timeline.costs[0].taskId,copy.timeline.tasks[0].id);
 assert.equal(copy.timeline.costs[0].sourceRowId,copy.sheets[0].rows[1].id);
 assert.notEqual(copy.timeline.costs[0].id,source.timeline.costs[0].id);
 assert.equal(copy.timeline.costs[0].amount,200);
 assert.equal(JSON.stringify(source),snapshot);
});
