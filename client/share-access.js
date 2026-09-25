import './ai-access.css';
export function setupShareAccess(api,getContext){
  const button=document.createElement('button');button.id='takeoff-share';button.className='btn ghost';button.textContent='Share';
  const dialog=document.createElement('dialog');dialog.id='share-access-dialog';dialog.setAttribute('aria-label','Share takeoff');
  dialog.innerHTML=`<h2>Share takeoff</h2><p id="share-name"></p><p>Anyone with this link can access this takeoff and all its option pages, including prices and notes. No sign-in required. Links remain active until revoked.</p><label>Link access<select id="share-permission"><option value="read">View only</option><option value="write">View and edit</option></select></label><button id="share-create">Create link</button><label id="share-result" hidden>Share link<input id="share-url" readonly><button id="share-copy">Copy link</button></label><p id="share-message" role="status"></p><h3>Existing links</h3><div id="share-links"></div><button id="share-close">Close</button>`;
  document.body.append(dialog);const $=id=>dialog.querySelector('#share-'+id);let context;
  const path=()=>'/projects/'+encodeURIComponent(context.workbook)+'/share-links';
  const action=fn=>async()=>{try{$('message').textContent='';await fn();}catch(e){$('message').textContent=e.message;}};
  async function refresh(){
    const data=await api(path()+'?'+new URLSearchParams({list:context.list,takeoff:context.takeoff}));$('links').replaceChildren();
    for(const link of data.links){const row=document.createElement('p');row.textContent=`${link.permission==='read'?'View only':'View and edit'} · ${link.created_by} · ${new Date(link.created_at).toLocaleString()}${link.revoked?' · Revoked':''} `;
      if(!link.revoked){const revoke=document.createElement('button');revoke.textContent='Revoke';revoke.onclick=action(async()=>{await api(path()+'/'+link.id,{method:'DELETE'});await refresh();});row.append(revoke);}$('links').append(row);}
    if(!data.links.length)$('links').textContent='No share links yet.';
  }
  button.onclick=action(async()=>{context=getContext();$('name').textContent=context.name;$('result').hidden=true;$('url').value='';$('permission').value='read';dialog.showModal();await refresh();});
  $('create').onclick=action(async()=>{ $('create').disabled=true;try{const result=await api(path(),{method:'POST',body:JSON.stringify({list:context.list,takeoff:context.takeoff,permission:$('permission').value})});$('url').value=new URL(result.path,location.origin).href;$('result').hidden=false;await refresh();}finally{$('create').disabled=false;} });
  $('copy').onclick=action(async()=>{let copied=false;try{if(navigator.clipboard?.writeText){await navigator.clipboard.writeText($('url').value);copied=true;}}catch{}if(!copied){$('url').select();try{copied=document.execCommand('copy');}catch{}}$('message').textContent=copied?'Link copied.':'Link selected. Press Ctrl+C or Command+C to copy.';});
  $('close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{$('url').value='';});
  function sync(){const here=getContext(),host=document.querySelector(`#${here.view||'sheet'}Card .eyebrow-row`);if(host&&button.parentElement!==host)host.append(button);button.disabled=!here.workbook||!here.takeoff;}
  for(const event of ['estimator:view','estimator:projects'])document.addEventListener(event,sync);sync();
}
