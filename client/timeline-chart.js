const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const number=value=>Number(value.toFixed(2)).toLocaleString();
const crew=value=>value?number(value)+(value===1?' person':' people'):'Crew not set';

// Presentation order must never change the estimate sequence or saved start times.
export function scopeLanes(tasks,from,to){
  const groups=new Map();
  for(const task of tasks){
    if(!task.scheduled||task.endHour<=from||task.startHour>=to)continue;
    const scopeId=task.scopeId||task.sheetId,key=JSON.stringify([task.sheetId,scopeId]);
    if(!groups.has(key))groups.set(key,{id:scopeId,name:task.scopeName||task.page,page:task.page,color:task.color,tasks:[]});
    groups.get(key).tasks.push(task);
  }
  return [...groups.values()].map(group=>{
    const ends=[];
    group.tasks=group.tasks.toSorted((a,b)=>a.startHour-b.startHour||a.endHour-b.endHour).map(task=>{
      let lane=ends.findIndex(end=>end<=task.startHour);
      if(lane<0)lane=ends.length;
      ends[lane]=task.endHour;
      return {...task,lane};
    });
    return {...group,lanes:ends.length};
  }).sort((a,b)=>a.tasks[0].startHour-b.tasks[0].startHour);
}

export function renderScopeLanes(grid,draft,firstDay,windowDays,bridge){
  const hours=draft.settings.hoursPerDay,from=firstDay*hours,to=(firstDay+windowDays)*hours;
  const groups=scopeLanes(draft.tasks,from,to);
  if(!groups.length)grid.append(el('p','No scheduled work in these days. Set missing durations in Adjust tasks or move to another day window.','timeline-empty'));
  for(const group of groups){
    const wrap=el('section','','timeline-scope');wrap.dataset.timelineScope=group.id;
    wrap.style.setProperty('--scope-color',bridge.scopeColorValue(group.color)||'var(--slate)');
    const row=el('div','','timeline-grid-row timeline-scope-row');
    const label=el('div','','timeline-label');label.append(el('strong',group.name));
    if(group.page!==group.name)label.append(el('small',group.page));
    label.append(el('small',group.tasks.length+' scheduled '+(group.tasks.length===1?'activity':'activities')));
    const track=el('div','','timeline-track');track.style.height=group.lanes*64+16+'px';
    const legend=el('div','','timeline-work-list');
    group.tasks.forEach((task,index)=>{
      const start=Math.max(task.startHour,from),end=Math.min(task.endHour,to),marker=String(index+1);
      const holder=el('div','','timeline-work-block');holder.dataset.timelineTask=task.id;
      holder.style.left=(start-from)/(to-from)*100+'%';holder.style.width=(end-start)/(to-from)*100+'%';holder.style.top=task.lane*64+8+'px';
      const bar=el('button','','timeline-bar');bar.type='button';
      if((end-start)/(to-from)<0.04){bar.classList.add('timeline-bar-short');bar.append(el('strong',marker));}
      else bar.append(el('strong',marker+'. '+task.name),el('small',number(task.durationHours)+'h / '+crew(task.crew)));
      bar.title=task.path+' — Day '+number(task.startHour/hours+1)+' / '+number(task.durationHours)+' working hours / '+crew(task.crew);
      bar.setAttribute('aria-label','Open '+task.name+' in estimate');bar.onclick=()=>bridge.openTimelineTask(task.sheetId,task.id);
      holder.append(bar);track.append(holder);
      // Full names stay visible even when a one-hour block is too narrow for its text.
      const item=el('button','','timeline-work-key');item.type='button';item.dataset.timelineKey=task.id;
      item.append(el('span',marker,'timeline-work-number'),el('strong',task.name),el('small','Day '+number(task.startHour/hours+1)+' · '+number(task.durationHours)+'h · '+crew(task.crew)));
      item.title=task.path;item.onclick=bar.onclick;legend.append(item);
    });
    row.append(label,track);wrap.append(row,legend);grid.append(wrap);
  }
  const pending=draft.tasks.filter(task=>!task.scheduled&&!task.excluded);
  if(pending.length){
    const panel=el('div','','timeline-pending');panel.append(el('strong',pending.length+' '+(pending.length===1?'activity needs':'activities need')+' scheduling'));
    for(const task of pending){const item=el('div');item.dataset.timelineTask=task.id;item.append(el('span',task.name),el('small',task.status));panel.append(item);}
    grid.append(panel);
  }
}
