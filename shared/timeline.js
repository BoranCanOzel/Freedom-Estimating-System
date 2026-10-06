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
    mode:{type:'string',enum:['sequential','parallel-pages'],deprecated:true,description:'Legacy setting preserved for compatibility; ignored. Every planned task needs explicit timing.'},
    tasks:{type:'array',items:{type:'object',required:['id'],additionalProperties:false,properties:{
      id:{type:'string',minLength:1,maxLength:160,description:'Source section or unsectioned item ID from read_timeline. Reuse it; do not invent a task ID.'},
      startHour:{type:'number',minimum:0,maximum:100000,description:'Explicit working hours from the start. 8 means Day 2 at an 8-hour workday. Required to schedule; never inferred.'},
      durationHours:{type:'number',exclusiveMinimum:0,maximum:100000,description:'Explicit elapsed working hours, not person-hours. Required to schedule; never inferred.'},
      crew:{type:'number',exclusiveMinimum:0,maximum:10000,description:'Explicit planned people. Required to schedule. Editing this does not change duration.'},
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
  const settings={hoursPerDay:8,startDate:'',skipWeekends:true,...takeoff.timeline};
  const dayHours=positive(settings.hoursPerDay)||8,availableWork=timelineSources(takeoff);
  const sources=new Map(availableWork.map(task=>[task.id,task]));
  const saved=Array.isArray(settings.tasks)?settings.tasks:[];
  const tasks=saved.map(override=>{
    const source=sources.get(override.id),excluded=override.excluded===true;
    const startHour=typeof override.startHour==='number'&&Number.isFinite(override.startHour)&&override.startHour>=0?override.startHour:null;
    const durationHours=positive(override.durationHours),crew=positive(override.crew);
    const missing=[];
    if(startHour===null)missing.push('start');if(!durationHours)missing.push('duration');if(!crew)missing.push('crew');
    const scheduled=!!source&&!excluded&&!missing.length;
    return {...(source||{id:override.id,name:'Source work no longer available',page:'',path:'',issues:[],laborHours:0}),override,crew,durationHours,
      startHour:scheduled?startHour:null,endHour:scheduled?startHour+durationHours:null,scheduled,excluded,
      status:excluded?'Excluded':!source?'Source needs review':missing.length?'Needs '+missing.join(', '):'Planned'};
  });
  const endHour=tasks.filter(t=>t.scheduled).reduce((max,t)=>Math.max(max,t.endHour),0),days=Math.ceil(endHour/dayHours);
  return {settings:{hoursPerDay:dayHours,startDate:settings.startDate,skipWeekends:settings.skipWeekends},tasks,availableWork,hasPlan:saved.length>0,
    laborHours:availableWork.reduce((sum,t)=>sum+t.laborHours,0),endHour,days,peakCrew:timelinePeakCrew(tasks),
    finishDate:days?workDate(settings.startDate,days-1,settings.skipWeekends):'',unscheduled:tasks.filter(t=>!t.excluded&&!t.scheduled).length,
    guidance:'AI creates the plan. Only saved tasks with explicit start hours, duration hours, and crew are scheduled. Estimate facts in availableWork are reference only: Count x Time x Days represents direct labor person-hours when those fields mean people, hours per day, and days. AI must review dependencies, shared crews, quantity pricing, mobilization and cure times. Opening the timeline or changing the estimate never creates, adds, sequences or retimes tasks. Plan edits never change estimate prices or quantities.'};
}
