import './pdf-download.css';

export function setupPdfDownload(getContext,notify){
  const button=document.createElement('button');button.id='takeoff-pdf';button.type='button';button.className='btn ghost';button.textContent='Save as PDF ▾';button.title='Choose whether to include notes in the PDF';
  const menu=document.createElement('div');menu.id='takeoff-pdf-menu';menu.popover='auto';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Save as PDF');document.body.append(menu);
  button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls',menu.id);button.setAttribute('aria-expanded','false');
  button.popoverTargetElement=menu;
  const choices=[['Save without details','Omit notes and descriptions',false],['Save with details','Include notes and descriptions',true]].map(([label,hint,includeDetails])=>{
    const choice=document.createElement('button');choice.type='button';choice.setAttribute('role','menuitem');choice.setAttribute('aria-label',label);
    const title=document.createElement('strong'),description=document.createElement('small');title.textContent=label;description.textContent=hint;choice.append(title,description);
    choice.onclick=()=>download(includeDetails);menu.append(choice);return choice;
  });
  choices[0].autofocus=true;
  let busy=false;
  const close=()=>{if(menu.matches(':popover-open'))menu.hidePopover();button.setAttribute('aria-expanded','false');};
  function sync(){close();const share=document.getElementById('takeoff-share');if(share&&share.nextElementSibling!==button)share.after(button);const here=getContext();button.disabled=busy||!here.workbook||!here.takeoff;}
  function position(){
    const rect=button.getBoundingClientRect();menu.style.left=Math.max(8,Math.min(rect.right-menu.offsetWidth,window.innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,rect.bottom+6+menu.offsetHeight>window.innerHeight?rect.top-menu.offsetHeight-6:rect.bottom+6)+'px';
  }
  button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();menu.showPopover();position();choices[event.key==='ArrowUp'?1:0].focus();}};
  menu.addEventListener('toggle',()=>{const opened=menu.matches(':popover-open');button.setAttribute('aria-expanded',String(opened));if(opened)position();});
  menu.onkeydown=event=>{
    const index=choices.indexOf(document.activeElement);
    if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();choices[event.key==='Home'?0:event.key==='End'?1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length].focus();}
    if(event.key==='Escape'){event.preventDefault();close();button.focus();}
    if(event.key==='Tab')close();
  };
  window.addEventListener('resize',close);document.addEventListener('scroll',close,true);
  async function download(includeDetails){
    if(busy)return;close();busy=true;button.textContent='Preparing PDF…';sync();
    try{
      if(window.estimator.getEditorHistory())throw Error('Save or close the open editor before exporting the takeoff.');
      const report=window.estimator.getPdfReport({includeDetails});
      await new Promise(resolve=>setTimeout(resolve,0));
      const {renderPdf}=await import('/assets/pdf-renderer.js');
      const pdf=renderPdf(report,{includeDetails});
      const filename=(report.name||'Takeoff').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,120)||'Takeoff';
      pdf.save(filename+' - Takeoff.pdf');
    }catch(error){notify(error.message,true);}finally{busy=false;button.textContent='Save as PDF ▾';sync();button.focus();}
  }
  for(const event of ['estimator:view','estimator:projects'])document.addEventListener(event,sync);sync();
}
