import './sidebar.css';

export function setupSidebar(bridge){
  const body=document.body,bar=document.getElementById('server-bar');
  body.classList.add('workspace-sidebar');bar.setAttribute('aria-label','Workspace sidebar');
  const toggle=document.createElement('button');toggle.id='workspace-sidebar-toggle';toggle.type='button';
  toggle.setAttribute('aria-controls','server-bar');bar.prepend(toggle);
  document.getElementById('server-title').after(document.getElementById('server-people'));
  const icons={
    'workspace-sidebar-toggle':'M9 4 3 10l6 6M15 4l-6 6 6 6',
    'server-projects':'M2 5h6l2 2h8v10H2ZM2 5V3h6l2 2',
    'workspace-file':'M5 2h7l4 4v12H5ZM12 2v5h4M8 11h5M8 14h5',
    'workspace-view':'M1 10s3-6 9-6 9 6 9 6-3 6-9 6-9-6-9-6ZM10 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    'workspace-estimate':'M4 2h12v16H4ZM7 5h6M7 9h1M12 9h1M7 12h1M12 12h1M7 15h1M12 15h1',
    'ai-information-open':'M10 1v3M10 16v3M1 10h3M16 10h3M5 5h10v10H5ZM8 8h4v4H8Z',
    'human-information-open':'M2 3h6l2 2 2-2h6v14h-6l-2 2-2-2H2ZM10 5v14',
    'duplicateSheet':'M7 6h10v12H7ZM4 14H2V2h10v2',
    'workspace-undo':'M7 4 2 9l5 5M2 9h10a5 5 0 0 1 0 10',
    'workspace-redo':'M13 4l5 5-5 5M18 9H8a5 5 0 0 0 0 10',
    'server-signout':'M8 2H3v16h5M8 10h10M14 6l4 4-4 4'
  };
  for(const [id,path] of Object.entries(icons)){
    const node=document.getElementById(id),control=node.matches('details')?node.querySelector('summary'):node;
    control.classList.add('sidebar-action');
    const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20"><path d="'+path+'" fill="none" stroke="black" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    control.style.setProperty('--sidebar-icon','url("data:image/svg+xml,'+encodeURIComponent(svg)+'")');
    if(!control.title)control.title=control.textContent.trim();
  }
  document.getElementById('server-projects').textContent='Projects';
  const narrow=matchMedia('(max-width:900px)');
  try{
    const saved=JSON.parse(localStorage.getItem('freedom:sidebar-collapsed'));
    if(typeof saved==='boolean'){body.classList.toggle('workspace-sidebar-collapsed',saved);body.classList.toggle('workspace-sidebar-expanded',!saved);}
  }catch{}
  const collapsed=()=>body.classList.contains('workspace-sidebar-collapsed')||narrow.matches&&!body.classList.contains('workspace-sidebar-expanded');
  function sync(){
    const compact=collapsed();body.classList.toggle('sidebar-compact',compact);
    toggle.textContent=compact?'Expand sidebar':'Collapse sidebar';toggle.title=toggle.textContent;
    toggle.setAttribute('aria-label',toggle.textContent);toggle.setAttribute('aria-expanded',String(!compact));
    for(const id of ['server-title','server-status','server-signout']){const node=document.getElementById(id);node.title=node.textContent.trim();}
  }
  toggle.onclick=()=>{
    const compact=!collapsed();body.classList.toggle('workspace-sidebar-collapsed',compact);body.classList.toggle('workspace-sidebar-expanded',!compact);
    try{localStorage.setItem('freedom:sidebar-collapsed',JSON.stringify(compact));}catch{}
    sync();window.dispatchEvent(new Event('resize'));requestAnimationFrame(()=>bridge.relayout());
  };
  narrow.addEventListener('change',sync);
  for(const id of ['server-title','server-status','server-signout'])new MutationObserver(sync).observe(document.getElementById(id),{childList:true,characterData:true,subtree:true});
  sync();
}
