export function setupPdfDownload(getContext,notify){
  const button=document.createElement('button');button.id='takeoff-pdf';button.type='button';button.className='btn ghost';button.textContent='Save as PDF';button.title='Download this complete takeoff, including all option pages';
  let busy=false;
  function sync(){const share=document.getElementById('takeoff-share');if(share&&share.nextElementSibling!==button)share.after(button);const here=getContext();button.disabled=busy||!here.workbook||!here.takeoff;}
  button.onclick=async()=>{
    if(busy)return;busy=true;button.textContent='Preparing PDF…';sync();
    try{
      if(window.estimator.getEditorHistory())throw Error('Save or close the open editor before exporting the takeoff.');
      const report=window.estimator.getPdfReport();
      await new Promise(resolve=>setTimeout(resolve,0));
      const {renderPdf}=await import('/assets/pdf-renderer.js');
      const pdf=renderPdf(report);
      const filename=(report.name||'Takeoff').replace(/[<>:"/\\|?*\x00-\x1f]/g,'-').replace(/[. ]+$/g,'').slice(0,120)||'Takeoff';
      pdf.save(filename+' - Takeoff.pdf');notify('Takeoff PDF saved.');
    }catch(error){notify(error.message,true);}finally{busy=false;button.textContent='Save as PDF';sync();}
  };
  for(const event of ['estimator:view','estimator:projects'])document.addEventListener(event,sync);sync();
}
