const positive = value => (typeof value === 'number' || typeof value === 'string') && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
const costHeading = name => /^(?:\d+[.)\s-]*)?(?:labor|labour|crew|equipment|materials?|parts?|services?|construction|costs?|breakdown)$/i.test(String(name||'').trim());
function workName(source,stack,sheet){
  const own=String(source.name||'').trim();
  if(own&&!costHeading(own))return own;
  const parent=[...stack].reverse().find(row=>row.id!==source.id&&String(row.name||'').trim()&&!costHeading(row.name));
  return parent?.name||sheet.title||own||'Unnamed work';
}
export const timelineSchema = {
  type:'object', additionalProperties:false, description:'Planning settings only; never changes estimating quantities or prices. Read read_timeline for generated task IDs and assumptions.',
  properties:{
    hoursPerDay:{type:'number',minimum:1,maximum:24,default:8},
    startDate:{type:'string',pattern:'^$|^\\d{4}-\\d{2}-\\d{2}$',description:'Optional first work date; blank shows Day 1, Day 2, etc.'},
    skipWeekends:{type:'boolean',default:true},
    mode:{type:'string',enum:['sequential','parallel-pages'],default:'sequential',description:'Sequence tasks in estimate order, or start each page at hour zero with its own crew.'},
    tasks:{type:'array',items:{type:'object',required:['id'],additionalProperties:false,properties:{
      id:{type:'string',minLength:1,maxLength:160,description:'Source section or unsectioned item ID from read_timeline. Reuse it; do not invent a task ID.'},
      startHour:{type:'number',minimum:0,maximum:100000,description:'Working hours from the start. 8 means Day 2 at an 8-hour workday. Omit to sequence automatically.'},
      durationHours:{type:'number',exclusiveMinimum:0,maximum:100000,description:'Elapsed working hours for this task, not person-hours. Omit to derive from labor.'},
      crew:{type:'number',exclusiveMinimum:0,maximum:10000,description:'Planned people. With no duration override, divides estimated labor-hours to derive duration.'},
      excluded:{type:'boolean',description:'Exclude from the schedule, retaining the estimate.'}
    }}}
  }
};

