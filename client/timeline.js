import './timeline.css';
import {renderScopeLanes} from './timeline-chart.js';
import {deriveTimeline,validateTimeline,workDate,timelinePeakCrew} from '../shared/timeline.js';

const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const number=value=>Number(value.toFixed(2)).toLocaleString();
export function setupTimeline(bridge){
  const card=document.getElementById('timelineCard');
  card.innerHTML='<div class="head"><div class="eyebrow-row"><span class="eyebrow">Timeline</span></div><div class="sum-title" id="timeline-title"></div><p class="timeline-intro">A planning draft from your estimate. Adjust the schedule here without changing prices or quantities.</p></div><div class="scroll timeline-content"><form id="timeline-settings" class="timeline-settings"><label>Hours / workday<input id="timeline-hours" type="number" min="1" max="24" step="0.5"></label><label>Start date<input id="timeline-date" type="date"></label><label>Automatic sequence<select id="timeline-mode"><option value="sequential">Sections in estimate order</option><option value="parallel-pages">Separate crew for each page</option></select></label><label class="timeline-check"><input id="timeline-weekends" type="checkbox">Skip weekends</label></form><p id="timeline-error" role="alert"></p><div id="timeline-stats" class="timeline-stats"></div><details class="timeline-assumptions"><summary>How this draft is calculated</summary><p id="timeline-guidance"></p><p>Changing crew assumes the same labor effort at constant productivity. A duration override takes priority. Start and duration use working hours; breaks and weekends do not consume hours. Dates are optional.</p></details><div class="timeline-chart-heading"><h3>Work sequence</h3><div><label class="timeline-scale-label">Show <select id="timeline-scale" aria-label="Timeline day window"><option value="1">1 day</option><option value="3">3 days</option><option value="7" selected>7 days</option><option value="14">14 days</option></select></label><button type="button" class="btn alt tiny" id="timeline-prev">Previous days</button><span id="timeline-window"></span><button type="button" class="btn alt tiny" id="timeline-next">Next days</button></div></div><p class="timeline-chart-help">One row per scope. Numbered blocks match the work listed below; click any activity to open it in the estimate.</p><div id="timeline-chart" class="timeline-chart"></div><details class="timeline-adjustments" open><summary>Adjust tasks</summary><p>Blank fields use the estimate. Start day 1 begins at hour 0; day 1.5 starts halfway through the first workday. Give tasks the same start to overlap them.</p><div class="timeline-table-scroll"><table class="timeline-table"><thead><tr><th>Task / page</th><th>Start day</th><th>People</th><th>Duration (hours)</th><th>Include</th><th></th></tr></thead><tbody id="timeline-tasks"></tbody></table></div></details></div>';
  const $=id=>document.getElementById('timeline-'+id);
  let firstDay=0,windowSize=7,identity='';
  function change(update){
    try{
      const takeoff=bridge.getTimelineTakeoff();if(!takeoff)return;
      const next=structuredClone(takeoff.timeline||{});update(next);
      const ids=new Set(takeoff.sheets.flatMap(sheet=>sheet.rows.map(row=>row.id)));
      if(next.tasks)next.tasks=next.tasks.filter(task=>ids.has(task.id));
      validateTimeline({...takeoff,timeline:next});bridge.setTimeline(next);$('error').textContent='';render();
    }catch(error){$('error').textContent=error.message;}
  }
  $('settings').onsubmit=event=>event.preventDefault();
  $('hours').onchange=()=>change(next=>{next.hoursPerDay=Number($('hours').value);});
  $('date').onchange=()=>change(next=>{next.startDate=$('date').value;});
  $('mode').onchange=()=>change(next=>{next.mode=$('mode').value;});
  $('weekends').onchange=()=>change(next=>{next.skipWeekends=$('weekends').checked;});
  $('prev').onclick=()=>{firstDay=Math.max(0,firstDay-windowSize);render();};
  $('next').onclick=()=>{firstDay+=windowSize;render();};
  $('scale').onchange=()=>{windowSize=Number($('scale').value);render();};
  function editTask(id,key,value){
    change(next=>{
      next.tasks ||= [];let task=next.tasks.find(t=>t.id===id);
      if(!task){task={id};next.tasks.push(task);}
      if(value===undefined)delete task[key];else task[key]=value;
      next.tasks=next.tasks.filter(t=>Object.keys(t).length>1);
    });
  }
  function render(){
    if(bridge.getLocation().view!=='timeline')return;
    const takeoff=bridge.getTimelineTakeoff();if(!takeoff)return;
    if(identity!==takeoff.id){identity=takeoff.id;firstDay=0;$('error').textContent='';}
    const draft=deriveTimeline(takeoff),settings=draft.settings;
    $('title').textContent=takeoff.name||'Takeoff timeline';
    $('hours').value=settings.hoursPerDay;$('date').value=settings.startDate;$('mode').value=settings.mode;$('weekends').checked=settings.skipWeekends;
    $('guidance').textContent=draft.guidance;
    $('stats').replaceChildren();
    for(const [label,value] of [['Scheduled span',draft.days?number(draft.endHour/settings.hoursPerDay)+' workdays':'Not scheduled'],['Estimated labor',number(draft.laborHours)+' person-hours'],['Planned peak crew',number(draft.peakCrew)+' people'],['Needs scheduling',String(draft.unscheduled)],['Finish date',draft.finishDate||'No date set']]){
      const metric=el('div');metric.append(el('span',label),el('strong',value));$('stats').append(metric);
    }
    const count=Math.max(1,draft.days),windowDays=windowSize;
    firstDay=Math.min(firstDay,Math.max(0,Math.floor((count-1)/windowSize)*windowSize));
    $('prev').disabled=firstDay===0;$('next').disabled=firstDay+windowDays>=count;
    $('window').textContent='Days '+(firstDay+1)+'–'+(firstDay+windowDays);
    const chart=$('chart');chart.replaceChildren();
    if(!draft.tasks.length){chart.append(el('p','Add named work to the estimate to create a timeline. Labor rows with people, hours, and days are scheduled automatically.','timeline-empty'));}
    else{
      const grid=el('div','','timeline-grid');grid.style.setProperty('--timeline-days',windowDays);
      const header=el('div','','timeline-grid-row timeline-grid-head');header.append(el('div','Scope / work','timeline-label'));
      const days=el('div','','timeline-days');
      for(let day=firstDay;day<firstDay+windowDays;day++){
        const heading=el('div');heading.append(el('strong','Day '+(day+1)));
        const date=workDate(settings.startDate,day,settings.skipWeekends);
        heading.append(el('small',date||settings.hoursPerDay+'h'));days.append(heading);
      }
      header.append(days);grid.append(header);
      renderScopeLanes(grid,draft,firstDay,windowDays,bridge);
      const crew=el('div','','timeline-grid-row timeline-crew');crew.append(el('div','Peak people scheduled','timeline-label'));
      const totals=el('div','','timeline-days');
      for(let day=firstDay;day<firstDay+windowDays;day++){
        totals.append(el('div',number(timelinePeakCrew(draft.tasks,day*settings.hoursPerDay,(day+1)*settings.hoursPerDay))));
      }
      crew.append(totals);grid.append(crew);
      chart.append(grid);
    }
    $('tasks').replaceChildren();
    for(const task of draft.tasks.toSorted((a,b)=>(a.startHour??Infinity)-(b.startHour??Infinity))){
      const row=el('tr');row.dataset.timelineEdit=task.id;
      const name=el('td');name.append(el('strong',task.name),el('small',task.page+(task.path?' / '+task.path:'')),el('small',task.status+(task.issues.length?' · '+task.issues.join('; '):'')));
      row.append(name);
      for(const [key,label,min,step] of [['startHour','Start day',1,'any'],['crew','People',0.01,'any'],['durationHours','Duration hours',0.01,'any']]){
        const cell=el('td'),input=el('input');input.type='number';input.min=min;input.step=step;input.setAttribute('aria-label',label+' for '+task.name);
        const value=task.override[key];input.value=value===undefined?'':key==='startHour'?String(value/settings.hoursPerDay+1):String(value);
        input.placeholder=key==='startHour'?(task.startHour===null?'Auto':String(Number((task.startHour/settings.hoursPerDay+1).toFixed(2)))):key==='crew'?(task.crew?String(Number(task.crew.toFixed(2))):'Auto'):(task.durationHours?String(Number(task.durationHours.toFixed(2))):'Required');
        input.onchange=()=>editTask(task.id,key,input.value===''?undefined:key==='startHour'?(Number(input.value)-1)*settings.hoursPerDay:Number(input.value));
        cell.append(input);row.append(cell);
      }
      const include=el('td'),check=el('input');check.type='checkbox';check.checked=!task.excluded;check.setAttribute('aria-label','Include '+task.name);check.onchange=()=>editTask(task.id,'excluded',!check.checked);include.append(check);row.append(include);
      const actions=el('td'),reset=el('button','Reset','btn alt tiny');reset.type='button';reset.disabled=Object.keys(task.override).length===0;reset.setAttribute('aria-label','Reset '+task.name);
      reset.onclick=()=>change(next=>{next.tasks=(next.tasks||[]).filter(t=>t.id!==task.id);});actions.append(reset);row.append(actions);$('tasks').append(row);
    }
  }
  document.addEventListener('estimator:view',render);
  document.addEventListener('estimator:projects',render);
  render();
}
