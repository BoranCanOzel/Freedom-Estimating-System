import './scope.css';
import { mergeScope } from '../shared/scope.js';

const el = (tag, text, cls) => { const node=document.createElement(tag); if(text)node.textContent=text; if(cls)node.className=cls; return node; };
const statusLabels={included:'Included',excluded:'Excluded',ignored:'Ignored',duplicate:'Duplicate'};

export function setupScope(api, context, bridge) {
  const card=document.getElementById('scopeCard');
  card.innerHTML='<div class="head"><div class="eyebrow-row"><span class="eyebrow">Scope</span></div><div class="sum-title" id="scope-title"></div><p class="scope-description">Measured work from ZZTakeoff. Review each line before using it in your estimate.</p></div><div class="scope-content"><div class="scope-source"><label>ZZTakeoff project link<input id="scope-source" type="url" placeholder="Paste the ZZTakeoff project link"></label><button type="button" class="btn" id="scope-fetch">Fetch from ZZTakeoff</button><button type="button" class="btn alt" id="scope-connect">Connect ZZTakeoff</button></div><p id="scope-message" role="status"></p><div class="scope-tools"><label>Find an item<input id="scope-search" type="search" placeholder="Search scope items"></label><label>Show<select id="scope-filter" aria-label="Scope status"><option value="all">All items</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="ignored">Ignored</option><option value="duplicate">Duplicates</option><option value="missing">No longer in source</option></select></label><span id="scope-count"></span></div><div id="scope-results"></div></div>';
  const $=id=>document.getElementById('scope-'+id);
  let identity='',busy=false,connection=null;
  const key=()=>{const c=context();return `${c.workbook}/${c.list}/${c.takeoff}`;};
  function render() {
    if(bridge.getLocation().view!=='scope')return;
    if(identity!==key()){identity=key();$('search').value='';$('filter').value='all';$('message').textContent='';}
    const scope=bridge.getScope();
    $('title').textContent=context().name;
    if(document.activeElement!==$('source'))$('source').value=scope.link || '';
    $('fetch').disabled=busy || !context().workbook;
    $('source').disabled=busy;
    $('fetch').textContent=busy?'Fetching...':'Fetch from ZZTakeoff';
    $('connect').textContent=connection?.connected?'Reconnect ZZTakeoff':'Connect ZZTakeoff';
    const items=scope.data?.items || [], included=items.filter(item=>!item.missing&&item.status==='included').length;
    $('count').textContent=`${included} included / ${items.filter(item=>!item.missing).length} source items`;
    const query=$('search').value.trim().toLowerCase(), filter=$('filter').value;
    const visible=items.filter(item=>(!query||`${item.name} ${item.group} ${item.measurements}`.toLowerCase().includes(query))&&(filter==='all'||(filter==='missing'?item.missing:!item.missing&&item.status===filter)));
    const results=$('results');results.replaceChildren();
    if(!items.length){
      const empty=el('div','','scope-empty');empty.append(el('h3','Bring your measured scope into this takeoff'),el('p','Connect ZZTakeoff, add the project link, then fetch its items. Each line can be excluded, ignored, or marked as a duplicate.'));results.append(empty);return;
    }
    const stamp=el('p','','scope-stamp');
    stamp.textContent=scope.data.fetchedAt?'Last fetched '+new Date(scope.data.fetchedAt).toLocaleString():'';results.append(stamp);
    if(!visible.length){results.append(el('p','No items match this view.','scope-empty'));return;}
    const table=el('table','','scope-table');table.innerHTML='<thead><tr><th scope="col">Scope item</th><th scope="col">Measurements</th><th scope="col">Status</th><th scope="col" class="scope-actions-heading">Review</th></tr></thead>';
    const body=el('tbody');table.append(body);
    for(const item of visible){
      const row=el('tr');row.dataset.scopeItem=item.id;row.dataset.status=item.status;
      const name=el('td');name.append(el('strong',item.name));if(item.group)name.append(el('small',item.group));
      const status=el('td');status.append(el('span',item.missing?'No longer in source':statusLabels[item.status]||'Included','scope-status'));
      const actions=el('td','','scope-actions');
      for(const [value,label] of [['excluded','Exclude'],['ignored','Ignore'],['duplicate','Mark duplicate']]){
        const button=el('button',label,'btn alt tiny');button.type='button';button.dataset.scopeAction=value;
        button.setAttribute('aria-pressed',String(item.status===value));button.setAttribute('aria-label',label+' '+item.name);
        button.title=item.status===value?'Click again to include this item':label;
        button.onclick=()=>{
          bridge.setScopeItemStatus(item.id,item.status===value?'included':value);render();
          const restored=[...results.querySelectorAll('[data-scope-item]')].find(r=>r.dataset.scopeItem===item.id);
          restored?.querySelector(`[data-scope-action="${value}"]`)?.focus({preventScroll:true});
        };
        actions.append(button);
      }
      row.append(name,el('td',item.measurements||'Not supplied','scope-measurements'),status,actions);body.append(row);
    }
    const scroll=el('div','','scope-table-scroll');scroll.append(table);results.append(scroll);
  }
  $('search').oninput=render;$('filter').onchange=render;
  $('source').onchange=()=>{bridge.setScopeLink($('source').value.trim());render();};
  async function checkConnection(){try{connection=await api('/zztakeoff/status');render();}catch{/* Fetch displays authentication errors when needed. */}}
  $('connect').onclick=async()=>{
    $('connect').disabled=true;
    // Open synchronously so browsers allow the sign-in window.
    const popup=window.open('about:blank','freedom-zztakeoff','width=650,height=780');
    try{
      const result=await api('/zztakeoff/connect',{method:'POST',body:'{}'});
      if(popup)popup.location=result.url;else window.location.assign(result.url);
      $('message').textContent='Finish signing in to ZZTakeoff, then fetch your scope.';
    }catch(error){popup?.close();$('message').textContent=error.message;}
    finally{$('connect').disabled=false;}
  };
  window.addEventListener('message',event=>{if(event.origin===location.origin&&event.data?.type==='zztakeoff-connected'){checkConnection();$('message').textContent=event.data.error||'ZZTakeoff connected. You can now fetch your scope.';}});
  $('fetch').onclick=async()=>{
    const target=key(),link=$('source').value.trim();
    bridge.setScopeLink(link);
    if(!link){$('message').textContent='Add the ZZTakeoff project link first.';$('source').focus();return;}
    busy=true;$('message').textContent='Reading scope items from ZZTakeoff...';render();
    try{
      const response=await api('/zztakeoff/scope',{method:'POST',body:JSON.stringify({link})});
      if(target!==key())return;
      const merged=mergeScope(bridge.getScope().data,response);
      bridge.setScopeData(merged);
      $('message').textContent=`Fetched ${response.items.length} items. Your review marks have been kept.`;
    }catch(error){if(target===key())$('message').textContent=error.message;}
    finally{busy=false;render();}
  };
  document.addEventListener('estimator:view',()=>{render();if(bridge.getLocation().view==='scope')checkConnection();});
  document.addEventListener('estimator:projects',render);
  window.addEventListener('focus',()=>{if(bridge.getLocation().view==='scope')checkConnection();});
  render();
}
