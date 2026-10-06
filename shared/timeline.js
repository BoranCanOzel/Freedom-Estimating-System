const positive = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const costHeading = name => /^(?:\d+[.)\s-]*)?(?:labor|labour|crew|equipment|materials?|parts?|services?|construction|costs?|breakdown)$/i.test(String(name||'').trim());
function workName(source,stack,sheet){
  const own=String(source.name||'').trim();
  if(own&&!costHeading(own))return own;
  const parent=[...stack].reverse().find(row=>row.id!==source.id&&String(row.name||'').trim()&&!costHeading(row.name));
  return parent?.name||sheet.title||own||'Unnamed work';
}
export const timelineSchema = {
  type:'object', additionalProperties:false, description:'Explicit AI-authored plan, separate from estimating prices. No schedule is generated automatically. Read read_timeline.availableWork for source IDs and estimate facts.',
  properties:{
    hoursPerDay:{type:'number',minimum:1,maximum:24,default:8},
    startDate:{type:'string',pattern:'^$|^\\d{4}-\\d{2}-\\d{2}$',description:'Optional first work date; blank shows Day 1, Day 2, etc.'},
    skipWeekends:{type:'boolean',default:true},
    costs:{type:'array',maxItems:5000,description:'Explicit daily planning allowances, separate from estimate pricing. One entry per workday; never multiplied or spread automatically.',items:{type:'object',required:['id','day','kind'],additionalProperties:false,properties:{
      id:{type:'string',minLength:1,maxLength:160},day:{type:'integer',minimum:1,maximum:100000},
      kind:{type:'string',enum:['travel','hotel','meals','other']},label:{type:'string',maxLength:200},
      amount:{type:'number',minimum:0,maximum:1000000000,description:'Total USD allowance for this entry on this day. Omit if unknown; do not invent prices.'},
      notes:{type:'string',maxLength:4000},taskId:{type:'string',description:'Optional saved timeline task ID; omit for a shared project cost.'},
      sourceRowId:{type:'string',description:'Optional estimating resource row ID backing this allowance. It is a reference, not a new estimate charge.'}
    }}},
    mode:{type:'string',enum:['sequential','parallel-pages'],deprecated:true,description:'Legacy setting preserved for compatibility; ignored. Every planned task needs explicit timing.'},
    tasks:{type:'array',items:{type:'object',required:['id'],additionalProperties:false,properties:{
      id:{type:'string',minLength:1,maxLength:160,description:'Source section or unsectioned item ID from read_timeline. Reuse it; do not invent a task ID.'},
      startHour:{type:'number',minimum:0,maximum:100000,description:'Explicit working hours from the start. 8 means Day 2 at an 8-hour workday. Required to schedule; never inferred.'},
      durationHours:{type:'number',exclusiveMinimum:0,maximum:100000,description:'Explicit elapsed working hours, not person-hours. Required to schedule; never inferred.'},
      crew:{type:'number',exclusiveMinimum:0,maximum:10000,description:'Explicit planned people. Required to schedule. Editing this does not change duration.'},
      notes:{type:'string',maxLength:4000,description:'AI-authored work method, sequencing, access requirements or other task-specific planning details.'},
      resources:{type:'array',maxItems:200,description:'AI assignments from read_timeline.availableResources. Reading estimate resources never assigns them.',items:{type:'object',required:['id'],additionalProperties:false,properties:{
        id:{type:'string',description:'Existing resource row ID from this takeoff, not a new UUID.'},quantity:{type:'number',exclusiveMinimum:0,maximum:10000,description:'Explicit assigned quantity, e.g. 1 excavator.'},notes:{type:'string',maxLength:2000,description:'How or when this resource is used for the task.'}
      }}},
      excluded:{type:'boolean',description:'Exclude from the schedule, retaining the estimate.'}
    }}}
  }
};

