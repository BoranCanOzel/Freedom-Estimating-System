import './takeoff-folders.css';

export function setupTakeoffFolders(bridge) {
  const bar=document.createElement('nav');
  bar.id='takeoff-folders';bar.setAttribute('aria-label','Takeoff folders');
  document.getElementById('rail').before(bar);
  const dialog=document.createElement('dialog');dialog.id='takeoff-folder-dialog';
  dialog.innerHTML='<form><h2 id="takeoff-folder-heading">New folder</h2><label>Folder name<input name="name" required maxlength="200" autocomplete="off"></label><div class="folder-dialog-actions"><button type="button" class="btn alt">Cancel</button><button type="submit" class="btn">Save folder</button></div></form>';
  dialog.setAttribute('aria-labelledby','takeoff-folder-heading');document.body.append(dialog);
  dialog.querySelector('button[type=button]').onclick=()=>dialog.close();
  let editing=null,editingTakeoff=null;
  function edit(folder=null){
    editing=folder?.id||null;editingTakeoff=bridge.getLocation().takeoff;
    dialog.querySelector('h2').textContent=folder?'Rename folder':'New folder';
    dialog.querySelector('input').value=folder?.name||'';dialog.showModal();dialog.querySelector('input').focus();
  }
  dialog.querySelector('form').onsubmit=event=>{
    event.preventDefault();const input=dialog.querySelector('input'),name=input.value.trim();
    if(!name){input.setCustomValidity('Enter a folder name.');input.reportValidity();return;}
    if(bridge.getLocation().takeoff!==editingTakeoff){dialog.close();return;}
    bridge.saveTakeoffFolder(editing,name);dialog.close();
  };
  dialog.querySelector('input').oninput=event=>event.target.setCustomValidity('');
  function button(label,action,cls='btn alt tiny'){
    const b=document.createElement('button');b.type='button';b.className=cls;b.textContent=label;b.onclick=action;return b;
  }
  let cancelDrag=null,suppressClick=false;
  bar.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopImmediatePropagation();}},true);
  function armFolderDrag(event,group,tabs){
    if(event.button>0||event.pointerType==='touch')return;
    cancelDrag?.();
    const start={x:event.clientX,y:event.clientY},location=bridge.getLocation();
    let started=false,ghost=null;
    const inside=ev=>{const r=tabs.getBoundingClientRect();return ev.clientX>=r.left&&ev.clientX<=r.right&&ev.clientY>=r.top&&ev.clientY<=r.bottom;};
    function move(ev){
      if(!started){
        if(Math.hypot(ev.clientX-start.x,ev.clientY-start.y)<5)return;
        started=true;suppressClick=true;group.classList.add('folder-dragging');document.body.style.userSelect='none';
        ghost=document.createElement('div');ghost.className='page-drag-ghost folder-drag-ghost';ghost.setAttribute('aria-hidden','true');
        ghost.textContent=group.querySelector('.takeoff-folder-tab').firstChild.textContent;document.body.append(ghost);
      }
      ev.preventDefault();
      const zoom=Number.parseFloat(getComputedStyle(document.body).zoom)||1;
      ghost.style.left=(ev.clientX+12)/zoom+'px';ghost.style.top=(ev.clientY+12)/zoom+'px';
      if(!inside(ev))return;
      const bounds=tabs.getBoundingClientRect();
      if(ev.clientX<bounds.left+24)tabs.scrollLeft-=16;
      else if(ev.clientX>bounds.right-24)tabs.scrollLeft+=16;
      const groups=[...tabs.querySelectorAll('.takeoff-folder-group')].filter(node=>node.dataset.folderId);
      for(const target of groups){
        if(target===group)continue;
        const rect=target.getBoundingClientRect();
        if(ev.clientX<rect.left+rect.width/2){if(target.previousElementSibling!==group)tabs.insertBefore(group,target);break;}
        if(target===groups.at(-1)&&ev.clientX>rect.left+rect.width/2)tabs.insertBefore(group,target.nextSibling);
      }
    }
    function cleanup(){
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);
      window.removeEventListener('pointercancel',cancel);window.removeEventListener('blur',cancel);
      document.removeEventListener('keydown',keydown);document.removeEventListener('estimator:before-receive',cancel);
      ghost?.remove();group.classList.remove('folder-dragging');document.body.style.userSelect='';cancelDrag=null;
      setTimeout(()=>{suppressClick=false;},0);
    }
    function cancel(restore=true){cleanup();if(started&&restore!==false)render();}
    function keydown(ev){if(ev.key==='Escape'){ev.preventDefault();cancel();}}
    function up(ev){
      const here=bridge.getLocation(),commit=started&&inside(ev)&&here.list===location.list&&here.takeoff===location.takeoff;
      const order=[...tabs.querySelectorAll('.takeoff-folder-group')].map(node=>node.dataset.folderId).filter(Boolean);
      cleanup();
      if(commit)bridge.reorderTakeoffFolders(order);
      if(started)render();
    }
    cancelDrag=cancel;
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);
    window.addEventListener('pointercancel',cancel);window.addEventListener('blur',cancel);
    document.addEventListener('keydown',keydown);document.addEventListener('estimator:before-receive',cancel);
  }
  function render(){
    cancelDrag?.(false);
    const scrollLeft=bar.querySelector('.takeoff-folder-tabs')?.scrollLeft||0;
    const data=bridge.getTakeoffFolders();bar.hidden=!data;bar.replaceChildren();if(!data)return;
    const tabs=document.createElement('div');tabs.className='takeoff-folder-tabs';
    for(const folder of data.groups){
      const tab=button(folder.name,()=>bridge.openTakeoffFolder(folder.id),'takeoff-folder-tab');
      tab.dataset.takeoffFolder=folder.id;tab.setAttribute('aria-pressed',String(folder.id===data.active));
      tab.title=(folder.id?'Drag to reorder this folder. ':'')+'Drop a takeoff page here to move it to '+folder.name;
      const count=document.createElement('span');count.textContent=folder.count;count.className='takeoff-folder-count';tab.append(count);
      const group=document.createElement('span');group.className='takeoff-folder-group';group.dataset.folderId=folder.id;group.append(tab);
      if(folder.id){
        tab.addEventListener('pointerdown',event=>armFolderDrag(event,group,tabs));
        tab.addEventListener('keydown',event=>{
          if(!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
          event.preventDefault();
          const order=data.groups.map(f=>f.id).filter(Boolean),at=order.indexOf(folder.id),to=at+(event.key==='ArrowLeft'?-1:1);
          if(to<0||to>=order.length)return;
          [order[at],order[to]]=[order[to],order[at]];bridge.reorderTakeoffFolders(order);
          [...bar.querySelectorAll('.takeoff-folder-tab')].find(node=>node.dataset.takeoffFolder===folder.id)?.focus();
        });
        tab.setAttribute('aria-keyshortcuts','Alt+ArrowLeft Alt+ArrowRight');
        const close=button('×',()=>bridge.deleteTakeoffFolder(folder.id,close),'takeoff-folder-close');
        close.setAttribute('aria-label','Delete folder '+folder.name);close.title='Delete folder '+folder.name;group.append(close);
      }
      tabs.append(group);
    }
    bar.append(tabs);
    tabs.scrollLeft=scrollLeft;
    const actions=document.createElement('div');actions.className='takeoff-folder-actions';
    const add=button('+ Folder',()=>edit());add.setAttribute('aria-label','New takeoff folder');actions.append(add);
    const selected=data.groups.find(f=>f.id===data.active);
    if(selected?.id){
      const rename=button('Rename',()=>edit(selected));rename.setAttribute('aria-label','Rename folder');
      actions.append(rename);
    }
    if(data.sheet){
      const label=document.createElement('label');label.className='takeoff-folder-move';label.textContent='Page folder';
      const select=document.createElement('select');select.setAttribute('aria-label','Move page to folder');
      for(const folder of data.groups)select.add(new Option(folder.name,folder.id));
      select.value=data.active;select.onchange=()=>bridge.movePageToFolder(data.sheet,select.value);label.append(select);actions.append(label);
    }
    bar.append(actions);
  }
  document.addEventListener('estimator:view',render);render();
}
