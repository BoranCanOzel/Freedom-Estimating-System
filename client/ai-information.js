import { aiDataMethods, aiDataMethodLabel, aiDataWorkTypes, normalizeAiDataWorkTypes } from '../shared/ai-data.js';
import './ai-information.css';

export function setupAiInformation(api,openEstimate) {
  const button=document.createElement('button');button.id='ai-information-open';button.type='button';button.textContent='AI Information';
  button.setAttribute('aria-pressed','false');
  document.getElementById('workspace-menus').append(button);
  const page=document.createElement('section');page.id='ai-information-page';page.hidden=true;page.setAttribute('aria-label','AI Information');
  page.innerHTML=`<header><div><p class="ai-info-eyebrow">SHARED REFERENCE LIBRARY</p><h1>AI Information</h1><p>One place for the knowledge your AI should read first. Shared across all workbooks.</p></div><button type="button" data-action="close">Back to estimating</button></header>
    <div class="ai-info-layout"><aside><div class="ai-info-tools"><button type="button" data-action="folder">+ Folder</button><button type="button" data-action="entry">+ Text entry</button></div><label>Find information<input type="search" id="ai-info-search" placeholder="Search titles and text"></label><nav id="ai-info-tree" aria-label="Information folders and entries"></nav></aside>
    <main><div id="ai-info-empty"><h2>Your company knowledge, organized your way.</h2><p>Create a folder for any topic, then add text entries. For example: production rates, estimating standards, or proposal wording. Choose only the topics your team uses.</p><p>Text only. No file uploads or attachments.</p></div>
    <form id="ai-info-editor" hidden><p id="ai-info-kind" class="ai-info-eyebrow"></p><label>Title<input id="ai-info-title" required maxlength="160" placeholder="Give this information a clear name"></label><label>Folder<select id="ai-info-parent"></select></label><label id="ai-info-text-label">Reference text<textarea id="ai-info-text" maxlength="100000" rows="18" placeholder="Write the guidance the AI should use. For production rates, include the task, rate, units, crew size, conditions, and exceptions."></textarea></label><div class="ai-info-tools"><button type="submit" id="ai-info-save">Save changes</button><button type="button" data-action="delete">Delete</button></div></form>
    </main></div><footer><span id="ai-info-status" role="status"></span><button type="button" data-action="reload">Reload library</button></footer>`;
  document.body.append(page);
  const $=id=>page.querySelector('#ai-info-'+id);
  const libraryPanel=page.querySelector('.ai-info-layout');libraryPanel.id='ai-info-library-panel';libraryPanel.setAttribute('role','tabpanel');libraryPanel.setAttribute('aria-labelledby','ai-info-library-tab');
  const tabs=document.createElement('div');tabs.className='ai-info-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','AI Information views');
  tabs.innerHTML='<button type="button" role="tab" id="ai-info-library-tab" aria-controls="ai-info-library-panel" aria-selected="true">Text library</button><button type="button" role="tab" id="ai-info-data-tab" aria-controls="ai-info-data-panel" aria-selected="false" tabindex="-1">AI Data</button>';
  libraryPanel.before(tabs);
  const dataPanel=document.createElement('section');dataPanel.id='ai-info-data-panel';dataPanel.hidden=true;dataPanel.setAttribute('role','tabpanel');dataPanel.setAttribute('aria-labelledby','ai-info-data-tab');
  dataPanel.innerHTML=`<div class="ai-data-heading"><div><p class="ai-info-eyebrow">ESTIMATE REFERENCES</p><h2>AI Data estimates</h2><p>Find past estimates by pricing method and work type. Open an estimate to review its pages or update its labels.</p></div><span class="ai-data-sharing">Shared with AI</span></div>
    <div class="ai-data-filters"><label class="ai-data-search">Find an estimate<input id="ai-info-data-search" type="search" placeholder="Search estimates, jobs, customers..."></label><label>Pricing method<select id="ai-info-data-method"><option value="all">All methods</option><option value="">Not specified</option></select></label><label>Work type<select id="ai-info-data-work-type"><option value="all">All work types</option><option value="concrete-pour">Concrete pour</option><option value="demo">Demo</option><option value="saw-cutting">Saw cutting</option><option value="both">Concrete pour + Demo</option><option value="">Not specified</option></select></label></div>
    <div class="ai-data-results-bar"><p id="ai-info-data-count" role="status"></p><button type="button" id="ai-info-data-reset">Clear filters</button></div><div id="ai-info-data-results"></div>`;
  libraryPanel.after(dataPanel);
  const keysTab=document.createElement('button');keysTab.type='button';keysTab.id='ai-info-keys-tab';keysTab.textContent='Access keys';keysTab.setAttribute('role','tab');keysTab.setAttribute('aria-controls','ai-info-keys-panel');keysTab.setAttribute('aria-selected','false');keysTab.tabIndex=-1;tabs.append(keysTab);
  const keysPanel=document.createElement('section');keysPanel.id='ai-info-keys-panel';keysPanel.hidden=true;keysPanel.setAttribute('role','tabpanel');keysPanel.setAttribute('aria-labelledby',keysTab.id);
  keysPanel.innerHTML='<div class="ai-keys-heading"><div><h2>AI access keys</h2><p>Manage active AI keys across all workbooks. Users are grouped by who generated each key.</p><p id="ai-info-keys-count"></p></div><button type="button" id="ai-info-keys-revoke-all">Revoke all server keys</button></div><div id="ai-info-keys-users"></div><p class="ai-keys-hint">Revocation takes effect immediately. Existing estimates and AI change history are kept. Generate a new key from a takeoff to restore AI access.</p>';
  dataPanel.after(keysPanel);
  async function loadKeys(){
    message('Loading AI access keys...');const data=await request('/ai-access');
    $('keys-count').textContent=data.active+' active AI '+(data.active===1?'key':'keys');
    $('keys-revoke-all').dataset.unavailable=String(!data.active);$('keys-revoke-all').disabled=busy||!data.active;
    $('keys-users').replaceChildren();
    for(const user of data.users){
      const row=document.createElement('article'),info=document.createElement('div'),name=document.createElement('strong'),count=document.createElement('span'),revoke=document.createElement('button');row.className='ai-keys-user';
      name.textContent=user.name;count.textContent=user.active+' active '+(user.active===1?'key':'keys');info.append(name,count);
      revoke.type='button';revoke.textContent='Revoke all for user';revoke.setAttribute('aria-label','Revoke all AI keys for '+user.name);revoke.dataset.unavailable=String(!user.active);revoke.disabled=busy||!user.active;
      revoke.onclick=()=>revokeKeys('user',user.name);row.append(info,revoke);$('keys-users').append(row);
    }
    if(!data.users.length)$('keys-users').textContent='No AI access keys have been created.';
    message('');
  }
  function revokeKeys(scope,user){
    const question=scope==='server'?'Revoke every active AI access key on this server for all users and workbooks?':'Revoke all AI access keys created by '+user+' across every workbook?';
    if(!confirm(question+' Connected AI tools will lose access until new keys are generated.'))return;
    run(async()=>{const result=await request('/ai-access/revoke',{method:'POST',body:JSON.stringify({scope,...(scope==='user'?{user}:{})})});await loadKeys();message('Revoked '+result.revoked+' AI access '+(result.revoked===1?'key.':'keys.'));});
  }
  $('keys-revoke-all').onclick=()=>revokeKeys('server');
  for(const [value,label] of aiDataMethods)$('data-method').add(new Option(label,value));
  let activeTab='library',estimates=[];
  function renderEstimates(){
    const query=$('data-search').value.trim().toLowerCase();
    const workType=$('data-work-type').value;
    const matchesWorkType=item=>{
      const types=normalizeAiDataWorkTypes(item.aiDataWorkTypes);
      return workType==='all'||(workType==='both'?types.includes('concrete-pour')&&types.includes('demo'):workType?types.includes(workType):!types.length);
    };
    const matches=estimates.filter(item=>matchesWorkType(item)&&($('data-method').value==='all'||(item.aiDataMethod||'')===$('data-method').value)&&[item.workbookName,item.listName,item.companyName,item.projectName,item.takeoffName].some(value=>value.toLowerCase().includes(query)));
    $('data-count').textContent=`${matches.length} of ${estimates.length} estimates across all workbooks`;
    $('data-results').replaceChildren();
    for(const item of matches){
      const row=document.createElement('article');row.className='ai-info-estimate';
      const info=document.createElement('div'),title=document.createElement('h3'),name=document.createElement('p'),context=document.createElement('p');
      title.textContent=item.takeoffName;name.textContent=item.projectName;name.className='ai-info-estimate-project';context.className='ai-info-estimate-context';
      context.textContent=`${item.companyName} · ${item.workbookName} / ${item.listName} · ${item.pages} page${item.pages===1?'':'s'}`;
      const tags=document.createElement('div');tags.className='ai-data-tags';
      const method=document.createElement('span');method.className='ai-data-tag';
      method.textContent='Pricing method: '+aiDataMethodLabel(item.aiDataMethod);
      tags.append(method);
      if(item.aiDataNightWork===true){
        const night=document.createElement('span');night.className='ai-data-tag';night.textContent='Night time work';tags.append(night);
      }
      if(item.aiDataPrevailingWage===true){
        const wage=document.createElement('span');wage.className='ai-data-tag';wage.textContent='Prevailing wage';tags.append(wage);
      }
      const types=normalizeAiDataWorkTypes(item.aiDataWorkTypes);
      for(const [id,label] of aiDataWorkTypes)if(types.includes(id)){
        const tag=document.createElement('span');tag.className='ai-data-tag';tag.dataset.workType=id;tag.textContent=label;tags.append(tag);
      }
      if(!types.length){const tag=document.createElement('span');tag.className='ai-data-tag';tag.textContent='Work type: Not specified';tags.append(tag);}
      info.append(title,name,context,tags);
      const open=document.createElement('button');open.type='button';open.textContent='Open estimate';open.setAttribute('aria-label','Open estimate: '+item.takeoffName);
      open.onclick=()=>run(async()=>{if(!discard())return;const signal=operation?.signal;await openEstimate(item);signal?.throwIfAborted();closePage();});
      row.append(info,open);$('data-results').append(row);
    }
    $('data-reset').hidden=!query&&$('data-method').value==='all'&&workType==='all';
    if(!matches.length){
      const empty=document.createElement('div');empty.className='ai-data-empty';
      const heading=document.createElement('h3'),hint=document.createElement('p');
      heading.textContent=estimates.length?'No matching estimates':'Build your estimate reference library';
      hint.textContent=estimates.length?'Try a different search or clear your filters.':'Enable AI Data on a takeoff, then choose its pricing method and work types. Its pages will appear here for AI to reference.';
      empty.append(heading,hint);$('data-results').append(empty);
    }
  }
  async function loadEstimates(){message('Loading AI Data estimates...');const data=await request('/ai-information/estimates');estimates=data.estimates;renderEstimates();message('');}
  function setTab(tab){
    activeTab=tab;libraryPanel.hidden=tab!=='library';dataPanel.hidden=tab!=='data';keysPanel.hidden=tab!=='keys';
    for(const name of ['library','data','keys']){$(name+'-tab').setAttribute('aria-selected',String(tab===name));$(name+'-tab').tabIndex=tab===name?0:-1;}
    page.querySelector('[data-action="reload"]').textContent=tab==='keys'?'Refresh keys':tab==='data'?'Refresh estimates':'Reload library';
  }
  for(const tab of ['library','data','keys'])$(tab+'-tab').onclick=()=>run(async()=>{setTab(tab);if(tab==='data')await loadEstimates();else if(tab==='keys')await loadKeys();else message(dirty?'Unsaved changes.':'');});
  tabs.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&!busy){event.preventDefault();const names=['library','data','keys'],tab=event.key==='Home'?names[0]:event.key==='End'?names.at(-1):names[(names.indexOf(activeTab)+(event.key==='ArrowRight'?1:-1)+names.length)%names.length];$(tab+'-tab').click();setTimeout(()=>$(tab+'-tab').focus(),0);}};
  $('data-reset').onclick=()=>{$('data-search').value='';$('data-method').value='all';$('data-work-type').value='all';renderEstimates();};
  $('data-search').oninput=renderEstimates;
  $('data-method').onchange=renderEstimates;
  $('data-work-type').onchange=renderEstimates;
  let library={items:[],revision:''},savedLibrary=structuredClone(library),selected='',dirty=false,busy=false;
  const hiddenContent=[];
  function background(hidden){
    if(hidden){for(const el of document.body.children)if(el!==page&&el.id!=='server-bar'&&!el.inert){el.inert=true;hiddenContent.push(el);}}
    else{for(const el of hiddenContent)el.inert=false;hiddenContent.length=0;}
  }
  new ResizeObserver(()=>page.style.setProperty('--ai-info-top',document.getElementById('server-bar').getBoundingClientRect().bottom+'px')).observe(document.getElementById('server-bar'));
  const item=()=>library.items.find(i=>i.id===selected);
  const message=text=>$('status').textContent=text;
  const discard=()=>{if(!dirty)return true;if(!confirm('Discard your unsaved AI Information changes?'))return false;library=structuredClone(savedLibrary);dirty=false;return true;};
  const path=value=>{const names=[],seen=new Set();let current=value;while(current&&!seen.has(current)){seen.add(current);const found=library.items.find(i=>i.id===current);if(!found)break;names.unshift(found.title);current=found.parent;}return names.join(' / ');};
  const descendants=id=>{const result=new Set([id]);let changed=true;while(changed){changed=false;for(const i of library.items)if(result.has(i.parent)&&!result.has(i.id)){result.add(i.id);changed=true;}}return result;};
  const rootDrop=document.createElement('div');rootDrop.id='ai-info-root-drop';rootDrop.textContent='Library (top level)';
  const dragHint=document.createElement('p');dragHint.className='ai-info-drag-hint';dragHint.textContent='Drag into a folder or between entries to organize. Moves save immediately. Save text edits before dragging.';
  $('tree').before(rootDrop,dragHint);
  let dragged='';
  function clearDrop(){page.querySelectorAll('[data-drop]').forEach(el=>delete el.dataset.drop);}
  function endDrag(){dragged='';clearDrop();page.querySelectorAll('.ai-info-dragging').forEach(el=>el.classList.remove('ai-info-dragging'));}
  function destination(event,target){
    if(!dragged||busy||dirty)return null;
    if(!target)return {parent:'',mode:'inside',target:''};
    if(descendants(dragged).has(target.id))return null;
    const rect=event.currentTarget.getBoundingClientRect(),fraction=(event.clientY-rect.top)/rect.height;
    const mode=target.kind==='folder'&&fraction>=.25&&fraction<=.75?'inside':fraction<.5?'before':'after';
    return {parent:mode==='inside'?target.id:target.parent,mode,target:target.id};
  }
  function dropTarget(element,target){
    element.ondragover=event=>{
      clearDrop();const move=destination(event,target);
      if(!move){if(event.dataTransfer)event.dataTransfer.dropEffect='none';return;}
      event.preventDefault();event.dataTransfer.dropEffect='move';element.dataset.drop=move.mode;
    };
    element.ondragleave=()=>{delete element.dataset.drop;};
    element.ondrop=event=>{
      const move=destination(event,target),id=dragged;endDrag();
      if(!move)return;event.preventDefault();
      run(async()=>{
        const source=library.items.find(i=>i.id===id);if(!source)return;
        const items=library.items.filter(i=>i.id!==id),moved={...source,parent:move.parent};
        if(move.mode==='inside')items.push(moved);
        else{const index=items.findIndex(i=>i.id===move.target);items.splice(index+(move.mode==='after'?1:0),0,moved);}
        if(JSON.stringify(items)===JSON.stringify(library.items))return;
        await persist(items);
      });
    };
  }
  dropTarget(rootDrop,null);
  function tree(){
    $('tree').replaceChildren();const query=$('search').value.toLowerCase().trim();
    const visited=new Set();
    const add=(parent,depth)=>{for(const i of library.items.filter(i=>i.parent===parent)){
      if(visited.has(i.id))continue;visited.add(i.id);
      if(!query||(i.title+' '+i.text+' '+path(i.parent)).toLowerCase().includes(query)){
        const row=document.createElement('button');row.type='button';row.className='ai-info-tree-item';row.style.paddingLeft=(12+depth*18)+'px';row.textContent=(i.kind==='folder'?'▸  ':'—  ')+i.title;row.title=path(i.id);row.setAttribute('aria-pressed',String(i.id===selected));
        row.dataset.id=i.id;row.draggable=true;
        row.ondragstart=event=>{
          if(busy||dirty){event.preventDefault();if(dirty)message('Save your text edits before moving folders or entries.');return;}
          dragged=i.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-freedom-ai-item',i.id);row.classList.add('ai-info-dragging');
        };
        row.ondragend=endDrag;dropTarget(row,i);
        row.onclick=()=>{if(busy||!discard())return;selected=i.id;dirty=false;render();};$('tree').append(row);
      }
      if(i.kind==='folder')add(i.id,depth+1);
    }};add('',0);
    if(!$('tree').children.length)$('tree').textContent=query?'No matching information.':'No folders yet. Start with + Folder.';
  }
  function render(){
    tree();const current=item();$('editor').hidden=!current;$('empty').hidden=!!current;
    if(!current)return;
    $('kind').textContent=current.kind==='folder'?'FOLDER':'TEXT ENTRY';$('title').value=current.title;$('text').value=current.text;$('text-label').hidden=current.kind==='folder';
    $('parent').replaceChildren(new Option('Library (top level)',''));
    const excluded=descendants(current.id);
    for(const folder of library.items.filter(i=>i.kind==='folder'&&!excluded.has(i.id)))$('parent').add(new Option(path(folder.id),folder.id));
    $('parent').value=current.parent;
  }
  let operation=null;
  function setBusy(value){
    busy=value;
    if(value)page.setAttribute('aria-busy','true');else page.removeAttribute('aria-busy');
    page.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=(value&&e.dataset.action!=='close')||e.dataset.unavailable==='true');
  }
  async function request(path,options={}){
    const signal=operation?.signal;
    const result=await api(path,{...options,signal});
    signal?.throwIfAborted();
    return result;
  }
  async function run(fn){
    if(busy)return;
    const controller=new AbortController();operation=controller;setBusy(true);
    const timer=setTimeout(()=>controller.abort(new Error('The request timed out. Your unsaved edits are still here. If you were saving, reload the library to check whether the save completed before retrying.')),20000);
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
    try{await Promise.race([fn(),aborted]);}
    catch(error){if(operation===controller&&!page.hidden)message(error.message);}
    finally{clearTimeout(timer);if(operation===controller){operation=null;setBusy(false);}}
  }
  async function reload(){library=await request('/ai-information');savedLibrary=structuredClone(library);dirty=false;if(!item())selected='';render();message('Library loaded.');}
  async function persist(items){library=await request('/ai-information',{method:'PUT',body:JSON.stringify({revision:library.revision,items})});savedLibrary=structuredClone(library);dirty=false;render();message('Saved. AI access now includes the latest information.');}
  button.onclick=()=>run(async()=>{if(!page.hidden)return;page.hidden=false;background(true);button.setAttribute('aria-pressed','true');document.body.classList.add('ai-information-open');message('Loading library...');await reload();if(activeTab==='data')await loadEstimates();else if(activeTab==='keys')await loadKeys();setTimeout(()=>page.querySelector('[data-action="close"]').focus(),0);});
  function closePage(){if(!discard())return;operation?.abort();operation=null;setBusy(false);endDrag();page.hidden=true;dirty=false;background(false);document.body.classList.remove('ai-information-open');button.setAttribute('aria-pressed','false');button.focus();}
  page.querySelector('[data-action="close"]').onclick=closePage;
  document.getElementById('server-bar').addEventListener('click',event=>{
    if(page.hidden||button.contains(event.target))return;
    if(!discard()){event.preventDefault();event.stopImmediatePropagation();return;}
    page.querySelector('[data-action="close"]').click();
  },true);
  for(const kind of ['folder','entry'])page.querySelector(`[data-action="${kind}"]`).onclick=()=>run(async()=>{
    if(!discard())return;
    const current=item(),parent=current?.kind==='folder'?current.id:current?.parent||'';
    const created={id:crypto.randomUUID(),parent,kind,title:kind==='folder'?'New folder':'Untitled entry',text:''};
    selected=created.id;library.items.push(created);dirty=true;render();message('New '+kind+' — name it, then save.');
    setTimeout(()=>{$('title').focus();$('title').select();},0);
  });
  $('editor').oninput=()=>{dirty=true;message('Unsaved changes.');};
  $('editor').onsubmit=event=>{event.preventDefault();run(async()=>{
    const current=item();if(!current)return;
    const updated={...current,title:$('title').value.trim(),parent:$('parent').value,text:current.kind==='entry'?$('text').value:''};
    if(!updated.title)throw Error('Enter a title.');
    await persist(library.items.map(i=>i.id===selected?updated:i));
  });};
  page.querySelector('[data-action="delete"]').onclick=()=>run(async()=>{
    const current=item();if(!current)return;const removed=descendants(current.id);
    if(!confirm(`Delete “${current.title}”${removed.size>1?' and everything inside it':''}? This cannot be undone.`))return;
    await persist(library.items.filter(i=>!removed.has(i.id)));selected='';render();
  });
  page.querySelector('[data-action="reload"]').onclick=()=>run(async()=>{if(activeTab==='data')await loadEstimates();else if(activeTab==='keys')await loadKeys();else if(discard())await reload();});
  $('search').oninput=tree;
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
