import {transferChoices,exportTransfer} from '../shared/transfers.js';

export function setupTransfers(bridge,getConnection){
  const dialog=document.createElement('dialog');dialog.id='transfer-dialog';
  dialog.innerHTML='<form><h2 id="transfer-title"></h2><p id="transfer-description"></p><label>Source <select id="transfer-source"></select></label><p id="transfer-error" role="alert"></p><div class="server-dialog-actions"><button type="button" id="transfer-cancel">Cancel</button><button type="submit">Export</button></div></form>';
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#transfer-'+id);
  $('cancel').onclick=()=>dialog.close();
  function download(data,name){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=name.replace(/[<>:"/\\|?*]/g,'-')+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
  function open(kind){
    if(!getConnection()?.ready)throw Error('Open a workbook first.');
    const book=bridge.exportBook(),choices=transferChoices(book,kind);
    if(!choices.length)throw Error('This workbook has no '+kind+' records to select.');
    $('title').textContent='Export '+kind;
    $('description').textContent='Choose the record to export with its nested estimates.';
    $('source').replaceChildren(...choices.map((c,i)=>new Option(c.label,String(i))));
    $('error').textContent='';dialog.showModal();
    dialog.querySelector('form').onsubmit=event=>{
      event.preventDefault();try{
        const record=choices[Number($('source').value)].data;
        download(exportTransfer(book,kind,record),(record.name||kind)+'-'+kind);
        dialog.close();
      }catch(error){$('error').textContent=error.message;}
    };
  }
  return {export:kind=>open(kind)};
}
