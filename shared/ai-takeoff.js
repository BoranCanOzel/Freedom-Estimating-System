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
export function aiVisibleTakeoff(takeoff){
  const visible=structuredClone(takeoff);
  if(takeoff.scopeAiAccess===false){delete visible.scopeData;delete visible.scopeLink;delete visible.scopeAssignments;}
  else if(Array.isArray(visible.scopeData?.items))visible.scopeData.items=visible.scopeData.items.filter(item=>!item.missing&&item.showAi!==false);
  if(visible.scopeAssignments){
    const ids=new Set((visible.scopeData?.items||[]).map(item=>item.id));
    visible.scopeAssignments=Object.fromEntries(Object.entries(visible.scopeAssignments).filter(([id])=>ids.has(id)));
  }
  return visible;
}
export const pageColors=['slate','teal','moss','amber','rust','plum','red','gray'];
const idSchema={type:'string',minLength:1,maxLength:160};
const numeric={anyOf:[{type:'number'},{type:'string',pattern:'^$|^-?[0-9]+(\\.[0-9]+)?$'}]};
export const takeoffSchema={type:'object',required:['id','name','sheets'],properties:{
  id:idSchema,name:{type:'string'},note:{type:'string'},custom:{type:'object'},
  aiDataWorkTypes:{type:'array',items:{type:'string',enum:['concrete-pour','demo','saw-cutting']},uniqueItems:true,readOnly:true,description:'User-selected work labels. May include any combination of concrete-pour, demo, and saw-cutting. Missing or empty means not specified, not that these activities are absent.'},
  aiDataMethod:{type:'string',enum:['','unit-price','hourly','mixed'],readOnly:true,description:'Reference pricing method: unit-price = SF/LF/EA pricing; hourly = hourly or crew breakdown; mixed = both. Missing or empty means not specified. Section organization does not determine this method.'},
  aiData:{type:'boolean',readOnly:true,description:'Whether this estimate is selected as reference data for AI models. Missing means false.'},
  aiDataPrevailingWage:{type:'boolean',readOnly:true,description:'User-selected Prevailing wage label for this reference estimate. True means labeled; false or missing means not labeled, not a determination of wage requirements. Preserve unchanged.'},
  aiDataNightWork:{type:'boolean',readOnly:true,description:'User-selected Night time work label for this reference estimate. True means labeled; false or missing means not labeled. Preserve unchanged.'},
  scopeAiAccess:{type:'boolean',readOnly:true,description:'User-controlled Scope sharing. Missing means true; AI cannot change it.'},
  scopeAssignments:{type:'object',additionalProperties:idSchema,description:'Map visible imported Scope item IDs to estimating sheet IDs. Assign an item to one estimating page; it inherits that page color. Omit an entry to unassign it. Hidden Scope items cannot be changed.'},
  scopeLink:{type:'string',readOnly:true,description:'Saved ZZTakeoff link. Preserve unchanged.'},
  scopeData:{type:['object','null'],readOnly:true,description:'Last fetched measured Scope and review decisions. Preserve unchanged.',properties:{source:{type:'string'},fetchedAt:{type:'string'},items:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'},group:{type:'string'},pages:{type:'array',items:{type:'object',properties:{id:{type:'string'},name:{type:'string'}}}},measurements:{type:'string'},note:{type:'string',maxLength:10000,readOnly:true,description:'User note for this Scope item.'},status:{enum:['included','excluded','ignored','duplicate']},missing:{type:'boolean'},showAi:{type:'boolean',readOnly:true,description:'User-controlled visibility. Missing means true.'}}}}}},
  sheets:{type:'array',minItems:1,items:{type:'object',required:['id','rows'],properties:{id:idSchema,title:{type:'string'},color:{type:'string',enum:['',...pageColors],description:'Page and assigned Scope item color. Choose a palette key; omit or use empty text for no color.'},flatAddEnabled:{type:'boolean'},rows:{type:'array',items:{type:'object',required:['id'],properties:{id:idSchema,type:{enum:['item','section','sectionEnd']},name:{type:'string'},kind:{type:'string'},count:numeric,time:numeric,days:numeric,cost:numeric,markup:numeric,flatAdd:numeric,note:{type:'string'},sid:idSchema}}}}}}
}};
export const changeSchema={type:'object',required:['revision','takeoff'],additionalProperties:false,properties:{revision:{type:'string',pattern:'^[a-f0-9]{64}$'},takeoff:takeoffSchema,requestId:{type:'string',minLength:1,maxLength:100}}};

export function validateTakeoff(next, before) {
  validateBook({sheets:[next]});
  const fail=message=>{throw Object.assign(new Error(message),{status:422});};
  if(!next || typeof next!=='object' || Array.isArray(next) || next.id!==before.id)fail('Keep the takeoff ID unchanged.');
  const editable=new Set(['name','note','custom','sheets','scopeAssignments']);
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
  if(next.scopeAssignments!==undefined){
    if(!next.scopeAssignments||typeof next.scopeAssignments!=='object'||Array.isArray(next.scopeAssignments))fail('scopeAssignments must map Scope item IDs to page IDs.');
    const visibleIds=new Set((before.scopeAiAccess===false?[]:before.scopeData?.items||[]).filter(item=>!item.missing&&item.showAi!==false).map(item=>item.id));
    const sheetIds=new Set(next.sheets.map(sheet=>sheet?.id));
    for(const [itemId,pageId] of Object.entries(next.scopeAssignments)){
      if(!visibleIds.has(itemId))fail('Only visible Scope items can be assigned.');
      if(typeof pageId!=='string'||!sheetIds.has(pageId))fail('Scope assignment must reference an existing estimating page.');
    }
  }
  const ids=new Set();
  for(const sheet of next.sheets){
    if(!sheet||typeof sheet!=='object'||Array.isArray(sheet))fail('Each option must be an object.');
    if(sheet.color!==undefined&&sheet.color!==''&&!pageColors.includes(sheet.color))fail('Unsupported page color.');
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
