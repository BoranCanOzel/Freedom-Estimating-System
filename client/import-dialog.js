import {detectTransfer,transferChoices,transferDependencies,importTransfer} from '../shared/transfers.js';
import './import-dialog.css';

const labels={workbook:'Workbook',customer:'Customer',project:'Project',takeoff:'Takeoff / estimate'};

export function setupImportDialog(bridge,getConnection,createProject,notify){
  const dialog=document.createElement('dialog');dialog.id='import-preview';dialog.setAttribute('aria-labelledby','import-heading');
  dialog.innerHTML=`<form>
    <h2 id="import-heading">Import JSON</h2><p id="import-detected"></p>
    <label id="import-kind-label">Import as<select id="import-kind"></select></label>
    <div class="import-panels">
      <section><h3>From this file</h3><div id="import-sources" class="import-options"></div><p id="import-summary"></p></section>
      <section id="import-destination"><h3>Add to</h3><p id="import-workbook"></p>
        <label id="import-search-label">Find a destination<input id="import-search" type="search" placeholder="Search customers or projects"></label>
        <div id="import-targets" class="import-options"></div><p id="import-empty" hidden>No matching destinations.</p>
      </section>
    </div>
    <p id="import-result" aria-live="polite"></p><p id="import-error" role="alert"></p>
    <div class="server-dialog-actions"><button type="button" id="import-cancel">Cancel</button><button type="submit">Import</button></div>
  </form>`;
  document.body.append(dialog);
  const $=id=>dialog.querySelector('#import-'+id),submit=dialog.querySelector('button[type=submit]');
  let raw,filename,openedConnection,choices=[],targets=[],source=0,target='',saving=false;
  $('cancel').onclick=()=>dialog.close();
  dialog.addEventListener('cancel',event=>{if(saving)event.preventDefault();});

  function option(name,value,title,path,checked,change){
    const label=document.createElement('label');label.className='import-option';
    const radio=document.createElement('input');radio.type='radio';radio.name=name;radio.value=value;radio.checked=checked;radio.onchange=change;
    const text=document.createElement('span'),strong=document.createElement('strong');strong.textContent=title;text.append(strong);
    if(path){const small=document.createElement('small');small.textContent=path;text.append(small);}
    label.append(radio,text);return label;
  }
  function preview(){
    const kind=$('kind').value,record=kind==='workbook'?raw:choices[source]?.data;
    let pages=0,takeoffs=0;const folders=[];
    function walk(value){
      if(!value||typeof value!=='object')return;
      if(Array.isArray(value.sheets)){takeoffs++;pages+=value.sheets.length;folders.push(...(value.folders||[]).filter(f=>f&&typeof f==='object').map(f=>f.name));return;}
      for(const key of ['lists','companies','projects','takeoffs'])if(Array.isArray(value[key])&&value[key].length){value[key].forEach(walk);return;}
    }
    // Workbook exports can contain aliases of the active takeoff's pages.
    if(kind==='workbook'&&(raw.lists?.length||raw.companies?.length))walk(raw.lists?.length?{lists:raw.lists}:{companies:raw.companies});else walk(record);
    $('summary').textContent=`${takeoffs} takeoff${takeoffs===1?'':'s'} · ${pages} page${pages===1?'':'s'} · ${folders.length} folder${folders.length===1?'':'s'}${folders.length?' — '+folders.join(', '):''}`;
    const destination=targets.find(t=>t.id===target);
    $('result').textContent=kind==='workbook'?'Creates a new workbook with all customers, projects, takeoffs and libraries.':destination?`Adds a copy to ${destination.path} / ${destination.name}. Includes its pages, folders and library data.`:'Open a workbook with a destination '+(kind==='customer'?'project list':kind==='project'?'customer':'project')+' first.';
    submit.disabled=saving||(kind!=='workbook'&&(!destination||!choices[source]));
  }
  function renderTargets(){
    const query=$('search').value.trim().toLowerCase(),shown=targets.filter(t=>(t.path+' '+t.name).toLowerCase().includes(query));
    $('targets').replaceChildren(...shown.map(t=>option('import-target',t.id,t.name,t.path,t.id===target,()=>{target=t.id;preview();})));
    $('empty').hidden=!!shown.length;
  }
  function changeKind(){
    const kind=$('kind').value,book=bridge.getShared(),here=bridge.getLocation();
    source=0;target='';targets=[];$('search').value='';$('error').textContent='';
    $('destination').hidden=kind==='workbook';
    $('workbook').textContent=openedConnection?'Workbook: '+openedConnection.project.name:'';
    choices=kind==='workbook'?[{label:'Entire workbook',data:raw}]:transferChoices(raw,kind,filename);
    $('sources').replaceChildren(...choices.map((choice,i)=>option('import-source',String(i),choice.label,'',i===source,()=>{source=i;preview();})));
    if(choices.length===1){const only=document.createElement('p');only.className='import-single';only.textContent=choices[0].label;$('sources').replaceChildren(only);}
    if(kind!=='workbook'&&openedConnection?.ready){
      for(const list of book.lists||[]){
        if(kind==='customer')targets.push({id:list.id,list:list.id,name:list.name||'Projects',path:openedConnection.project.name,current:list.id===here.list});
        for(const company of list.companies||[]){
          const ownsCurrent=(company.projects||[]).some(p=>(p.takeoffs||[]).some(t=>t.id===here.takeoff))&&list.id===here.list;
          if(kind==='project')targets.push({id:company.id,list:list.id,name:company.name||'Untitled customer',path:list.name||'Projects',current:ownsCurrent});
          for(const project of company.projects||[])if(kind==='takeoff')targets.push({id:project.id,list:list.id,name:project.name||'Untitled project',path:(list.name||'Projects')+' / '+(company.name||'Untitled customer'),current:list.id===here.list&&(project.takeoffs||[]).some(t=>t.id===here.takeoff)});
        }
      }
      target=(targets.find(t=>t.current)||targets[0])?.id||'';
    }
    renderTargets();preview();
  }
  $('kind').onchange=changeKind;$('search').oninput=renderTargets;
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();if(saving||submit.disabled)return;
    saving=true;submit.disabled=true;$('cancel').disabled=true;$('error').textContent='';
    try{
      const kind=$('kind').value;
      if(kind==='workbook')await createProject(filename,bridge.prepare(raw));
      else{
        const connection=getConnection();
        if(connection!==openedConnection)throw Error('The destination workbook changed. Reopen import.');
        if(!connection?.ready)throw Error('Reconnect to the destination workbook first.');
        const next=importTransfer(bridge.getShared(),kind,choices[source].data,target,transferDependencies(raw));
        bridge.receive(next);connection.changed();
        if(kind==='takeoff'){
          const destination=targets.find(t=>t.id===target),list=next.lists.find(l=>l.id===destination.list);
          const project=list.companies.flatMap(c=>c.projects||[]).find(p=>p.id===target);
          bridge.openLocation({list:list.id,takeoff:project.takeoffs.at(-1).id,view:'summary'});
        }
        notify('Imported '+kind+' as a new copy.');
      }
      dialog.close();
    }catch(error){$('error').textContent=error.message;}
    finally{saving=false;$('cancel').disabled=false;preview();}
  };
  return {open(data,name,file){
    raw=data;filename=name;openedConnection=getConnection();
    const inferred=detectTransfer(raw),kinds=[inferred,...['customer','project','takeoff'].filter(kind=>kind!==inferred&&transferChoices(raw,kind,name).length)];
    $('detected').textContent=`Detected: ${labels[inferred]} — ${file}`;
    $('kind').replaceChildren(...kinds.map(kind=>new Option(labels[kind],kind)));
    $('kind-label').hidden=kinds.length===1;
    changeKind();dialog.showModal();
  }};
}
