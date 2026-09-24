import { createHash } from 'node:crypto';
import { validateBook } from './model.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const revision = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function findTakeoff(book, scope) {
  const list = book.lists?.find(v=>v.id===scope.list);
  const company = list?.companies?.find(v=>v.id===scope.company);
  const project = company?.projects?.find(v=>v.id===scope.project);
  return project?.takeoffs?.find(v=>v.id===scope.takeoff);
}
export function locateTakeoff(book, listId, takeoffId) {
  for (const list of book.lists || []) if (list.id===listId) for (const company of list.companies || []) for (const project of company.projects || []) {
    const takeoff=project.takeoffs?.find(v=>v.id===takeoffId);
    if(takeoff)return {list:list.id,company:company.id,project:project.id,takeoff:takeoff.id};
  }
  return null;
}
const idSchema={type:'string',minLength:1,maxLength:160};
const numeric={anyOf:[{type:'number'},{type:'string',pattern:'^$|^-?[0-9]+(\\.[0-9]+)?$'}]};
export const takeoffSchema={type:'object',required:['id','name','sheets'],properties:{
  id:idSchema,name:{type:'string'},note:{type:'string'},custom:{type:'object'},
  sheets:{type:'array',minItems:1,items:{type:'object',required:['id','rows'],properties:{id:idSchema,title:{type:'string'},flatAddEnabled:{type:'boolean'},rows:{type:'array',items:{type:'object',required:['id'],properties:{id:idSchema,type:{enum:['item','section','sectionEnd']},name:{type:'string'},kind:{type:'string'},count:numeric,time:numeric,days:numeric,cost:numeric,markup:numeric,flatAdd:numeric,note:{type:'string'},sid:idSchema}}}}}}
}};
export const changeSchema={type:'object',required:['revision','takeoff'],additionalProperties:false,properties:{revision:{type:'string',pattern:'^[a-f0-9]{64}$'},takeoff:takeoffSchema,requestId:{type:'string',minLength:1,maxLength:100}}};

export function validateTakeoff(next, before) {
  validateBook({sheets:[next]});
  const fail=message=>{throw Object.assign(new Error(message),{status:422});};
  if(!next || typeof next!=='object' || Array.isArray(next) || next.id!==before.id)fail('Keep the takeoff ID unchanged.');
  const editable=new Set(['name','note','custom','sheets']);
  for(const key of new Set([...Object.keys(before),...Object.keys(next)]))if(!editable.has(key)&&JSON.stringify(next[key])!==JSON.stringify(before[key]))fail('Takeoff field is read-only: '+key);
  if(typeof next.name!=='string'||next.name.length>500)fail('Takeoff name must be text, up to 500 characters.');
  if(!Array.isArray(next.sheets)||!next.sheets.length)fail('Keep at least one option page.');
  function visit(value,path='takeoff') {
    if(Array.isArray(value)) {
      const ids=new Set();
      for(const item of value){if(item && typeof item==='object' && !Array.isArray(item)){
        if(item.id!==undefined || /\.(sheets|rows|fees|units)$/.test(path)){
          if(typeof item.id!=='string'||!item.id||item.id.length>160)fail('Each record in '+path+' needs an ID.');
          if(ids.has(item.id))fail('Duplicate ID in '+path+': '+item.id);ids.add(item.id);
        }
      }visit(item,path+'[]');}
    }else if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){
      if(['cost','count','time','days','markup','flatAdd','pct','qty','amt'].includes(key) && !(item===''||typeof item==='number'&&Number.isFinite(item)||typeof item==='string'&&/^-?\d+(\.\d+)?$/.test(item)))fail('Invalid number: '+path+'.'+key);
      visit(item,path+'.'+key);
    }
  }
  visit(next);
  if(next.note!==undefined&&typeof next.note!=='string')fail('Takeoff note must be text.');
  if(next.custom!==undefined&&(!next.custom||typeof next.custom!=='object'||Array.isArray(next.custom)))fail('Takeoff custom fields must be an object.');
  const ids=new Set();
  for(const sheet of next.sheets){
    if(!sheet||typeof sheet!=='object'||Array.isArray(sheet))fail('Each option must be an object.');
    if(sheet.title!==undefined&&typeof sheet.title!=='string')fail('Option title must be text.');
    if(!Array.isArray(sheet.rows))fail('Each option needs a rows array.');
    if(sheet.flatAddEnabled!==undefined&&typeof sheet.flatAddEnabled!=='boolean')fail('flatAddEnabled must be true or false.');
    const stack=[];
    for(const row of sheet.rows){
      if(!row||typeof row!=='object'||Array.isArray(row))fail('Each row must be an object with an ID.');
      if(row.name!==undefined&&typeof row.name!=='string')fail('Row name must be text.');
      if(row.note!==undefined&&typeof row.note!=='string')fail('Row note must be text.');
      if(row.kind!==undefined&&!['none','labor','equip','material','part','service','construct','hybrid'].includes(row.kind))fail('Unsupported item kind.');
      if(ids.has(row.id))fail('Row IDs must be unique across option pages.');ids.add(row.id);
      if(row.type==='section')stack.push(row.id);
      else if(row.type==='sectionEnd'){if(stack.pop()!==row.sid)fail('Section ends must match nested section starts.');}
      else if(row.type && row.type!=='item')fail('Unsupported row type.');
    }
    if(stack.length)fail('Every section needs a matching sectionEnd.');
  }
  return next;
}
export function differences(before,after,path='',out=[]) {
  if(revision(before)===revision(after))return out;
  if(Array.isArray(before)&&Array.isArray(after)&&[...before,...after].every(item=>item&&typeof item==='object'&&typeof item.id==='string')){
    const old=new Map(before.map(item=>[item.id,item])),next=new Map(after.map(item=>[item.id,item]));
    for(const id of new Set([...old.keys(),...next.keys()]))differences(old.get(id)??null,next.get(id)??null,path+'/@'+id,out);
    differences(before.map(item=>item.id),after.map(item=>item.id),path+'/$order',out);
  }else if(before && after && typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])) differences(before[key]??null,after[key]??null,path+'/'+key,out);
  }else if(out.length<200)out.push({path, before:JSON.stringify(before).slice(0,400),after:JSON.stringify(after).slice(0,400)});
  return out;
}
