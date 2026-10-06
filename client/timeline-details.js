import {workDate} from '../shared/timeline.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export const costLabels={travel:'Travel',hotel:'Hotel',meals:'Meals',other:'Other costs'};
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2}).format(value);
const num=value=>Number(value.toFixed(2)).toLocaleString();
export function timelineIcon(kind,bridge){
  const wrap=el('span','','timeline-icon-wrap');wrap.setAttribute('aria-hidden','true');
  const paths={travel:'<path d="M1 3h8v8H1zM9 6h3l3 3v2H9"/><circle cx="4" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/>',hotel:'<path d="M1.5 13V4m13 9V7.5H6V10H1.5m0 0h13"/><circle cx="4" cy="7" r="1.5"/>',meals:'<path d="M3 2v5m3-5v5M3 5h3M4.5 7v7M12 2c-3 2-3 6 0 6V2zm0 6v6"/>',other:'<circle cx="8" cy="8" r="6"/><path d="M10 5H7a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3H6m2-8v10"/>'};
  wrap.innerHTML=paths[kind]?'<svg class="timeline-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">'+paths[kind]+'</svg>':bridge.timelineItemIcon?.(kind)||'';
  return wrap;
}
export function resourceBadges(resources,bridge){
  const wrap=el('span','','timeline-resource-badges');
  for(const kind of [...new Set(resources.filter(r=>!r.missing).map(r=>r.kind))]){
    const items=resources.filter(r=>r.kind===kind&&!r.missing),badge=el('span','','timeline-resource-badge');
    badge.append(timelineIcon(kind,bridge));
    badge.title=items.map(r=>(r.quantity===undefined?'':r.quantity+' x ')+r.name).join('\n');badge.setAttribute('aria-label',badge.title);wrap.append(badge);
  }
  return wrap;
}
export function renderDailyCosts(draft,firstDay,windowDays,tickDays,bridge,onOpen){
  const row=el('div','','timeline-grid-row timeline-cost-row');
  const label=el('div','Daily costs','timeline-label');label.title='AI-assigned planning allowances; not added to estimate pricing.';row.append(label);
  const cells=el('div','','timeline-days');
  for(let day=firstDay;day<firstDay+windowDays;day+=tickDays){
    const span=Math.min(tickDays,firstDay+windowDays-day),cell=el('div');cell.style.width=span/windowDays*100+'%';
    const costs=draft.costs.filter(c=>c.day>=day+1&&c.day<=day+span);
    for(const kind of Object.keys(costLabels)){
      const matching=costs.filter(c=>c.kind===kind);if(!matching.length)continue;
      const known=matching.filter(c=>typeof c.amount==='number'),total=known.reduce((sum,c)=>sum+c.amount,0),unknown=known.length<matching.length;
      const chip=el('button','','timeline-cost-chip');chip.type='button';
      const compact=known.length?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1}).format(total):'?';
      const full=costLabels[kind]+': '+(known.length?money(total):'Not priced')+(unknown&&known.length?' + unpriced entries':'')+' / '+(span===1?'Day '+(day+1):'Days '+(day+1)+'-'+(day+span));
      chip.append(timelineIcon(kind,bridge),el('span',compact+(unknown&&known.length?' + ?':'')));chip.title=full;chip.setAttribute('aria-label',full);chip.onclick=()=>onOpen(day+1,day+span,kind);cell.append(chip);
    }
    if(!costs.length)cell.append(el('span','—','timeline-no-cost'));cells.append(cell);
  }
  row.append(cells);return row;
}

