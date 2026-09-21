import { resolveLocation } from '../shared/navigation.js';

export function peerColor(name) {
  let hash = 0;
  for (const char of name || '') hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 65% 42%)`;
}

export function setupProjectPresence(bridge) {
  let peers = [], selfId, signature = '', frame = 0, dirty = true;
  function paint() {
    frame = 0;
    const book = {lists:bridge.getProjectLists()}, here = resolveLocation(book,bridge.getLocation());
    const visitors = peers.filter(p=>p.id!==selfId).map(peer=>({peer,location:resolveLocation(book,peer)})).filter(p=>p.location);
    const next = JSON.stringify([here,visitors.map(({peer,location})=>[peer.id,peer.name,location])]);
    if (!dirty && signature === next) return;
    signature = next; dirty = false;
    clear();
    const groups = new Map();
    const byId = (name,id) => document.querySelector(`#projBody [data-${name}="${CSS.escape(id)}"]`);
    if (here) {
      const current = [
        [byId('company',here.company)?.querySelector(':scope > .p-head'), `${here.projectName} / ${here.takeoffName} · ${here.tab}`],
        [byId('project',here.project)?.querySelector(':scope > .p-head'), `${here.takeoffName} · ${here.tab}`],
        [byId('takeoff',here.takeoff), here.tab]
      ];
      for (const [host,detail] of current) {
        if (!host) continue;
        host.classList.add('is-current-location');
        if (host.dataset.takeoff) host.setAttribute('aria-current','location');
        groups.set(host,{people:[`You are here · ${detail}`],colors:['var(--amber)'],tab:false});
      }
    }
    function mark(host,peer,location,tab=false) {
      if (!host) return;
      if (!groups.has(host)) groups.set(host,{people:[],colors:[],tab});
      const group=groups.get(host);
      const text = tab ? peer.name : `${peer.name} · ${location.projectName} / ${location.takeoffName} · ${location.tab}`;
      if (!group.people.includes(text)) group.people.push(text);
      if (!group.colors.includes(peerColor(peer.name))) group.colors.push(peerColor(peer.name));
    }
    for (const {peer,location:l} of visitors) {
      if (l.list === bridge.getLocation().list) {
        mark(byId('company',l.company)?.querySelector(':scope > .p-head'),peer,l);
        mark(byId('project',l.project)?.querySelector(':scope > .p-head'),peer,l);
        mark(byId('takeoff',l.takeoff),peer,l);
      }
      if (here?.takeoff === l.takeoff && here.list === l.list) {
        const selector = l.view === 'sheet' ? `[data-sheet="${CSS.escape(l.sheet)}"]`
          : {summary:'.tab-summary',scopes:'.tab-opts-btn',load:'.tab-load',wage:'.tab-wage'}[l.view];
        let tab = selector && document.querySelector('#rail '+selector);
        if (!tab && ['load','wage'].includes(l.view)) tab = [...document.querySelectorAll('#rail .tab-calc')].find(t=>t.textContent.toLowerCase().startsWith(l.view));
        mark(tab,peer,l,true);
      }
    }
    for (const [host,{people,colors,tab}] of groups) {
      if (!tab) {
        host.classList.add('has-location');
        host.title = people.join('\n');
        host.setAttribute('aria-description', people.join('. '));
        host.style.setProperty('--location-color',colors[0]);
        host.style.setProperty('--location-stripe',`linear-gradient(to bottom, ${colors.map((color,i)=>`${color} ${i/colors.length*100}% ${(i+1)/colors.length*100}%`).join(', ')})`);
        if (colors.some(color=>color !== 'var(--amber)')) host.classList.add('has-presence');
        continue;
      }
      const badge = document.createElement('span'); badge.className = tab ? 'tab-presence' : 'project-presence';
      badge.textContent = tab ? '● ' + people.join(', ') : people.join(' • ');
      badge.title = people.join('\n');
      host.append(badge); host.classList.add('has-presence');
    }
  }
  function clear() {
    document.querySelectorAll('.has-location').forEach(el=>{
      el.classList.remove('has-location'); el.removeAttribute('title'); el.removeAttribute('aria-description');
      el.style.removeProperty('--location-color'); el.style.removeProperty('--location-stripe');
    });
    document.querySelectorAll('.project-current-location').forEach(el=>el.remove());
    document.querySelectorAll('.is-current-location').forEach(el=>{
      el.classList.remove('is-current-location'); el.removeAttribute('aria-current');
    });
    document.querySelectorAll('.project-presence,.tab-presence').forEach(el=>el.remove());
    document.querySelectorAll('.has-presence').forEach(el=>el.classList.remove('has-presence'));
  }
  function schedule() { if (!frame) frame=requestAnimationFrame(paint); }
  for (const event of ['estimator:projects','estimator:view']) document.addEventListener(event,()=>{dirty=true;schedule();});
  return {update(value,id){peers=value;selfId=id;schedule();},clear(){peers=[];signature='';dirty=true;cancelAnimationFrame(frame);frame=0;clear();}};
}