export function timelineSources(takeoff){
  const tasks=[];
  for(const sheet of takeoff.sheets || []){
    const stack=[],groups=new Map();
    function sourceTask(source){
      if(!groups.has(source.id)){
        const scope=stack[0];
        const task={id:source.id,sheetId:sheet.id,scopeId:scope?.id||sheet.id,scopeName:scope?.name||sheet.title||'Untitled scope',section:source.type==='section',name:workName(source,stack,sheet),sourceName:source.name||'Unnamed work',path:stack.map(s=>s.name||'Unnamed section').join(' / '),page:sheet.title||'Untitled page',color:sheet.color||'',laborHours:0,baseDuration:0,baseCrew:0,sourceRowIds:[],issues:[]};
        groups.set(source.id,task);tasks.push(task);
      }
      return groups.get(source.id);
    }
    for(const row of sheet.rows || []){
      if(row.type==='section'){stack.push(row);sourceTask(row);continue;}
      if(row.type==='sectionEnd'){stack.pop();continue;}
      if(row.kind==='none'||(!String(row.name||'').trim()&&!positive(row.cost)))continue;
      const task=sourceTask(stack.at(-1)||row);task.sourceRowIds.push(row.id);
      if(row.kind==='labor'){
        const people=positive(row.count),hours=positive(row.time),days=positive(row.days);
        if(people&&hours&&days&&Number.isFinite(task.laborHours+people*hours*days)&&Number.isFinite(task.baseCrew+people)){task.laborHours+=people*hours*days;task.baseDuration=Math.max(task.baseDuration,hours*days);task.baseCrew+=people;}
        else task.issues.push('Missing people, hours, or days: '+(row.name||'labor row'));
      }else if(['service','construct','hybrid'].includes(row.kind))task.issues.push('Assembly labor needs a manual duration: '+(row.name||row.kind));
    }
  }
  return tasks;
}

export function timelineResources(takeoff){
  const resources=[];
  for(const sheet of takeoff.sheets||[]){
    const stack=[];
    const add=(row,path,fallback='part')=>{
      if(row.id&&row.kind!=='none'&&String(row.name||'').trim())resources.push({id:row.id,sheetId:sheet.id,page:sheet.title||'Untitled page',name:row.name,kind:row.kind||fallback,path:path.join(' / '),note:row.note||'',estimateQuantity:row.count??'',estimateRate:row.cost??''});
      for(const key of ['parts','services'])for(const child of Array.isArray(row[key])?row[key]:[])add(child,[...path,row.name||'Item'],key==='services'?'service':'part');
    };
    for(const row of sheet.rows||[]){
      if(row.type==='section'){stack.push(row.name||'Unnamed section');continue;}
      if(row.type==='sectionEnd'){stack.pop();continue;}
      add(row,stack);
    }
  }
  return resources;
}

