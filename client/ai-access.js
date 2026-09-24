import './ai-access.css';

export function setupAiAccess(api,getContext) {
  const button=document.createElement('button');button.id='takeoff-ai-access';button.type='button';button.textContent='AI access';button.className='btn ghost';
  const dialog=document.createElement('dialog');dialog.id='ai-access-dialog';dialog.setAttribute('aria-labelledby','ai-access-title');
  dialog.innerHTML=`<header><h2 id="ai-access-title">AI access</h2><button id="ai-access-close" type="button">Close</button></header>
    <p id="ai-access-scope"></p><p>One takeoff, including all its option pages. Access lasts 30 minutes and permits one successful save. Reads and previews do not use up the save.</p>
    <button id="ai-access-generate" type="button">Generate access</button>
    <div id="ai-access-package" hidden><label for="ai-access-connection">Connection package — keep this key private</label><textarea id="ai-access-connection" readonly rows="10" spellcheck="false"></textarea><button id="ai-access-copy" type="button">Copy connection package</button><p>Configure a tool connection using the endpoint and Bearer key. Pasting a URL into a normal chat does not grant editing tools.</p></div>
    <p id="ai-access-message" role="status"></p><h3>Access keys</h3><div id="ai-access-grants"></div><h3>AI changes</h3><div id="ai-access-changes"></div>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#ai-access-'+id);
  let context,refreshTimer;
  const path=()=>'/projects/'+encodeURIComponent(context.workbook)+'/ai-access';
  const when=value=>new Date(value).toLocaleString();
  const action=fn=>async()=>{try{$('message').textContent='';await fn();}catch(error){$('message').textContent=error.message;}};
  function sync(){const here=getContext(),host=document.querySelector(`#${here.view||'sheet'}Card .eyebrow-row`);if(host&&button.parentElement!==host)host.append(button);button.disabled=!here.workbook||!here.takeoff;}
  async function refresh(){
    const requested=context;
    const data=await api(path()+'?'+new URLSearchParams({list:context.list,takeoff:context.takeoff}));
    if(!dialog.open||context!==requested)return;
    $('grants').replaceChildren();$('changes').replaceChildren();
    for(const grant of data.grants){
      const row=document.createElement('div');row.className='ai-access-record';
      const status=grant.revoked?'Revoked':grant.used_at?'Used':Date.now()>=grant.expires_at?'Expired':'Active';
      const text=document.createElement('span');text.textContent=`${status} · ${grant.created_by} · expires ${when(grant.expires_at)}`;row.append(text);
      if(status==='Active'){const revoke=document.createElement('button');revoke.type='button';revoke.textContent='Revoke';revoke.onclick=action(async()=>{await api(path()+'/'+grant.id,{method:'DELETE'});await refresh();});row.append(revoke);}
      $('grants').append(row);
    }
    if(!data.grants.length)$('grants').textContent='No access keys for this takeoff.';
    for(const change of data.changes){
      const row=document.createElement('details'),summary=document.createElement('summary');row.className='ai-access-record';summary.textContent=`${change.undone_at?'Undone':'Saved'} · AI via ${change.created_by} · ${when(change.created_at)}`;row.append(summary);
      const pre=document.createElement('pre');pre.textContent=JSON.stringify(change.summary,null,2);row.append(pre);
      if(!change.undone_at){const undo=document.createElement('button');undo.type='button';undo.textContent='Undo AI change';undo.disabled=!change.canUndo;undo.title=change.canUndo?'Restore this takeoff to before the AI save':'Later takeoff edits prevent automatic undo';undo.onclick=action(async()=>{await api(path()+'/changes/'+change.id+'/undo',{method:'POST'});await refresh();$('message').textContent='AI change undone.';});row.append(undo);}
      $('changes').append(row);
    }
    if(!data.changes.length)$('changes').textContent='No AI changes for this takeoff.';
  }
  button.onclick=action(async()=>{context=getContext();if(!context.workbook||!context.takeoff)return;$('scope').textContent='Takeoff: '+context.name;$('package').hidden=true;$('connection').value='';dialog.showModal();await refresh();refreshTimer=setInterval(()=>refresh().catch(()=>{}),10000);});
  $('close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{clearInterval(refreshTimer);$('connection').value='';$('package').hidden=true;});
  $('generate').onclick=action(async()=>{
    const requested=context;
    $('generate').disabled=true;
    try{
      const grant=await api(path(),{method:'POST',body:JSON.stringify({list:context.list,takeoff:context.takeoff})});
      if(!dialog.open||context!==requested)return;
      const url=value=>new URL(value,location.origin).href;
      $('connection').value=`Freedom Estimating — authorized takeoff: ${grant.takeoffName}\nExpires: ${grant.expiresAt}\nOne successful save only.\n\nWebsite URL: ${location.origin}\nREST endpoint: ${url(grant.endpoint)}\nMCP endpoint: ${url(grant.mcp)}\nAuthorization: Bearer ${grant.key}\nOpenAPI schema: ${url(grant.openapi)}\n\nFirst call get_instructions (MCP) or GET ${url(grant.instructions)} with the Authorization header. Then read_takeoff, validate_changes, and save_takeoff. Preserve the read revision and use a unique requestId when saving. Do not attempt to edit any other takeoff. A 409 means reread and reapply your intended changes. The server returns a receipt after saving.\n\nUse these full URLs for REST requests:\nGET ${url(grant.instructions)}\nGET ${url(grant.endpoint + "/takeoff")}\nPOST ${url(grant.endpoint + "/validate")} with {revision,takeoff}\nPOST ${url(grant.endpoint + "/save")} with {revision,takeoff,requestId}\nInclude the Authorization header above on every request. Configure the Bearer key in the tool client; never put it in a URL.`;
      $('package').hidden=false;await refresh();
    }finally{$('generate').disabled=false;}
  });
  $('copy').onclick=action(async()=>{await navigator.clipboard.writeText($('connection').value);$('message').textContent='Connection package copied.';});
  for(const event of ['estimator:view','estimator:projects'])document.addEventListener(event,sync);
  sync();
}
