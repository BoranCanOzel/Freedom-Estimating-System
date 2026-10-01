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
  dataPanel.innerHTML='<h2>AI Data estimates</h2><p>Jobs with estimates marked AI Data, including all their pages. Open an estimate to review it or change its AI Data checkbox.</p><label>Find a job or estimate<input id="ai-info-data-search" type="search" placeholder="Search jobs, customers, estimates, or workbooks"></label><p id="ai-info-data-count" role="status"></p><div id="ai-info-data-results"></div>';
  libraryPanel.after(dataPanel);
  let activeTab='library',estimates=[];
  function renderEstimates(){
    const query=$('data-search').value.trim().toLowerCase();
    const matches=estimates.filter(item=>[item.workbookName,item.listName,item.companyName,item.projectName,item.takeoffName].some(value=>value.toLowerCase().includes(query)));
    $('data-count').textContent=`${matches.length} of ${estimates.length} estimates across all workbooks`;
    $('data-results').replaceChildren();
    for(const item of matches){
      const row=document.createElement('article');row.className='ai-info-estimate';
      const info=document.createElement('div'),title=document.createElement('h3'),name=document.createElement('p'),context=document.createElement('p');
      title.textContent=item.projectName;name.textContent=item.takeoffName;context.className='ai-info-estimate-context';
      context.textContent=`${item.companyName} · ${item.workbookName} / ${item.listName} · ${item.pages} page${item.pages===1?'':'s'}`;
      info.append(title,name,context);
      const open=document.createElement('button');open.type='button';open.textContent='Open estimate';open.setAttribute('aria-label','Open estimate: '+item.takeoffName);
      open.onclick=()=>run(async()=>{if(!discard())return;const signal=operation?.signal;await openEstimate(item);signal?.throwIfAborted();closePage();});
      row.append(info,open);$('data-results').append(row);
    }
    if(!matches.length)$('data-results').textContent=estimates.length?'No matching jobs or estimates.':'No estimates are marked AI Data yet. Enable the AI Data checkbox on an estimate to include it here.';
  }
  async function loadEstimates(){message('Loading AI Data estimates...');const data=await request('/ai-information/estimates');estimates=data.estimates;renderEstimates();message('');}
  function setTab(tab){
    activeTab=tab;libraryPanel.hidden=tab!=='library';dataPanel.hidden=tab!=='data';
    for(const name of ['library','data']){$(name+'-tab').setAttribute('aria-selected',String(tab===name));$(name+'-tab').tabIndex=tab===name?0:-1;}
    page.querySelector('[data-action="reload"]').textContent=tab==='data'?'Refresh estimates':'Reload library';
  }
  for(const tab of ['library','data'])$(tab+'-tab').onclick=()=>run(async()=>{setTab(tab);if(tab==='data')await loadEstimates();else message(dirty?'Unsaved changes.':'');});
  tabs.onkeydown=event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key)&&!busy){event.preventDefault();const tab=event.key==='Home'?'library':event.key==='End'?'data':activeTab==='library'?'data':'library';$(tab+'-tab').click();setTimeout(()=>$(tab+'-tab').focus(),0);}};
  $('data-search').oninput=renderEstimates;
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
    page.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=value&&e.dataset.action!=='close');
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
  button.onclick=()=>run(async()=>{if(!page.hidden)return;page.hidden=false;background(true);button.setAttribute('aria-pressed','true');document.body.classList.add('ai-information-open');message('Loading library...');await reload();if(activeTab==='data')await loadEstimates();setTimeout(()=>page.querySelector('[data-action="close"]').focus(),0);});
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
  page.querySelector('[data-action="reload"]').onclick=()=>run(async()=>{if(activeTab==='data')await loadEstimates();else if(discard())await reload();});
  $('search').oninput=tree;
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