export function validateTimeline(takeoff){
  if(takeoff.timeline===undefined)return;
  const fail=message=>{throw Object.assign(new Error(message),{status:422});};
  const value=takeoff.timeline;
  if(!value||typeof value!=='object'||Array.isArray(value))fail('Timeline must be an object.');
  if(Object.keys(value).some(key=>!Object.hasOwn(timelineSchema.properties,key)))fail('Unknown timeline setting.');
  if(value.hoursPerDay!==undefined&&!(typeof value.hoursPerDay==='number'&&Number.isFinite(value.hoursPerDay)&&value.hoursPerDay>=1&&value.hoursPerDay<=24))fail('Timeline workday must be 1 to 24 hours.');
  if(value.mode!==undefined&&!['sequential','parallel-pages'].includes(value.mode))fail('Choose a supported timeline mode.');
  if(value.skipWeekends!==undefined&&typeof value.skipWeekends!=='boolean')fail('skipWeekends must be true or false.');
  if(value.startDate!==undefined&&(typeof value.startDate!=='string'||value.startDate&&!validDate(value.startDate)))fail('Timeline start date must be YYYY-MM-DD or blank.');
  if(value.tasks!==undefined&&!Array.isArray(value.tasks))fail('Timeline tasks must be an array.');
  const ids=new Set(),sources=new Set((takeoff.sheets||[]).flatMap(sh=>(sh.rows||[]).filter(row=>row.type!=='sectionEnd').map(row=>row.id)));
  const resourceIds=new Set(timelineResources(takeoff).map(row=>row.id));
  const checkText=(record,key,max)=>{if(record[key]!==undefined&&(typeof record[key]!=='string'||record[key].length>max))fail('Invalid timeline '+key+'.');};
  for(const task of value.tasks||[]){
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.id!=='string'||!sources.has(task.id)||ids.has(task.id))fail('Timeline task IDs must uniquely reference a section or item in this takeoff.');
    ids.add(task.id);
    if(Object.keys(task).some(key=>!Object.hasOwn(timelineSchema.properties.tasks.items.properties,key)))fail('Unknown timeline task field.');
    for(const [key,max,zero] of [['startHour',100000,true],['durationHours',100000,false],['crew',10000,false]])if(task[key]!==undefined&&!(typeof task[key]==='number'&&Number.isFinite(task[key])&&task[key]<=max&&(zero?task[key]>=0:task[key]>0)))fail('Invalid timeline '+key+'.');
    if(task.excluded!==undefined&&typeof task.excluded!=='boolean')fail('Timeline excluded must be true or false.');
    checkText(task,'notes',4000);
    if(task.resources!==undefined&&(!Array.isArray(task.resources)||task.resources.length>200))fail('Timeline resources must be an array of up to 200 assignments.');
    const assigned=new Set();
    for(const resource of task.resources||[]){
      if(!resource||typeof resource!=='object'||Array.isArray(resource)||!resourceIds.has(resource.id)||assigned.has(resource.id))fail('Timeline resources must uniquely reference existing resource rows in this takeoff.');
      assigned.add(resource.id);
      if(Object.keys(resource).some(key=>!['id','quantity','notes'].includes(key)))fail('Unknown timeline resource field.');
      if(resource.quantity!==undefined&&!(typeof resource.quantity==='number'&&Number.isFinite(resource.quantity)&&resource.quantity>0&&resource.quantity<=10000))fail('Invalid timeline resource quantity.');
      checkText(resource,'notes',2000);
    }
  }
  if(value.costs!==undefined&&(!Array.isArray(value.costs)||value.costs.length>5000))fail('Timeline costs must be an array of up to 5000 daily entries.');
  const costIds=new Set();
  for(const cost of value.costs||[]){
    if(!cost||typeof cost!=='object'||Array.isArray(cost)||typeof cost.id!=='string'||!cost.id||cost.id.length>160||costIds.has(cost.id))fail('Timeline cost entries need unique IDs.');
    costIds.add(cost.id);
    if(Object.keys(cost).some(key=>!Object.hasOwn(timelineSchema.properties.costs.items.properties,key)))fail('Unknown timeline cost field.');
    if(!Number.isInteger(cost.day)||cost.day<1||cost.day>100000)fail('Timeline cost day must be a positive workday number.');
    if(!['travel','hotel','meals','other'].includes(cost.kind))fail('Unsupported timeline cost kind.');
    if(cost.amount!==undefined&&!(typeof cost.amount==='number'&&Number.isFinite(cost.amount)&&cost.amount>=0&&cost.amount<=1000000000))fail('Invalid timeline cost amount.');
    if(cost.taskId!==undefined&&!ids.has(cost.taskId))fail('Timeline cost taskId must reference a saved task.');
    if(cost.sourceRowId!==undefined&&!resourceIds.has(cost.sourceRowId))fail('Timeline cost sourceRowId must reference an existing resource row.');
    checkText(cost,'label',200);checkText(cost,'notes',4000);
  }
}

function validDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function workDate(startDate,day,skipWeekends=true){
  if(!validDate(startDate)||!Number.isInteger(day)||day<0||day>100000)return '';
  const date=new Date(startDate+'T12:00:00Z');
  if(skipWeekends)while([0,6].includes(date.getUTCDay()))date.setUTCDate(date.getUTCDate()+1);
  if(skipWeekends){date.setUTCDate(date.getUTCDate()+Math.floor(day/5)*7);day%=5;}
  while(day>0){date.setUTCDate(date.getUTCDate()+1);if(!skipWeekends||![0,6].includes(date.getUTCDay()))day--;}
  return date.toISOString().slice(0,10);
}

export function timelinePeakCrew(tasks,start=0,end=Infinity){
  const events=new Map();
  for(const task of tasks){
    if(!task.scheduled||task.endHour<=start||task.startHour>=end)continue;
    const from=Math.max(start,task.startHour),to=Math.min(end,task.endHour);
    events.set(from,(events.get(from)||0)+task.crew);events.set(to,(events.get(to)||0)-task.crew);
  }
  let current=0,peak=0;
  for(const [,change] of [...events].sort((a,b)=>a[0]-b[0])){current+=change;peak=Math.max(peak,current);}
  return peak;
}

