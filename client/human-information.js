import './human-information.css';

export function setupHumanInformation(api){
  const button=document.createElement('button');button.id='human-information-open';button.type='button';button.textContent='Human Information';button.setAttribute('aria-pressed','false');
  document.getElementById('ai-information-open').after(button);
  const page=document.createElement('section');page.id='human-information-page';page.hidden=true;page.setAttribute('aria-label','Human Information');
  page.innerHTML=`<header><div><p class="human-info-eyebrow">TEAM NOTEBOOK</p><h1>Human Information</h1><p>Notes, reminders, and useful information for your team. Shared across all workbooks, and kept out of AI connections.</p></div><button type="button" data-action="close">Back to estimating</button></header>
    <div class="human-info-layout"><aside><div class="human-info-tools"><button type="button" data-action="folder">+ Folder</button><button type="button" data-action="entry">+ Note</button></div><label>Find a note<input id="human-info-search" type="search" placeholder="Search titles and notes"></label><nav id="human-info-tree" aria-label="Folders and notes"></nav></aside>
    <main><div id="human-info-empty"><h2>A place for the things you want to remember.</h2><p>Save team notes, job reminders, contacts, or how-to instructions. Use folders to keep everything organized.</p><p>Choose + Note to get started.</p></div>
    <form id="human-info-editor" hidden><p id="human-info-kind" class="human-info-eyebrow"></p><label>Title<input id="human-info-title" required maxlength="160" placeholder="Give this note a title"></label><label>Folder<select id="human-info-parent"></select></label><label id="human-info-text-label">Notes<textarea id="human-info-text" rows="16" maxlength="100000" placeholder="Write anything your team needs to remember..."></textarea></label><div class="human-info-tools"><button id="human-info-save" type="submit">Save changes</button><button type="button" data-action="delete">Delete</button></div></form></main></div>
    <footer><span id="human-info-status" role="status"></span><button type="button" data-action="reload">Reload notes</button></footer>`;
  document.body.append(page);
  const $=id=>page.querySelector('#human-info-'+id),message=text=>$('status').textContent=text;
  let library={items:[],revision:''},saved=structuredClone(library),selected='',dirty=false,busy=false,operation=null;
  const hiddenContent=[];
  function background(hidden){
    if(hidden){for(const el of document.body.children)if(el!==page&&el.id!=='server-bar'&&!el.inert){el.inert=true;hiddenContent.push(el);}}
    else{for(const el of hiddenContent)el.inert=false;hiddenContent.length=0;}
  }
  new ResizeObserver(()=>page.style.setProperty('--human-info-top',document.getElementById('server-bar').getBoundingClientRect().bottom+'px')).observe(document.getElementById('server-bar'));
  const current=()=>library.items.find(item=>item.id===selected);
  function discard(){if(!dirty)return true;if(!confirm('Discard your unsaved Human Information changes?'))return false;library=structuredClone(saved);dirty=false;return true;}
  function descendants(id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const item of library.items)if(ids.has(item.parent)&&!ids.has(item.id)){ids.add(item.id);changed=true;}}return ids;}
  function path(id){const names=[],seen=new Set();while(id&&!seen.has(id)){seen.add(id);const item=library.items.find(item=>item.id===id);if(!item)break;names.unshift(item.title);id=item.parent;}return names.join(' / ');}
  function tree(){
    $('tree').replaceChildren();const query=$('search').value.trim().toLowerCase(),visited=new Set();
    function add(parent,depth){for(const item of library.items.filter(item=>item.parent===parent)){
      if(visited.has(item.id))continue;visited.add(item.id);
      if(!query||(item.title+' '+item.text+' '+path(item.parent)).toLowerCase().includes(query)){
        const row=document.createElement('button');row.type='button';row.textContent=(item.kind==='folder'?'▸  ':'—  ')+item.title;row.title=path(item.id);row.style.paddingLeft=(12+Math.min(depth,8)*16)+'px';row.setAttribute('aria-pressed',String(item.id===selected));
        row.onclick=()=>{if(busy||!discard())return;selected=item.id;render();message('');};$('tree').append(row);
      }
      if(item.kind==='folder')add(item.id,depth+1);
    }}add('',0);
    if(!$('tree').children.length)$('tree').textContent=query?'No matching notes.':'No notes yet.';
  }
  function render(){
    tree();const item=current();$('editor').hidden=!item;$('empty').hidden=!!item;if(!item)return;
    $('kind').textContent=item.kind==='folder'?'FOLDER':'NOTE';$('title').value=item.title;$('text').value=item.text;$('text-label').hidden=item.kind==='folder';
    $('parent').replaceChildren(new Option('Top level',''));const excluded=descendants(item.id);
    for(const folder of library.items.filter(item=>item.kind==='folder'&&!excluded.has(item.id)))$('parent').add(new Option(path(folder.id),folder.id));
    $('parent').value=item.parent;
  }
  function setBusy(value){busy=value;page.setAttribute('aria-busy',String(value));page.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=value&&el.dataset.action!=='close');}
  async function request(options={}){const signal=operation?.signal;const result=await api('/human-information',{...options,signal});signal?.throwIfAborted();return result;}
  async function run(fn){
    if(busy)return;const controller=new AbortController();operation=controller;setBusy(true);
    const timer=setTimeout(()=>controller.abort(new Error('The request timed out. Your unsaved notes are still here. Reload to check whether a save completed before retrying.')),20000);
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
    try{await Promise.race([fn(),aborted]);}catch(error){if(operation===controller&&!page.hidden)message(error.message);}
    finally{clearTimeout(timer);if(operation===controller){operation=null;setBusy(false);}}
  }
  async function reload(){library=await request();saved=structuredClone(library);dirty=false;if(!current())selected='';render();message('Notes loaded.');}
  async function persist(items){library=await request({method:'PUT',body:JSON.stringify({revision:library.revision,items})});saved=structuredClone(library);dirty=false;render();message('Saved.');}
  button.onclick=()=>run(async()=>{if(!page.hidden)return;page.hidden=false;background(true);button.setAttribute('aria-pressed','true');message('Loading notes...');await reload();if(!page.hidden)page.querySelector('[data-action="close"]').focus();});
  function close(){if(!discard())return;operation?.abort();operation=null;setBusy(false);page.hidden=true;background(false);button.setAttribute('aria-pressed','false');button.focus();}
  page.querySelector('[data-action="close"]').onclick=close;
  document.getElementById('server-bar').addEventListener('click',event=>{
    if(page.hidden||button.contains(event.target))return;
    if(!discard()){event.preventDefault();event.stopImmediatePropagation();return;}close();
  },true);
  for(const kind of ['folder','entry'])page.querySelector(`[data-action="${kind}"]`).onclick=()=>{
    if(busy||!discard())return;const item=current(),created={id:crypto.randomUUID(),kind,parent:item?.kind==='folder'?item.id:item?.parent||'',title:kind==='folder'?'New folder':'Untitled note',text:''};
    selected=created.id;library.items.push(created);dirty=true;render();message('Name it, then save.');$('title').focus();$('title').select();
  };
  $('editor').oninput=()=>{dirty=true;message('Unsaved changes.');};
  $('editor').onsubmit=event=>{event.preventDefault();run(async()=>{
    const item=current();if(!item)return;const updated={...item,title:$('title').value.trim(),parent:$('parent').value,text:item.kind==='entry'?$('text').value:''};
    if(!updated.title)throw Error('Enter a title.');await persist(library.items.map(item=>item.id===selected?updated:item));
  });};
  page.querySelector('[data-action="delete"]').onclick=()=>run(async()=>{
    const item=current();if(!item)return;const removed=descendants(item.id);
    if(!confirm(`Delete “${item.title}”${removed.size>1?' and all notes and folders inside it':''}? This cannot be undone.`))return;
    await persist(library.items.filter(item=>!removed.has(item.id)));selected='';render();
  });
  page.querySelector('[data-action="reload"]').onclick=()=>run(async()=>{if(discard())await reload();});
  $('search').oninput=tree;
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
