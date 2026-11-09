import './human-information.css';
import {currentTabClick,clearPageLink} from './navigation-links.js';

export function setupHumanInformation(api){
  const button=document.createElement('a');button.id='human-information-open';button.href='/?page=human-information';button.textContent='Human Information';button.setAttribute('aria-current','false');
  document.getElementById('ai-information-open').after(button);
  const page=document.createElement('section');page.id='human-information-page';page.hidden=true;page.setAttribute('aria-label','Human Information');
  page.innerHTML=`<header><div><p class="human-info-eyebrow">TEAM NOTEBOOK</p><h1>Human Information</h1><p>Notes, reminders, and useful information for your team. Shared across all workbooks, and kept out of AI connections.</p></div><button type="button" data-action="close">Back to estimating</button></header>
    <div class="human-info-layout"><aside><div class="human-info-tools"><button type="button" data-action="folder">+ Folder</button><button type="button" data-action="entry">+ Note</button></div><label>Find a note<input id="human-info-search" type="search" placeholder="Search titles and notes"></label><nav id="human-info-tree" aria-label="Folders and notes"></nav></aside>
    <main><div id="human-info-empty"><h2>A place for the things you want to remember.</h2><p>Save team notes, job reminders, contacts, or how-to instructions. Use folders to keep everything organized.</p><p>Choose + Note to get started.</p></div>
    <form id="human-info-editor" hidden><p id="human-info-kind" class="human-info-eyebrow"></p><label>Title<input id="human-info-title" required maxlength="160" placeholder="Give this note a title"></label><label>Folder<select id="human-info-parent"></select></label><label id="human-info-text-label">Notes<textarea id="human-info-text" rows="16" maxlength="100000" placeholder="Write anything your team needs to remember..."></textarea></label><div class="human-info-tools"><button id="human-info-save" type="submit">Save changes</button><button type="button" data-action="delete">Delete</button></div></form></main></div>
    <footer><span id="human-info-status" role="status"></span><button type="button" data-action="reload">Reload notes</button></footer>`;
  document.body.append(page);
  const $=id=>document.getElementById('human-info-'+id);
  const drawer=document.getElementById('notesPanel'),drawerBody=drawer.querySelector('.lib-body');
  const drawerEditor=document.createElement('section');drawerEditor.id='human-info-drawer-editor';drawerEditor.hidden=true;
  const back=document.createElement('button');back.type='button';back.className='btn alt tiny';back.textContent='Back to notes';
  drawerEditor.append(back);drawerBody.append(drawerEditor);
  const preview=document.createElement('article');preview.id='human-info-drawer-view';preview.hidden=true;
  preview.innerHTML='<header><h2 id="human-info-view-title"></h2><button type="button" class="btn alt tiny" id="human-info-edit">Edit</button></header><p id="human-info-view-folder"></p><div id="human-info-view-text"></div>';
  drawerEditor.append(preview);
  const drawerStatus=document.createElement('p');drawerStatus.id='human-info-drawer-status';drawerStatus.setAttribute('role','status');drawerBody.append(drawerStatus);
  const form=$('editor'),pageMain=form.parentElement;
  const previewFlags=document.createElement('div');previewFlags.className='human-note-flags';preview.querySelector('header').after(previewFlags);
  const editorFlags=document.createElement('div');editorFlags.className='human-note-flags';$('kind').after(editorFlags);
  const cancel=document.createElement('button');cancel.type='button';cancel.id='human-info-cancel';cancel.textContent='Cancel';cancel.hidden=true;form.querySelector('.human-info-tools').append(cancel);
  const message=text=>{$('status').textContent=text;drawerStatus.textContent=text;};
  let library={items:[],revision:''},saved=structuredClone(library),selected='',dirty=false,busy=false,operation=null,drawerActive=false,drawerMode='view',returnToDrawer=false;
  let drawerFilter='all',pageFilter='all';
  function filterBar(change){
    const bar=document.createElement('div');bar.className='human-note-filters';bar.setAttribute('role','group');bar.setAttribute('aria-label','Filter notes');
    for(const [key,label]of [['all','All'],['starred','Starred'],['pinned','Pinned']]){
      const control=document.createElement('button');control.type='button';control.textContent=label;control.dataset.filter=key;control.setAttribute('aria-pressed',String(key==='all'));control.onclick=()=>change(key);bar.append(control);
    }return bar;
  }
  const drawerFilters=filterBar(key=>{drawerFilter=key;paintDrawer();});document.getElementById('notesList').before(drawerFilters);
  const pageFilters=filterBar(key=>{pageFilter=key;tree();});$('tree').before(pageFilters);
  const ordered=items=>[...items].sort((a,b)=>Number(!!b.pinned)-Number(!!a.pinned)||Number(!!b.starred)-Number(!!a.starred));
  const flagIcon=flag=>flag==='starred'?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3h8l-1 6 4 5H5l4-5zM12 14v7"/></svg>';
  function flagButton(item,flag,compact=false){
    const control=document.createElement('button');control.type='button';control.className='human-note-flag';control.disabled=busy;
    const active=item[flag]===true,action=flag==='starred'?(active?'Unstar':'Star'):(active?'Unpin':'Pin');
    control.setAttribute('aria-label',action+' '+item.title);control.setAttribute('aria-pressed',String(active));control.title=action+' note';control.innerHTML=flagIcon(flag);
    if(!compact)control.append(document.createTextNode(flag==='starred'?(active?'Starred':'Star'):(active?'Pinned':'Pin')));
    control.onclick=()=>run(()=>toggleFlag(item.id,flag));return control;
  }
  function paintFlags(){
    const item=current();for(const host of [previewFlags,editorFlags]){
      host.replaceChildren();host.hidden=item?.kind!=='entry';if(item?.kind==='entry')host.append(flagButton(item,'starred'),flagButton(item,'pinned'));
    }
  }
  async function toggleFlag(entryId,flag){
    const item=library.items.find(item=>item.id===entryId);if(item?.kind!=='entry')return;
    const value=!item[flag];
    if(!saved.items.some(item=>item.id===entryId)){item[flag]=value;dirty=true;message('Unsaved changes.');}
    else{
      const result=await request({method:'PUT',body:JSON.stringify({revision:saved.revision,items:saved.items.map(item=>item.id===entryId?{...item,[flag]:value}:item)})});
      saved=structuredClone(result);library.revision=result.revision;item[flag]=value;
      message(dirty?'Note marked. Your text changes are still unsaved.':'Saved.');
    }
    paintFlags();tree();paintDrawer();
  }
  function mountEditor(inDrawer){
    drawerActive=inDrawer;drawerEditor.hidden=!inDrawer;
    document.getElementById('notesList').hidden=inDrawer;
    drawerFilters.hidden=inDrawer;
    (inDrawer?drawerEditor:pageMain).append(form);
    preview.hidden=!inDrawer||drawerMode!=='view'||!current();
    form.hidden=!current()||(inDrawer&&drawerMode==='view');
    cancel.hidden=!inDrawer||drawerMode!=='edit';
  }
  function viewInDrawer(entryId){
    if(busy||!discard())return;selected=entryId;drawerMode='view';mountEditor(true);render();message('');$('edit').focus();
  }
  $('edit').onclick=()=>{if(busy)return;drawerMode='edit';render();$('title').focus();};
  cancel.onclick=()=>{if(busy)return;library=structuredClone(saved);dirty=false;drawerMode='view';render();paintDrawer();message('');};
  back.onclick=()=>{if(busy||!discard())return;mountEditor(false);render();paintDrawer();message('');};
  const hiddenContent=[];
  function background(hidden){
    if(hidden){for(const el of document.body.children)if(el!==page&&el.id!=='server-bar'&&!el.inert){el.inert=true;hiddenContent.push(el);}}
    else{for(const el of hiddenContent)el.inert=false;hiddenContent.length=0;}
  }
  const current=()=>library.items.find(item=>item.id===selected);
  function discard(){if(!dirty)return true;if(!confirm('Discard your unsaved Human Information changes?'))return false;library=structuredClone(saved);dirty=false;return true;}
  function descendants(id){const ids=new Set([id]);let changed=true;while(changed){changed=false;for(const item of library.items)if(ids.has(item.parent)&&!ids.has(item.id)){ids.add(item.id);changed=true;}}return ids;}
  function path(id){const names=[],seen=new Set();while(id&&!seen.has(id)){seen.add(id);const item=library.items.find(item=>item.id===id);if(!item)break;names.unshift(item.title);id=item.parent;}return names.join(' / ');}
  function tree(){
    $('tree').replaceChildren();const query=$('search').value.trim().toLowerCase(),visited=new Set();
    pageFilters.querySelectorAll('button').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.filter===pageFilter)));
    const visible=new Set();
    for(const item of library.items.filter(item=>item.kind==='entry'&&(pageFilter==='all'||item[pageFilter]))){
      let node=item;while(node&&!visible.has(node.id)){visible.add(node.id);node=library.items.find(item=>item.id===node.parent);}
    }
    function add(parent,depth){for(const item of ordered(library.items.filter(item=>item.parent===parent))){
      if(visited.has(item.id))continue;visited.add(item.id);
      if((pageFilter==='all'||visible.has(item.id))&&(!query||(item.title+' '+item.text+' '+path(item.parent)).toLowerCase().includes(query))){
        const row=document.createElement('button');row.type='button';row.textContent=(item.kind==='folder'?'▸  ':'—  ')+item.title;row.title=path(item.id);row.style.paddingLeft=(12+Math.min(depth,8)*16)+'px';row.setAttribute('aria-pressed',String(item.id===selected));
        if(item.starred)row.append(document.createTextNode(' ★'));if(item.pinned)row.append(document.createTextNode(' · Pinned'));
        row.onclick=()=>{if(busy||!discard())return;selected=item.id;render();message('');};$('tree').append(row);
      }
      if(item.kind==='folder')add(item.id,depth+1);
    }}add('',0);
    if(!$('tree').children.length)$('tree').textContent=query?'No matching notes.':'No notes yet.';
  }
  function render(){
    tree();paintFlags();const item=current();if(drawerActive&&!item)mountEditor(false);
    const viewing=drawerActive&&drawerMode==='view';
    form.hidden=!item||viewing;preview.hidden=!item||!viewing;cancel.hidden=!drawerActive||drawerMode!=='edit';
    $('empty').hidden=!!item;if(!item)return;
    $('view-title').textContent=item.title;$('view-folder').textContent=path(item.parent)||'Top level';$('view-text').textContent=item.text||'No note text yet.';
    $('kind').textContent=item.kind==='folder'?'FOLDER':'NOTE';$('title').value=item.title;$('text').value=item.text;$('text-label').hidden=item.kind==='folder';
    $('parent').replaceChildren(new Option('Top level',''));const excluded=descendants(item.id);
    for(const folder of library.items.filter(item=>item.kind==='folder'&&!excluded.has(item.id)))$('parent').add(new Option(path(folder.id),folder.id));
    $('parent').value=item.parent;
  }
  function setBusy(value){busy=value;for(const root of [page,drawer]){root.setAttribute('aria-busy',String(value));root.querySelectorAll('button,input,textarea,select').forEach(el=>el.disabled=value&&el.dataset.action!=='close'&&el.id!=='notesClose');}}
  async function request(options={}){const signal=operation?.signal;const result=await api('/human-information',{...options,signal});signal?.throwIfAborted();return result;}
  async function run(fn){
    if(busy)return;const controller=new AbortController();operation=controller;setBusy(true);
    const timer=setTimeout(()=>controller.abort(new Error('The request timed out. Your unsaved notes are still here. Reload to check whether a save completed before retrying.')),20000);
    const aborted=new Promise((_,reject)=>controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true}));
    try{await Promise.race([fn(),aborted]);}catch(error){if(operation===controller)message(error.message);}
    finally{clearTimeout(timer);if(operation===controller){operation=null;setBusy(false);}}
  }
  async function reload(){library=await request();saved=structuredClone(library);dirty=false;if(!current())selected='';render();paintDrawer();message('Notes loaded.');}
  async function persist(items){library=await request({method:'PUT',body:JSON.stringify({revision:library.revision,items})});saved=structuredClone(library);dirty=false;if(drawerActive||returnToDrawer)drawerMode='view';render();paintDrawer();message('Saved.');}
  async function migrateLegacyNotes(){
    const legacy=window.estimator?.getLegacyNotes?.()||[];
    if(!legacy.length){window.estimator?.clearLegacyNotes?.(legacy);return;}
    const workbook=window.freedomSession?.workbookId?.()||'';
    const source=String(workbook||'workbook').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,50)||'workbook';
    const additions=legacy.filter(note=>note&&typeof note==='object').map((note,index)=>({
      id:'imported-'+source+'-'+String(note.id||index).replace(/[^a-zA-Z0-9_-]/g,'').slice(0,35),kind:'entry',parent:'',
      title:String(note.title||'Imported note').trim()||'Imported note',text:String(note.text||'')
    }));
    if(additions.length){
      let result;
      for(let attempt=0;attempt<2;attempt++){
        const existing=new Set(library.items.map(item=>item.id)),missing=additions.filter(note=>!existing.has(note.id));
        if(!missing.length){result=library;break;}
        try{result=await request({method:'PUT',body:JSON.stringify({revision:library.revision,items:[...library.items,...missing]})});break;}
        catch(error){if(error.status!==409||attempt)throw error;await reload();}
      }
      library=result;saved=structuredClone(result);
    }
    if(workbook===(window.freedomSession?.workbookId?.()||''))window.estimator?.clearLegacyNotes?.(legacy);
    render();paintDrawer();
  }
  async function renderDrawer(){
    if(dirty)return;
    drawerMode='view';
    await reload();await migrateLegacyNotes();paintDrawer();
  }
  function paintDrawer(){
    const box=document.getElementById('notesList');if(!box)return;
    drawerFilters.querySelectorAll('button').forEach(control=>control.setAttribute('aria-pressed',String(control.dataset.filter===drawerFilter)));
    const entries=ordered(library.items.filter(item=>item.kind==='entry'&&(drawerFilter==='all'||item[drawerFilter])));box.replaceChildren();
    if(!entries.length){box.textContent=drawerFilter==='all'?'No shared notes yet. Choose + New note to add one.':'No '+drawerFilter+' notes yet.';return;}
    entries.forEach(item=>{
      const card=document.createElement('div');card.className='human-note-card';card.dataset.note=item.id;
      const row=document.createElement('button');row.type='button';row.className='human-note-row';
      const title=document.createElement('strong');title.textContent=item.title;
      const excerpt=document.createElement('span');excerpt.textContent=item.text.split('\n').find(line=>line.trim())||'No note text';
      row.append(title,excerpt);row.title='View note';row.onclick=()=>viewInDrawer(item.id);
      const actions=document.createElement('div');actions.className='human-note-actions';actions.append(flagButton(item,'starred',true),flagButton(item,'pinned',true));
      card.append(row,actions);box.append(card);
    });
  }
  async function open(entryId=selected){
    if(drawerActive){returnToDrawer=true;mountEditor(false);page.hidden=false;background(true);button.setAttribute('aria-current','page');return;}
    if(!discard())return;
    page.hidden=false;background(true);button.setAttribute('aria-current','page');
    message('Loading notes...');await reload();await migrateLegacyNotes();
    selected=entryId;render();message('');$('title').focus();
  }
  button.onclick=event=>{if(!currentTabClick(event))return;event.preventDefault();run(async()=>{if(page.hidden){await open();page.querySelector('[data-action="close"]').focus();}});};
  function close(){if(!returnToDrawer&&!discard())return;operation?.abort();operation=null;setBusy(false);if(!dirty)render();page.hidden=true;background(false);button.setAttribute('aria-current','false');clearPageLink('human-information');if(returnToDrawer){returnToDrawer=false;mountEditor(true);(drawerMode==='view'?$('edit'):$('title')).focus();}else button.focus();}
  page.querySelector('[data-action="close"]').onclick=close;
  window.humanInformation={open:()=>run(()=>open()),createFromDrawer:()=>run(async()=>{
    if(!discard())return;await reload();await migrateLegacyNotes();
    const created={id:crypto.randomUUID(),kind:'entry',parent:'',title:'Untitled note',text:''};
    library.items.push(created);selected=created.id;dirty=true;drawerMode='edit';mountEditor(true);render();message('Name it, then save.');$('title').focus();$('title').select();
  }),renderDrawer:()=>run(renderDrawer)};
  document.getElementById('server-bar').addEventListener('click',event=>{
    if(event.target.closest('a[href]')&&!currentTabClick(event))return;
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
  form.querySelector('[data-action="delete"]').onclick=()=>run(async()=>{
    const item=current();if(!item)return;const removed=descendants(item.id);
    if(!confirm(`Delete “${item.title}”${removed.size>1?' and all notes and folders inside it':''}? This cannot be undone.`))return;
    await persist(library.items.filter(item=>!removed.has(item.id)));selected='';render();
  });
  page.querySelector('[data-action="reload"]').onclick=()=>run(async()=>{if(discard())await reload();});
  $('search').oninput=tree;
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
}