export function timelineResourceUsage(tasks,hoursPerDay=8){
  const groups=new Map();
  for(const task of tasks){
    if(task.excluded)continue;
    for(const resource of task.resources||[]){
      if(resource.missing)continue;
      if(!groups.has(resource.id))groups.set(resource.id,{id:resource.id,name:resource.name,kind:resource.kind,page:resource.page,path:resource.path,assignments:[]});
      groups.get(resource.id).assignments.push({taskId:task.id,scheduled:task.scheduled,startHour:task.startHour,endHour:task.endHour,quantity:resource.quantity});
    }
  }
  return [...groups.values()].map(resource=>{
    const scheduled=resource.assignments.filter(a=>a.scheduled).sort((a,b)=>a.startHour-b.startHour);
    let plannedHours=0,end=-Infinity;
    for(const item of scheduled){plannedHours+=Math.max(0,item.endHour-Math.max(end,item.startHour));end=Math.max(end,item.endHour);}
    const quantityIncomplete=scheduled.some(a=>a.quantity===undefined);
    return {...resource,plannedHours,workdays:plannedHours/hoursPerDay,scheduledTasks:scheduled.length,pendingTasks:resource.assignments.length-scheduled.length,
      peakQuantity:scheduled.length&&!quantityIncomplete?timelinePeakCrew(scheduled.map(a=>({...a,crew:a.quantity}))):null};
  }).sort((a,b)=>(a.kind==='equip'?0:1)-(b.kind==='equip'?0:1)||a.name.localeCompare(b.name)||a.page.localeCompare(b.page));
}

export function deriveTimeline(takeoff){
  const settings={hoursPerDay:8,startDate:'',skipWeekends:true,...takeoff.timeline};
  const dayHours=positive(settings.hoursPerDay)||8,availableWork=timelineSources(takeoff),availableResources=timelineResources(takeoff);
  const resourceMap=new Map(availableResources.map(row=>[row.id,row]));
  const sources=new Map(availableWork.map(task=>[task.id,task]));
  const saved=Array.isArray(settings.tasks)?settings.tasks:[];
  const tasks=saved.map(override=>{
    const source=sources.get(override.id),excluded=override.excluded===true;
    const startHour=typeof override.startHour==='number'&&Number.isFinite(override.startHour)&&override.startHour>=0?override.startHour:null;
    const durationHours=positive(override.durationHours),crew=positive(override.crew);
    const missing=[];
    if(startHour===null)missing.push('start');if(!durationHours)missing.push('duration');if(!crew)missing.push('crew');
    const scheduled=!!source&&!excluded&&!missing.length;
    const resources=(override.resources||[]).map(assignment=>({...resourceMap.get(assignment.id),...assignment,missing:!resourceMap.has(assignment.id),name:resourceMap.get(assignment.id)?.name||'Resource no longer available'}));
    return {...(source||{id:override.id,name:'Source work no longer available',page:'',path:'',issues:[],laborHours:0}),override,crew,durationHours,notes:override.notes||'',resources,
      startHour:scheduled?startHour:null,endHour:scheduled?startHour+durationHours:null,scheduled,excluded,
      status:excluded?'Excluded':!source?'Source needs review':missing.length?'Needs '+missing.join(', '):'Planned'};
  });
  const costs=(Array.isArray(settings.costs)?settings.costs:[]).map(cost=>({...cost,source:resourceMap.get(cost.sourceRowId)||null}));
  const endHour=Math.max(tasks.filter(t=>t.scheduled).reduce((max,t)=>Math.max(max,t.endHour),0),costs.reduce((max,cost)=>Math.max(max,cost.day*dayHours),0)),days=Math.ceil(endHour/dayHours);
  return {settings:{hoursPerDay:dayHours,startDate:settings.startDate,skipWeekends:settings.skipWeekends},tasks,availableWork,availableResources,resourceUsage:timelineResourceUsage(tasks,dayHours),costs,hasPlan:saved.length>0||costs.length>0,
    laborHours:availableWork.reduce((sum,t)=>sum+t.laborHours,0),endHour,days,peakCrew:timelinePeakCrew(tasks),
    finishDate:days?workDate(settings.startDate,days-1,settings.skipWeekends):'',unscheduled:tasks.filter(t=>!t.excluded&&!t.scheduled).length,
    guidance:'AI creates the plan. Only saved tasks with explicit start hours, duration hours, and crew are scheduled. Estimate facts in availableWork are reference only: Count x Time x Days represents direct labor person-hours when those fields mean people, hours per day, and days. AI must review dependencies, shared crews, quantity pricing, mobilization and cure times. Opening the timeline or changing the estimate never creates, adds, sequences or retimes tasks. Plan edits never change estimate prices or quantities.'};
}
