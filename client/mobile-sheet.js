import './mobile-sheet.css';

// Keep the live table's inputs and event handlers; only its phone presentation changes.
export function setupMobileSheet() {
  const table=document.getElementById('sheetTable');
  const narrow=matchMedia('(max-width:760px)');
  let tableMode=false,frame=0;
  const toolbar=document.createElement('div');toolbar.className='mobile-sheet-tools';
  toolbar.setAttribute('aria-label','Phone sheet controls');
  for(const [id,label] of [['add','+ Item'],['addSection','+ Section']]){
    const button=document.createElement('button');button.type='button';button.className='btn alt';button.textContent=label;
    button.onclick=()=>document.getElementById(id).click();toolbar.append(button);
  }
  const toggle=document.createElement('button');toggle.type='button';toggle.className='btn alt';
  toggle.title='Switch to the table to edit column names, fees, and units';
  toolbar.append(toggle);document.querySelector('#sheetCard > .head').after(toolbar);
  function labelCells(){
    frame=0;
    if(!narrow.matches)return;
    const headers=[...table.querySelectorAll('thead th')];
    const getLabel=th=>{
      const input=th.querySelector('.h-lab-in'),label=th.querySelector('.h-lab');
      const unit=th.querySelector('[aria-label="Unit label"]');
      if(unit)return 'Unit price'+(unit.value.trim()?' / '+unit.value.trim():'');
      return (input ? input.value || input.placeholder : label?.dataset.full || label?.textContent || '').trim();
    };
    const labels=headers.map(getLabel);
    // Body rows omit hidden multiplier/flat-add cells; the footer retains placeholders.
    const bodyHeaders=headers.filter(th=>!th.hidden||!['time','days','flatAdd'].includes(th.dataset.w));
    for(const row of table.querySelectorAll('tbody tr,tfoot tr')){
      const rowLabels=row.parentElement.tagName==='TBODY'
        ? bodyHeaders.filter(th=>!(row.dataset.type==='section'&&th.matches('.col-up.col-empty'))).map(getLabel) : labels;
      let column=0;
      for(const cell of row.children){
        const label=cell.matches('.c-item,.c-del')?'':rowLabels[column] || '';
        if(cell.dataset.mobileLabel!==label)cell.dataset.mobileLabel=label;
        column+=cell.colSpan || 1;
      }
    }
  }
  function schedule(){if(narrow.matches&&!frame)frame=requestAnimationFrame(labelCells);}
  function sync(){
    const wasCards=document.body.classList.contains('mobile-sheet');
    document.body.classList.toggle('mobile-sheet',narrow.matches&&!tableMode);
    if(wasCards&&(!narrow.matches||tableMode))window.scrollTo(0,0);
    toggle.textContent=tableMode?'Card view':'Table view';
    toggle.setAttribute('aria-pressed',String(tableMode));
    schedule();
    // The existing sizing and rounded-total positioning follow viewport changes.
    window.dispatchEvent(new Event('resize'));
  }
  toggle.onclick=()=>{tableMode=!tableMode;sync();};
  narrow.addEventListener('change',sync);
  new MutationObserver(schedule).observe(table,{childList:true,subtree:true});
  table.addEventListener('input',schedule);
  document.addEventListener('estimator:view',schedule);
  sync();
}
