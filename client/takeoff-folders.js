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
  function render(){
    const data=bridge.getTakeoffFolders();bar.hidden=!data;bar.replaceChildren();if(!data)return;
    const tabs=document.createElement('div');tabs.className='takeoff-folder-tabs';
    for(const folder of data.groups){
      const tab=button(folder.name,()=>bridge.openTakeoffFolder(folder.id),'takeoff-folder-tab');
      tab.dataset.takeoffFolder=folder.id;tab.setAttribute('aria-pressed',String(folder.id===data.active));
      const count=document.createElement('span');count.textContent=folder.count;count.className='takeoff-folder-count';tab.append(count);tabs.append(tab);
    }
    bar.append(tabs);
    const actions=document.createElement('div');actions.className='takeoff-folder-actions';
    const add=button('+ Folder',()=>edit());add.setAttribute('aria-label','New takeoff folder');actions.append(add);
    const selected=data.groups.find(f=>f.id===data.active);
    if(selected?.id){
      const rename=button('Rename',()=>edit(selected));rename.setAttribute('aria-label','Rename folder');
      const remove=button('Delete',()=>bridge.deleteTakeoffFolder(selected.id,remove));remove.setAttribute('aria-label','Delete folder');actions.append(rename,remove);
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