export function timelineSources(takeoff){
  const tasks=[];
  for(const sheet of takeoff.sheets || []){
    const stack=[],groups=new Map();
    for(const row of sheet.rows || []){
      if(row.type==='section'){stack.push(row);continue;}
      if(row.type==='sectionEnd'){stack.pop();continue;}
      if(row.kind==='none'||(!String(row.name||'').trim()&&!positive(row.cost)))continue;
      const source=stack.at(-1)||row;
      if(!groups.has(source.id)){
        const scope=stack[0];
        const task={id:source.id,sheetId:sheet.id,scopeId:scope?.id||sheet.id,scopeName:scope?.name||sheet.title||'Untitled scope',section:!!stack.length,name:workName(source,stack,sheet),sourceName:source.name||'Unnamed work',path:stack.map(s=>s.name||'Unnamed section').join(' / '),page:sheet.title||'Untitled page',color:sheet.color||'',laborHours:0,baseDuration:0,baseCrew:0,sourceRowIds:[],issues:[]};
        groups.set(source.id,task);tasks.push(task);
      }
      const task=groups.get(source.id);task.sourceRowIds.push(row.id);
      if(row.kind==='labor'){
        const people=positive(row.count),hours=positive(row.time),days=positive(row.days);
        if(people&&hours&&days&&Number.isFinite(task.laborHours+people*hours*days)&&Number.isFinite(task.baseCrew+people)){task.laborHours+=people*hours*days;task.baseDuration=Math.max(task.baseDuration,hours*days);task.baseCrew+=people;}
        else task.issues.push('Missing people, hours, or days: '+(row.name||'labor row'));
      }else if(['service','construct','hybrid'].includes(row.kind))task.issues.push('Assembly labor needs a manual duration: '+(row.name||row.kind));
    }
  }
  return tasks;
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
  for(const task of value.tasks||[]){
    if(!task||typeof task!=='object'||Array.isArray(task)||typeof task.id!=='string'||!sources.has(task.id)||ids.has(task.id))fail('Timeline task IDs must uniquely reference a section or item in this takeoff.');
    ids.add(task.id);
    if(Object.keys(task).some(key=>!Object.hasOwn(timelineSchema.properties.tasks.items.properties,key)))fail('Unknown timeline task field.');
    for(const [key,max,zero] of [['startHour',100000,true],['durationHours',100000,false],['crew',10000,false]])if(task[key]!==undefined&&!(typeof task[key]==='number'&&Number.isFinite(task[key])&&task[key]<=max&&(zero?task[key]>=0:task[key]>0)))fail('Invalid timeline '+key+'.');
    if(task.excluded!==undefined&&typeof task.excluded!=='boolean')fail('Timeline excluded must be true or false.');
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

export function deriveTimeline(takeoff){
  const settings={hoursPerDay:8,startDate:'',skipWeekends:true,mode:'sequential',...takeoff.timeline};
  const dayHours=positive(settings.hoursPerDay)||8,overrides=new Map((settings.tasks||[]).map(t=>[t.id,t]));
  let cursor=0,blocked=false;
  const pageCursors=new Map(),blockedPages=new Set();
  const tasks=timelineSources(takeoff).map(source=>{
    const override=overrides.get(source.id)||{},parallel=settings.mode==='parallel-pages';
    const inferred=positive(positive(override.crew)?source.laborHours/override.crew:source.baseDuration);
    const durationHours=positive(override.durationHours)||(source.issues.length?0:inferred);
    const missing=durationHours<=0,priorBlocked=parallel?blockedPages.has(source.sheetId):blocked;
    const explicitStart=typeof override.startHour==='number'&&Number.isFinite(override.startHour)&&override.startHour>=0;
    const startHour=explicitStart?override.startHour:(parallel?pageCursors.get(source.sheetId)||0:cursor);
    const excluded=override.excluded===true;
    const scheduled=!excluded&&!missing&&(!priorBlocked||explicitStart);
    const endHour=startHour+durationHours;
    if(!excluded){
      if(missing){if(parallel)blockedPages.add(source.sheetId);else blocked=true;}
      else if(scheduled){if(parallel){pageCursors.set(source.sheetId,Math.max(pageCursors.get(source.sheetId)||0,endHour));if(explicitStart)blockedPages.delete(source.sheetId);}else{cursor=Math.max(cursor,endHour);if(explicitStart)blocked=false;}}
    }
    return {...source,override,crew:positive(override.crew)||source.baseCrew,durationHours,startHour:scheduled?startHour:null,endHour:scheduled?endHour:null,scheduled,excluded,
      status:excluded?'Excluded':missing?'Needs duration':!scheduled?'Waiting for prior duration':Object.keys(override).some(k=>k!=='id')?'Adjusted':'Automatic'};
  });
  const scheduled=tasks.filter(t=>t.scheduled),endHour=scheduled.reduce((max,t)=>Math.max(max,t.endHour),0);
  const days=Math.ceil(endHour/dayHours);
  return {settings:{hoursPerDay:dayHours,startDate:settings.startDate,skipWeekends:settings.skipWeekends,mode:settings.mode},tasks,
    laborHours:tasks.filter(t=>!t.excluded).reduce((sum,t)=>sum+t.laborHours,0),endHour,days,peakCrew:timelinePeakCrew(tasks),
    finishDate:days?workDate(settings.startDate,days-1,settings.skipWeekends):'',unscheduled:tasks.filter(t=>!t.excluded&&!t.scheduled).length,
    guidance:'Planning draft: direct labor Count means people, Time means hours per day, Days means working days. Labor within one section overlaps; sections sequence in estimate order unless page crews run in parallel. Non-labor-only tasks and incomplete labor need a manual duration. Subsections own their direct rows; parent rollups are not counted again. Review quantity-priced labor, shared crews, dependencies, curing and mobilization. Overrides never change estimating prices or quantities.'};
}
