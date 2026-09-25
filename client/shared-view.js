import './shared-view.css';
import {applyTakeoffDraft} from '../shared/takeoff-draft.js';
const bridge=window.estimator,key=location.hash.slice(1);
const bar=document.createElement('header');bar.id='shared-toolbar';
bar.innerHTML='<strong id="shared-name">Shared takeoff</strong><span id="shared-permission"></span><label>Page <select id="shared-page"></select></label><button id="shared-summary">Summary</button><button id="shared-reload">Reload latest</button><button id="shared-save" hidden>Save changes</button><details id="shared-notes"><summary>Scope notes</summary><div id="shared-note-text"></div></details><span id="shared-status" role="status">Loading…</span>';
document.body.prepend(bar);
const $=id=>document.getElementById('shared-'+id);
let data,baseline,dirty=false,applying=false,saving=false;
const takeoff=()=>bridge.getShared().lists?.[0]?.companies?.[0]?.projects?.[0]?.takeoffs?.[0];
async function request(method='GET',body){const response=await fetch('/api/shared-takeoff',{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'Unable to open shared takeoff.'),{status:response.status});return value;}
function lock(){
  if(data?.permission==='write')return;
  for(const el of document.querySelectorAll('input,textarea,select,button,[contenteditable]')){
    if(el.closest('#shared-toolbar'))continue;
    if(el.matches('input,textarea'))el.readOnly=true;else if(el.matches('select,button'))el.disabled=true;else el.contentEditable='false';
  }
}
const observer=new MutationObserver(lock);observer.observe(document.querySelector('.sheet'),{childList:true,subtree:true});
function pages(){const t=takeoff();$('page').replaceChildren(...t.sheets.map(s=>{const o=document.createElement('option');o.value=s.id;o.textContent=`${s.num||''}. ${s.title||'Untitled page'}`;return o;}));$('page').value=bridge.getLocation().sheet;}
function notes(){const t=takeoff(),s=t.sheets.find(s=>s.id===bridge.getLocation().sheet);$('note-text').textContent=[t.note,s?.notes,...(s?.rows||[]).filter(r=>r.note).map(r=>(r.name||'Item')+': '+r.note)].filter(Boolean).join('\n\n');}
function apply(value){
  applying=true;try{
    data=value;
    const t=value.takeoff;
    bridge.receive({lists:[{id:'shared-list',name:'Shared takeoff',companies:[{id:'shared-company',name:'',projects:[{id:'shared-project',name:'',takeoffs:[t]}]}]}]},true,{list:'shared-list',takeoff:t.id,sheet:t.sheets[0]?.id,view:'sheet'});
    baseline=JSON.stringify(takeoff());dirty=false;pages();notes();$('name').textContent=t.name||'Shared takeoff';$('permission').textContent=value.permission==='write'?'View and edit':'View only';$('save').hidden=value.permission!=='write';$('save').disabled=true;
    document.body.classList.remove('shared-loading');document.body.classList.toggle('shared-readonly',value.permission!=='write');lock();
  }finally{applying=false;}
}
window.freedomSession={changed(){if(applying||!data||data.permission!=='write')return;dirty=JSON.stringify(takeoff())!==baseline;$('save').disabled=!dirty||saving;$('status').textContent=dirty?'Unsaved changes':'Up to date';},notify(text){$('status').textContent=text;}};
function navigate(view,sheet){applying=true;try{bridge.openLocation({list:'shared-list',takeoff:data.takeoff.id,sheet:sheet||bridge.getLocation().sheet,view});notes();lock();}finally{applying=false;}}
$('page').onchange=()=>navigate('sheet',$('page').value);
$('summary').onclick=()=>navigate('summary');
$('reload').onclick=async()=>{if(dirty&&!confirm('Discard your unsaved changes and load the latest takeoff?'))return;try{apply(await request());$('status').textContent='Latest version loaded.';}catch(e){$('status').textContent=e.message;if([401,403,404].includes(e.status)){data.permission='read';lock();$('save').disabled=true;}}};
$('save').onclick=async()=>{
  if(!dirty||saving)return;saving=true;$('save').disabled=true;
  // Keep takeoff root fields not editable through this view exactly as received.
  const draft=structuredClone(data.takeoff),edited=applyTakeoffDraft(data.takeoff,JSON.parse(baseline),takeoff());for(const field of ['name','note','custom','sheets'])if(edited[field]!==undefined)draft[field]=structuredClone(edited[field]);
  document.querySelector('.sheet').inert=true;
  try{apply(await request('PUT',{revision:data.revision,takeoff:draft}));$('status').textContent='Changes saved.';}
  catch(e){$('status').textContent=e.message;}
  finally{saving=false;document.querySelector('.sheet').inert=false;$('save').disabled=!dirty;}
};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('hashchange',()=>location.reload());
// Disable editor shortcuts too; read-only enforcement also happens on every server write.
document.addEventListener('keydown',e=>{if(data?.permission==='write'||e.target.closest('#shared-toolbar'))return;if((e.ctrlKey||e.metaKey)&&['c','a'].includes(e.key.toLowerCase()))return;if(['Tab','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','PageUp','PageDown','Home','End','Escape'].includes(e.key))return;e.stopImmediatePropagation();},true);
(async()=>{await bridge.ready;try{apply(await request());$('status').textContent='Latest version loaded.';}catch(e){$('status').textContent=e.message;}})();
