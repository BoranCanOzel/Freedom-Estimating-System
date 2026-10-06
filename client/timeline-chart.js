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

export function renderScopeLanes(grid,draft,firstDay,windowDays,bridge,expanded=new Set(),onToggle=()=>{}){
  const hours=draft.settings.hoursPerDay,from=firstDay*hours,to=(firstDay+windowDays)*hours;
  const groups=scopeLanes(draft.tasks,0,Infinity);
  const place=(node,start,end)=>{
    node.style.left=(Math.max(start,from)-from)/(to-from)*100+'%';
    node.style.width=(Math.min(end,to)-Math.max(start,from))/(to-from)*100+'%';
  };
  const visible=task=>task.endHour>from&&task.startHour<to;
  if(!groups.some(group=>group.tasks.some(visible)))grid.append(el('p','No scheduled work in these days. Set missing durations in Adjust tasks or move to another day window.','timeline-empty'));
  for(const group of groups){
    const wrap=el('section','','timeline-scope');wrap.dataset.timelineScope=group.id;
    wrap.style.setProperty('--scope-color',bridge.scopeColorValue(group.color)||'var(--slate)');
    const row=el('div','','timeline-grid-row timeline-scope-row');
    const label=el('button','','timeline-label timeline-scope-toggle');label.type='button';
    const open=expanded.has(group.id);
    label.setAttribute('aria-expanded',String(open));label.setAttribute('aria-label',(open?'Collapse ':'Expand ')+group.name+' activities');
    label.append(el('span',open?'\u25be':'\u25b8','timeline-caret'),el('strong',group.name),el('small',group.page===group.name?group.tasks.length+' planned activities':group.page));
    label.onclick=()=>onToggle(group.id);
    const track=el('div','','timeline-track');
    const start=group.tasks[0].startHour,end=Math.max(...group.tasks.map(task=>task.endHour));
    if(end>from&&start<to){
      const span=el('div','','timeline-scope-span');place(span,start,end);
      span.title=group.name+' / Day '+number(start/hours+1)+' / '+number((end-start)/hours)+' workday span, including any gaps';track.append(span);
      // Merge occupied intervals for the scope overview; gaps remain visibly unfilled.
      const occupied=[];
      for(const task of group.tasks){
        const last=occupied.at(-1);
        if(last&&task.startHour<=last[1])last[1]=Math.max(last[1],task.endHour);
        else occupied.push([task.startHour,task.endHour]);
      }
      for(const [a,b] of occupied){
        if(b<=from||a>=to)continue;
        const segment=el('button','','timeline-scope-bar');segment.type='button';place(segment,a,b);
        segment.title=group.name+' / Day '+number(a/hours+1)+' / '+number(b-a)+' working hours';
        segment.setAttribute('aria-label','Show activities for '+group.name);segment.onclick=()=>onToggle(group.id);track.append(segment);
      }
    }
    row.append(label,track);wrap.append(row);
    const detail=el('div','','timeline-scope-details');detail.hidden=!open;
    for(const task of group.tasks){
      const work=el('div','','timeline-grid-row timeline-task-row');work.dataset.timelineTask=task.id;
      const name=el('button','','timeline-label');name.type='button';name.title=task.path;
      name.append(el('strong',task.name),el('small',number(task.durationHours)+'h / '+crew(task.crew)));
      name.onclick=()=>bridge.openTimelineTask(task.sheetId,task.id);
      const line=el('div','','timeline-track');
      if(visible(task)){
        const bar=el('button','','timeline-bar');bar.type='button';place(bar,task.startHour,task.endHour);
        if((Math.min(task.endHour,to)-Math.max(task.startHour,from))/(to-from)>=0.04)bar.textContent=number(task.durationHours)+'h';
        bar.title=task.name+' / Day '+number(task.startHour/hours+1)+' / '+number(task.durationHours)+' working hours / '+crew(task.crew);
        bar.setAttribute('aria-label','Open '+task.name+' in estimate');bar.onclick=name.onclick;line.append(bar);
      }
      work.append(name,line);detail.append(work);
    }
    wrap.append(detail);grid.append(wrap);
  }
  const pending=draft.tasks.filter(task=>!task.scheduled&&!task.excluded);
  if(pending.length){
    const panel=el('div','','timeline-pending');panel.append(el('strong',pending.length+' '+(pending.length===1?'activity needs':'activities need')+' scheduling'));
    for(const task of pending){const item=el('div');item.dataset.timelineTask=task.id;item.append(el('span',task.name),el('small',task.status));panel.append(item);}
    grid.append(panel);
  }
}
