import './scope.css';
import { mergeScope } from '../shared/scope.js';

const el = (tag, text, cls) => { const node=document.createElement(tag); if(text)node.textContent=text; if(cls)node.className=cls; return node; };
const statusLabels={included:'Included',excluded:'Excluded',ignored:'Ignored',duplicate:'Duplicate'};

export function setupScope(api, context, bridge) {
  const card=document.getElementById('scopeCard');
  card.innerHTML='<div class="head"><div class="eyebrow-row"><span class="eyebrow">Scope</span></div><div class="sum-title" id="scope-title"></div><p class="scope-description">Measured work from ZZTakeoff. Review each line before using it in your estimate.</p></div><div class="scroll scope-content"><section id="scope-page-colours" aria-label="Estimating page colours"></section><div class="scope-source"><label>ZZTakeoff project link<input id="scope-source" type="url" placeholder="Paste the ZZTakeoff project link"></label><button type="button" class="btn" id="scope-fetch">Fetch from ZZTakeoff</button><button type="button" class="btn alt" id="scope-connect">Connect ZZTakeoff</button></div><label class="scope-ai-access"><input type="checkbox" id="scope-ai-access"> Allow AI to read Scope</label><p id="scope-message" role="status"></p><div class="scope-tools"><label>Find an item<input id="scope-search" type="search" placeholder="Search scope items"></label><label>Show<select id="scope-filter" aria-label="Scope status"><option value="all">All items</option><option value="included">Included</option><option value="excluded">Excluded</option><option value="ignored">Ignored</option><option value="duplicate">Duplicates</option></select></label><span id="scope-count"></span></div><div id="scope-results"></div></div>';
  const $=id=>document.getElementById('scope-'+id);
  let identity='',busy=false,connection=null;
  const key=()=>{const c=context();return `${c.workbook}/${c.list}/${c.takeoff}`;};
  function render() {
    if(bridge.getLocation().view!=='scope')return;
    if(identity!==key()){identity=key();$('search').value='';$('filter').value='all';$('message').textContent='';}
    const focused=document.activeElement?.matches('.scope-item-note')?document.activeElement:null;
    const editing=focused?{id:focused.closest('[data-scope-item]').dataset.scopeItem,start:focused.selectionStart,end:focused.selectionEnd,scroll:focused.scrollTop}:null;
    const scope=bridge.getScope();
    const pageColours=$('page-colours');pageColours.replaceChildren(el('h3','Estimating page colours'));
    const pageList=el('div','','scope-page-colours-list');
    const estimatePages=bridge.getScopePages();
    for(const page of estimatePages){
      const entry=el('div','','scope-page-colour');
      entry.append(bridge.scopeColorControl(page.id),el('span',page.num+' - '+(page.title||'Untitled page')));
      pageList.append(entry);
    }
    pageColours.append(el('p','Click a colour to change it. Assign scope items to an estimate page below to use that colour.','scope-description'),pageList);
    $('ai-access').checked=scope.aiAccess===true;
    $('title').textContent=context().name;
    if(document.activeElement!==$('source'))$('source').value=scope.link || '';
    $('fetch').disabled=busy || !context().workbook;
    $('source').disabled=busy;
    $('fetch').textContent=busy?'Fetching...':'Fetch from ZZTakeoff';
    $('connect').textContent=connection?.connected?'Reconnect ZZTakeoff':'Connect ZZTakeoff';
    // Older saved snapshots can still contain retained, removed source rows.
    const items=(scope.data?.items || []).filter(item=>!item.missing), included=items.filter(item=>item.status==='included').length;
    $('count').textContent=`${included} included / ${items.length} source items`;
    const query=$('search').value.trim().toLowerCase(), filter=$('filter').value;
    const visible=items.filter(item=>(!query||`${item.name} ${item.group} ${item.measurements} ${item.note||""} ${(item.pages||[]).map(p=>p.name).join(" ")}`.toLowerCase().includes(query))&&(filter==='all'||item.status===filter));
    const results=$('results');results.replaceChildren();
    if(!items.length){
      const empty=el('div','','scope-empty');empty.append(el('h3','Bring your measured scope into this takeoff'),el('p','Connect ZZTakeoff, add the project link, then fetch its items. Each line can be excluded, ignored, or marked as a duplicate.'));results.append(empty);return;
    }
    const stamp=el('p','','scope-stamp');
    stamp.textContent=scope.data.fetchedAt?'Last fetched '+new Date(scope.data.fetchedAt).toLocaleString():'';results.append(stamp);
    if(!visible.length){results.append(el('p','No items match this view.','scope-empty'));return;}
    const groupKey=item=>JSON.stringify((item.pages||[]).map(p=>p.id).sort());
    function showAiCheckbox(members,label){
      const wrap=el('label','','scope-show-ai'),input=el('input');input.type='checkbox';input.setAttribute('aria-label',label);
      const checked=members.filter(item=>item.showAi!==false).length;
      input.checked=members.length>0&&checked===members.length;input.indeterminate=checked>0&&checked<members.length;
      input.onchange=()=>{
        bridge.setScopeItemsAiVisibility(members.map(item=>item.id),input.checked);render();
        [...results.querySelectorAll('input[type=checkbox]')].find(el=>el.getAttribute('aria-label')===label)?.focus({preventScroll:true});
      };
      wrap.append(input,document.createTextNode('Show AI'));return wrap;
    }
    const table=el('table','','sum-table scope-table');table.innerHTML='<thead><tr><th scope="col">Scope item</th><th scope="col">Measurements</th><th scope="col">Status</th><th scope="col" class="scope-actions-heading">Review</th><th scope="col" class="scope-ai-heading"></th></tr></thead>';
    table.querySelector('.scope-ai-heading').append(showAiCheckbox(items,'Show all Scope items to AI'));
    const groups=new Map();
    for(const item of visible){
      const pages=item.pages||[],key=groupKey(item);
      if(!groups.has(key))groups.set(key,{pages,items:[]});
      groups.get(key).items.push(item);
    }
    for(const {pages,items:pageItems} of groups.values()){
      const body=el('tbody');table.append(body);
      const header=el('tr','','scope-page-heading'),cell=el('th');cell.colSpan=4;cell.scope='rowgroup';
      cell.textContent=pages.length?(pages.length>1?'Shared across pages: ':'')+pages.map(p=>p.name).join(' / '):'No source page assigned';
      const aiCell=el('th');aiCell.append(showAiCheckbox(items.filter(item=>groupKey(item)===groupKey(pageItems[0])),'Show page group '+cell.textContent+' to AI'));
      header.append(cell,aiCell);body.append(header);
      for(const item of pageItems){
      const row=el('tr');row.dataset.scopeItem=item.id;row.dataset.status=item.status;
      const assigned=estimatePages.find(page=>page.id===scope.assignments[item.id]);
      const colour=bridge.scopeColorValue(assigned?.color);
      if(colour){row.style.setProperty('--scope-item-colour',colour);row.classList.add('scope-coloured');}
      const name=el('td');name.append(el('strong',item.name));if(item.group)name.append(el('small',item.group));
      const note=el('textarea','','scope-item-note');note.rows=2;note.maxLength=10000;note.placeholder='Add a note...';note.value=item.note||'';
      note.setAttribute('aria-label','Notes for '+item.name);
      note.oninput=()=>bridge.setScopeItemNote(item.id,note.value);
      name.append(note);
      const assignment=el('label','','scope-assignment');assignment.append(el('span','Estimate page'));
      const select=el('select');select.setAttribute('aria-label','Estimate page for '+item.name);
      select.add(new Option('Unassigned',''));
      for(const page of estimatePages)select.add(new Option(page.num+' - '+(page.title||'Untitled page'),page.id));
      select.value=assigned?.id || '';
      select.onchange=()=>{bridge.setScopePage(item.id,select.value);render();};
      assignment.append(select);name.append(assignment);
      const status=el('td');status.append(el('span',item.missing?'No longer in source':statusLabels[item.status]||'Included','scope-status'));
      const actions=el('td','','scope-actions');
      for(const [value,label] of [['excluded','Exclude'],['ignored','Ignore'],['duplicate','Duplicate']]){
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
      const aiCell=el('td');aiCell.append(showAiCheckbox([item],'Show '+item.name+' to AI'));
      row.append(name,el('td',item.measurements||'Not supplied','scope-measurements'),status,actions,aiCell);body.append(row);
    }
    }
    const scroll=el('div','','scope-table-scroll');scroll.append(table);results.append(scroll);
    if(editing){
      const restored=[...results.querySelectorAll('[data-scope-item]')].find(row=>row.dataset.scopeItem===editing.id)?.querySelector('.scope-item-note');
      if(restored){restored.focus({preventScroll:true});restored.setSelectionRange(editing.start,editing.end);restored.scrollTop=editing.scroll;}
    }
  }
  $('ai-access').onchange=()=>{bridge.setScopeAiAccess($('ai-access').checked);render();};
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
    busy=true;$('message').textContent='Connecting to ZZTakeoff. Keep the linked project open there and respond to any connection or read-access prompt.';render();
    try{
      const job=await api('/zztakeoff/scope/jobs',{method:'POST',body:JSON.stringify({link})});
      let response;
      const started=Date.now();
      while(true){
        if(target!==key())return;
        const progress=await api('/zztakeoff/scope/jobs/'+encodeURIComponent(job.id));
        if(progress.state==='failed')throw Error(progress.error);
        if(progress.state==='complete'){response=progress.result;break;}
        $('message').textContent='Fetching: '+(progress.stage||'waiting for ZZTakeoff')+'. Keep the linked project open in ZZTakeoff and respond to any connection or read-access prompt.';
        if(Date.now()-started>8*60000)throw Error('ZZTakeoff has not finished responding. Check its open project tab, then fetch again. Your saved scope is unchanged.');
        await new Promise(resolve=>setTimeout(resolve,1500));
      }
      if(target!==key())return;
      const merged=mergeScope(bridge.getScope().data,response);
      bridge.setScopeData(merged);
      $('message').textContent=`Fetched ${response.items.length} items. Your review marks and notes have been kept.`;
    }catch(error){if(target===key())$('message').textContent=error.message;}
    finally{busy=false;render();}
  };
  document.addEventListener('estimator:view',()=>{render();if(bridge.getLocation().view==='scope')checkConnection();});
  document.addEventListener('estimator:projects',render);
  window.addEventListener('focus',()=>{if(bridge.getLocation().view==='scope')checkConnection();});
  render();
}
