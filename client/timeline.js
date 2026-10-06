import './timeline.css';
import {renderScopeLanes} from './timeline-chart.js';
import {setupTimelineDetails,renderDailyCosts} from './timeline-details.js';
import {deriveTimeline,validateTimeline,workDate,timelinePeakCrew} from '../shared/timeline.js';

const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const number=value=>Number(value.toFixed(2)).toLocaleString();
export function setupTimeline(bridge){
  const card=document.getElementById('timelineCard');
  card.innerHTML='<div class="head"><div class="eyebrow-row"><span class="eyebrow">Timeline</span></div><div class="sum-title" id="timeline-title"></div><p class="timeline-intro">An AI-created work plan. Your estimate stays separate from the schedule.</p></div><div class="scroll timeline-content"><form id="timeline-settings" class="timeline-settings"><label>Hours / workday<input id="timeline-hours" type="number" min="1" max="24" step="0.5"></label><label>Start date<input id="timeline-date" type="date"></label><label class="timeline-check"><input id="timeline-weekends" type="checkbox">Skip weekends</label></form><p id="timeline-error" role="alert"></p><div id="timeline-stats" class="timeline-stats"></div><details class="timeline-assumptions"><summary>How planning works</summary><p id="timeline-guidance"></p><p>AI chooses the work sequence, durations, and crews. Start and duration use working hours. You can adjust saved tasks here; changing crew size does not retime work.</p></details><div class="timeline-chart-heading"><h3>Project timeline</h3><div><button type="button" class="btn alt tiny" id="timeline-expand">Expand activities</button><label class="timeline-scale-label">Show <select id="timeline-scale" aria-label="Timeline day window"><option value="0" selected>Entire plan</option><option value="1">1 day</option><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option></select></label><button type="button" class="btn alt tiny" id="timeline-prev">Previous days</button><span id="timeline-window"></span><button type="button" class="btn alt tiny" id="timeline-next">Next days</button></div></div><p class="timeline-chart-help">Main scopes share one time axis. Expand a scope to see its planned activities. Faint spans include gaps; solid bars show scheduled work.</p><div id="timeline-chart" class="timeline-chart"></div><details class="timeline-adjustments" open><summary>Adjust tasks</summary><p>Every task needs a start, crew size, and duration. Blank fields leave the task unscheduled. Start day 1 begins at hour 0; day 1.5 starts halfway through the first workday. Give tasks the same start to overlap them.</p><div class="timeline-table-scroll"><table class="timeline-table"><thead><tr><th>Task / page</th><th>Start day</th><th>People</th><th>Duration (hours)</th><th>Include</th><th></th></tr></thead><tbody id="timeline-tasks"></tbody></table></div></details></div>';
  const $=id=>document.getElementById('timeline-'+id);
  let firstDay=0,windowSize=0,identity='';
  const expanded=new Set(),details=setupTimelineDetails(bridge);
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
  $('weekends').onchange=()=>change(next=>{next.skipWeekends=$('weekends').checked;});
  $('prev').onclick=()=>{firstDay=Math.max(0,firstDay-windowSize);render();};
  $('next').onclick=()=>{firstDay+=windowSize;render();};
  $('scale').onchange=()=>{windowSize=Number($('scale').value);render();};
  $('expand').onclick=()=>{
    const draft=deriveTimeline(bridge.getTimelineTakeoff());
    const ids=[...new Set(draft.tasks.filter(t=>t.scheduled).map(t=>t.scopeId||t.sheetId))];
    const collapse=ids.every(id=>expanded.has(id));expanded.clear();if(!collapse)ids.forEach(id=>expanded.add(id));render();
  };
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
    if(identity!==takeoff.id){identity=takeoff.id;firstDay=0;expanded.clear();details.close();$('error').textContent='';}
    const draft=deriveTimeline(takeoff),settings=draft.settings;details.update(draft);
    $('title').textContent=takeoff.name||'Takeoff timeline';
    $('hours').value=settings.hoursPerDay;$('date').value=settings.startDate;$('weekends').checked=settings.skipWeekends;
    $('guidance').textContent=draft.guidance;
    $('stats').hidden=!draft.hasPlan;
    $('tasks').closest('details').hidden=!draft.hasPlan;
    card.querySelector('.timeline-chart-heading').hidden=!draft.hasPlan;
    card.querySelector('.timeline-chart-help').hidden=!draft.hasPlan;
    $('stats').replaceChildren();
    for(const [label,value] of [['Plan span',draft.days?number(draft.endHour/settings.hoursPerDay)+' workdays':'Not scheduled'],['Estimated labor',number(draft.laborHours)+' person-hours'],['Planned peak crew',number(draft.peakCrew)+' people'],['Needs scheduling',String(draft.unscheduled)],['Finish date',draft.finishDate||'No date set']]){
      const metric=el('div');metric.append(el('span',label),el('strong',value));$('stats').append(metric);
    }
    const count=Math.max(1,draft.days),windowDays=windowSize||count;
    if(!windowSize)firstDay=0;
    const scopeIds=[...new Set(draft.tasks.filter(t=>t.scheduled).map(t=>t.scopeId||t.sheetId))];
    $('expand').textContent=scopeIds.length&&scopeIds.every(id=>expanded.has(id))?'Collapse activities':'Expand activities';
    $('expand').disabled=!scopeIds.length;
    firstDay=Math.min(firstDay,Math.max(0,Math.floor((count-1)/windowDays)*windowDays));
    $('prev').disabled=firstDay===0;$('next').disabled=firstDay+windowDays>=count;
    $('window').textContent='Days '+(firstDay+1)+'–'+(firstDay+windowDays);
    const chart=$('chart');chart.replaceChildren();
    if(!draft.hasPlan){
      const empty=el('div','','timeline-empty');empty.append(el('h3','No timeline plan yet'),el('p','Ask your connected AI to create a work plan using this estimate and '+settings.hoursPerDay+'-hour workdays. It will choose the tasks, starts, durations, and crews. Nothing is scheduled automatically.'));
      const access=el('button','AI Access','btn alt');access.type='button';access.onclick=()=>document.getElementById('takeoff-ai-access')?.click();empty.append(access);chart.append(empty);
    }
    else{
      const grid=el('div','','timeline-grid');
      const tickDays=Math.max(1,Math.ceil(windowDays/14));
      grid.style.setProperty('--timeline-days',Math.ceil(windowDays/tickDays));
      grid.style.setProperty('--timeline-step',tickDays/windowDays*100+'%');
      const header=el('div','','timeline-grid-head');
      header.append(renderDailyCosts(draft,firstDay,windowDays,tickDays,bridge,details.costs));
      const dayRow=el('div','','timeline-grid-row timeline-date-row');dayRow.append(el('div','Scope of work','timeline-label'));
      const days=el('div','','timeline-days');
      for(let day=firstDay;day<firstDay+windowDays;day+=tickDays){
        const span=Math.min(tickDays,firstDay+windowDays-day);
        const heading=el('div');heading.style.width=span/windowDays*100+'%';heading.append(el('strong',span===1?'Day '+(day+1):'Days '+(day+1)+'-'+(day+span)));
        const date=workDate(settings.startDate,day,settings.skipWeekends);
        heading.append(el('small',date||settings.hoursPerDay+'h'));days.append(heading);
      }
      dayRow.append(days);header.append(dayRow);grid.append(header);
      renderScopeLanes(grid,draft,firstDay,windowDays,bridge,expanded,id=>{if(expanded.has(id))expanded.delete(id);else expanded.add(id);render();},details);
      const crew=el('div','','timeline-grid-row timeline-crew');crew.append(el('div','Peak people scheduled','timeline-label'));
      const totals=el('div','','timeline-days');
      for(let day=firstDay;day<firstDay+windowDays;day+=tickDays){
        const span=Math.min(tickDays,firstDay+windowDays-day);
        const value=el('div',number(timelinePeakCrew(draft.tasks,day*settings.hoursPerDay,(day+span)*settings.hoursPerDay)));value.style.width=span/windowDays*100+'%';totals.append(value);
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
        input.placeholder='Required';
        input.onchange=()=>editTask(task.id,key,input.value===''?undefined:key==='startHour'?(Number(input.value)-1)*settings.hoursPerDay:Number(input.value));
        cell.append(input);row.append(cell);
      }
      const include=el('td'),check=el('input');check.type='checkbox';check.checked=!task.excluded;check.setAttribute('aria-label','Include '+task.name);check.onchange=()=>editTask(task.id,'excluded',!check.checked);include.append(check);row.append(include);
      const actions=el('td'),reset=el('button','Remove','btn alt tiny');reset.type='button';reset.disabled=Object.keys(task.override).length===0;reset.setAttribute('aria-label','Remove '+task.name+' from timeline');
      reset.onclick=()=>change(next=>{next.tasks=(next.tasks||[]).filter(t=>t.id!==task.id);for(const cost of next.costs||[])if(cost.taskId===task.id)delete cost.taskId;});actions.append(reset);row.append(actions);$('tasks').append(row);
    }
  }
  document.addEventListener('estimator:view',render);
  document.addEventListener('estimator:projects',render);
  render();
}
