import {transferChoices,exportTransfer,importTransfer} from '../shared/transfers.js';

export function setupTransfers(bridge,getConnection,notify){
  const dialog=document.createElement('dialog');dialog.id='transfer-dialog';
  dialog.innerHTML='<form><h2 id="transfer-title"></h2><p id="transfer-description"></p><label>Source <select id="transfer-source"></select></label><label id="transfer-target-label">Destination <select id="transfer-target"></select></label><p id="transfer-error" role="alert"></p><div class="server-dialog-actions"><button type="button" id="transfer-cancel">Cancel</button><button type="submit">Continue</button></div></form>';
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#transfer-'+id);
  $('cancel').onclick=()=>dialog.close();
  function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(kind,raw,filename){
    if(!getConnection()?.ready)throw Error('Open a destination workbook first.');
    const exporting=!raw,book=bridge.exportBook(),choices=transferChoices(raw||book,kind,filename);
    if(!choices.length)throw Error('This file has no '+kind+' records to select.');
    $('title').textContent=(exporting?'Export ':'Import ')+kind;
    $('description').textContent=exporting?'Choose the record to export with its nested estimates.':'Adds a new copy to the selected destination. Existing records and prices are preserved.';
    $('source').replaceChildren(...choices.map((c,i)=>new Option(c.label,String(i))));
    $('target-label').hidden=exporting;
    const targets=[];
    for(const l of book.lists||[]){if(kind==='customer')targets.push({id:l.id,name:l.name});for(const c of l.companies||[]){if(kind==='project')targets.push({id:c.id,name:c.name});for(const p of c.projects||[])if(kind==='takeoff')targets.push({id:p.id,name:c.name+' / '+p.name});}}
    $('target').replaceChildren(...targets.map(t=>new Option(t.name,t.id)));
    if(!exporting&&!targets.length)throw Error('Create a '+(kind==='customer'?'project list':kind==='project'?'customer':'project')+' in this workbook first.');
    $('error').textContent='';dialog.showModal();
    dialog.querySelector('form').onsubmit=event=>{
      event.preventDefault();try{
        const record=choices[Number($('source').value)].data;
        if(exporting)download(exportTransfer(book,kind,record),(record.name||kind)+'-'+kind);
        else{
          const connection=getConnection();if(!connection?.ready)throw Error('Reconnect to the destination workbook first.');
          // Read again at submit time so concurrent edits are not overwritten.
          if(connection!==openedConnection)throw Error('The destination workbook changed. Reopen import.');
          const dependencySource=raw.dependencies||Object.fromEntries(['libs','catalog','wageGroups','customFields','statuses'].filter(k=>raw[k]!==undefined).map(k=>[k,raw[k]]));
          const next=importTransfer(bridge.getShared(),kind,record,$('target').value,dependencySource);
          bridge.receive(next);connection.changed();notify('Imported '+kind+' as a new copy.');
        }
        dialog.close();
      }catch(error){$('error').textContent=error.message;}
    };
    const openedConnection=getConnection();
  }
  return {import:(raw,kind,filename)=>open(kind,raw,filename),export:kind=>open(kind)};
}
