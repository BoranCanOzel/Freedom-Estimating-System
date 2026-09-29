import './shared-view.css';
import {applyTakeoffDraft} from '../shared/takeoff-draft.js';
import {createReadonlyControls} from './readonly-controls.js';
const bridge=window.estimator,key=location.hash.slice(1);
const bar=document.createElement('header');bar.id='shared-toolbar';
bar.innerHTML='<div class="shared-heading"><strong id="shared-name">Shared takeoff</strong><span id="shared-permission"></span></div><nav class="shared-navigation" aria-label="Estimate pages"><button id="shared-summary" aria-pressed="true">Summary · All pages</button><label for="shared-page">View detailed page<select id="shared-page"></select></label></nav><p id="shared-guide">Review the totals in Summary, or choose a page for its detailed breakdown.</p><div class="shared-actions"><button id="shared-reload">Reload latest</button><button id="shared-save" hidden>Save changes</button><details id="shared-notes"><summary>Scope notes</summary><div id="shared-note-text"></div></details><span id="shared-status" role="status">Loading…</span></div>';
document.body.prepend(bar);
const $=id=>document.getElementById('shared-'+id);
let data,baseline,dirty=false,applying=false,saving=false;
const takeoff=()=>bridge.getShared().lists?.[0]?.companies?.[0]?.projects?.[0]?.takeoffs?.[0];
async function request(method='GET',body){const response=await fetch('/api/shared-takeoff',{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error||'Unable to open shared takeoff.'),{status:response.status});return value;}
const readonlyControls=createReadonlyControls(document.body,bar);
function lock(){readonlyControls.setEnabled(data?.permission!=='write');}
function syncNavigation(){const here=bridge.getLocation(),summary=here.view==='summary';$('page').value=summary?'':here.sheet;$('summary').setAttribute('aria-pressed',String(summary));}
function pages(t){$('page').replaceChildren(new Option('Summary — all pages',''),...t.sheets.map((s,i)=>{const o=document.createElement('option');o.value=s.id;o.textContent=`Page ${s.num||i+1} — ${s.title||'Untitled page'}`;return o;}));syncNavigation();}
function notes(t=data.permission==='read'?data.takeoff:takeoff()){const s=t.sheets.find(s=>s.id===bridge.getLocation().sheet);$('note-text').textContent=[t.note,s?.notes,...(s?.rows||[]).filter(r=>r.note).map(r=>(r.name||'Item')+': '+r.note)].filter(Boolean).join('\n\n');}
function apply(value){
  applying=true;try{
    const here=data?bridge.getLocation():{view:'summary'};
    data=value;
    const t=value.takeoff;
    bridge.receive({lists:[{id:'shared-list',name:'Shared takeoff',companies:[{id:'shared-company',name:'',projects:[{id:'shared-project',name:'',takeoffs:[t]}]}]}]},true,{list:'shared-list',takeoff:t.id,sheet:t.sheets.find(s=>s.id===here.sheet)?.id||t.sheets[0]?.id,view:here.view==='sheet'?'sheet':'summary'});
    const displayed=value.permission==='write'?takeoff():t;
    baseline=value.permission==='write'?JSON.stringify(displayed):null;dirty=false;pages(displayed);notes(displayed);$('name').textContent=t.name||'Shared takeoff';$('permission').textContent=value.permission==='write'?'View and edit':'View only';$('save').hidden=value.permission!=='write';$('save').disabled=true;
    document.body.classList.remove('shared-loading');document.body.classList.toggle('shared-readonly',value.permission!=='write');lock();
  }finally{applying=false;}
}
window.freedomSession={changed(){if(applying||!data||data.permission!=='write')return;dirty=JSON.stringify(takeoff())!==baseline;$('save').disabled=!dirty||saving;$('status').textContent=dirty?'Unsaved changes':'Up to date';},notify(text){$('status').textContent=text;}};
function navigate(view,sheet){applying=true;try{bridge.openTakeoffPage({sheet:sheet||bridge.getLocation().sheet,view});notes();lock();}finally{applying=false;}}
$('page').onchange=()=>navigate($('page').value?'sheet':'summary',$('page').value);
$('summary').onclick=()=>navigate('summary');
document.addEventListener('estimator:view',syncNavigation);
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
(async()=>{await bridge.ready;try{apply(await request());$('status').textContent='Latest version loaded.';}catch(e){$('status').textContent=e.message;}finally{document.documentElement.classList.remove('workspace-starting');}})();
