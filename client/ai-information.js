import './ai-information.css';

export function setupAiInformation(api) {
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
  const path=value=>{const names=[];let current=value;while(current){const found=library.items.find(i=>i.id===current);if(!found)break;names.unshift(found.title);current=found.parent;}return names.join(' / ');};
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
    const add=(parent,depth)=>{for(const i of library.items.filter(i=>i.parent===parent)){
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
  async function run(fn){if(busy)return;busy=true;page.setAttribute('aria-busy','true');page.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=true);try{await fn();}catch(error){message(error.message);}finally{busy=false;page.removeAttribute('aria-busy');page.querySelectorAll('button,input,select,textarea').forEach(e=>e.disabled=false);}}
  async function reload(){library=await api('/ai-information');savedLibrary=structuredClone(library);dirty=false;if(!item())selected='';render();message('Library loaded.');}
  async function persist(items){library=await api('/ai-information',{method:'PUT',body:JSON.stringify({revision:library.revision,items})});savedLibrary=structuredClone(library);dirty=false;render();message('Saved. AI access now includes the latest information.');}
  button.onclick=()=>run(async()=>{if(!page.hidden)return;page.hidden=false;background(true);button.setAttribute('aria-pressed','true');document.body.classList.add('ai-information-open');message('Loading library...');await reload();setTimeout(()=>page.querySelector('[data-action="close"]').focus(),0);});
  page.querySelector('[data-action="close"]').onclick=()=>{if(!discard())return;page.hidden=true;dirty=false;background(false);document.body.classList.remove('ai-information-open');button.setAttribute('aria-pressed','false');button.focus();};
  document.getElementById('server-bar').addEventListener('click',event=>{
    if(page.hidden||button.contains(event.target))return;
    if(busy||!discard()){event.preventDefault();event.stopImmediatePropagation();return;}
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
  page.querySelector('[data-action="reload"]').onclick=()=>run(async()=>{if(discard())await reload();});
  $('search').oninput=tree;
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