export function setupTimelineDetails(bridge){
  const dialog=el('dialog','','timeline-detail-dialog');dialog.id='timeline-detail-dialog';dialog.setAttribute('aria-labelledby','timeline-detail-title');
  const top=el('div','','timeline-detail-head'),title=el('h2');title.id='timeline-detail-title';
  const close=el('button','Close','btn alt');close.type='button';close.onclick=()=>dialog.close();top.append(title,close);
  const body=el('div','','timeline-detail-body');dialog.append(top,body);document.body.append(dialog);
  let draft,selection;
  const empty=text=>el('p',text,'timeline-detail-muted');
  function costList(costs){
    const list=el('div','','timeline-detail-costs');
    if(!costs.length){list.append(empty('No daily costs assigned.'));return list;}
    for(const cost of costs){
      const item=el('article'),head=el('div','','timeline-detail-cost-title');head.append(timelineIcon(cost.kind,bridge),el('strong',cost.label||costLabels[cost.kind]),el('b',typeof cost.amount==='number'?money(cost.amount):'Not priced'));item.append(head);
      const date=workDate(draft.settings.startDate,cost.day-1,draft.settings.skipWeekends);
      const task=draft.tasks.find(t=>t.id===cost.taskId);
      item.append(empty('Day '+cost.day+(date?' / '+date:'')+(task?' / '+task.name:' / Shared project cost')));
      if(cost.notes)item.append(el('p',cost.notes,'timeline-detail-note'));
      if(cost.source)item.append(empty('Estimate reference: '+cost.source.name+' / '+cost.source.page));
      list.append(item);
    }
    list.append(empty('Planning allowances only. These amounts do not add to or change the estimate.'));return list;
  }
  function taskCard(task){
    const card=el('article','','timeline-detail-task');card.append(el('h3',task.name),empty(task.page+(task.path?' / '+task.path:'')));
    const stats=el('div','','timeline-detail-stats');
    for(const [label,value] of [['Start',task.startHour===null?task.status:'Day '+num(task.startHour/draft.settings.hoursPerDay+1)],['Duration',task.durationHours?num(task.durationHours)+' hours':'Not set'],['Crew',task.crew?num(task.crew)+(task.crew===1?' person':' people'):'Not set']]){const block=el('div');block.append(el('small',label),el('strong',value));stats.append(block);}card.append(stats);
    card.append(el('h4','Work plan'),task.notes?el('p',task.notes,'timeline-detail-note'):empty('No work notes assigned by AI yet.'));
    card.append(el('h4','Equipment & resources'));
    if(!task.resources.length)card.append(empty('No equipment or resources assigned by AI yet.'));
    for(const resource of task.resources){
      const item=el('div','','timeline-detail-resource');item.append(timelineIcon(resource.kind||'part',bridge));
      const text=el('div');text.append(el('strong',resource.name),empty(resource.missing?'Source needs review':(resource.quantity===undefined?'Assigned quantity not set':'Assigned quantity: '+resource.quantity)+' / '+resource.page));
      if(resource.notes)text.append(el('p',resource.notes,'timeline-detail-note'));
      if(resource.note)text.append(empty('Estimate note: '+resource.note));item.append(text);card.append(item);
    }
    const costs=draft.costs.filter(c=>c.taskId===task.id);card.append(el('h4','Assigned daily costs'),costList(costs));
    if(task.sheetId){const source=el('button','Open in estimate','btn alt');source.type='button';source.onclick=()=>{dialog.close();bridge.openTimelineTask(task.sheetId,task.id);};card.append(source);}
    return card;
  }
  function render(){
    if(!selection||!draft)return;body.replaceChildren();
    if(selection.type==='costs'){
      title.textContent=costLabels[selection.kind]+' / '+(selection.from===selection.to?'Day '+selection.from:'Days '+selection.from+'-'+selection.to);
      body.append(costList(draft.costs.filter(c=>c.day>=selection.from&&c.day<=selection.to&&c.kind===selection.kind)));
    }else{
      const tasks=draft.tasks.filter(t=>selection.type==='task'?t.id===selection.id:(t.scopeId||t.sheetId)===selection.id&&!t.excluded);
      title.textContent=selection.type==='task'?'Activity details':tasks[0]?.scopeName||'Scope details';
      if(!tasks.length)body.append(empty('This work is no longer in the plan.'));
      tasks.forEach(task=>body.append(taskCard(task)));
    }
  }
  const open=value=>{selection=value;render();if(!dialog.open)dialog.showModal();};
  return {update(value){draft=value;if(dialog.open)render();},close(){dialog.close();selection=null;},task:id=>open({type:'task',id}),scope:id=>open({type:'scope',id}),costs:(from,to,kind)=>open({type:'costs',from,to,kind})};
}
