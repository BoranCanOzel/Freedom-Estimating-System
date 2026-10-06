import { test, expect } from '@playwright/test';

const sheet = (id, title) => ({ id, title, fees: [{id:'fee-'+id,label:'Fee',pct:3}], units: [],
  rows: [{id:'row-'+id,kind:'labor',name:'Concrete cutting',count:1,time:1,days:1,cost:125,markup:0,note:'Crew detail'}] });
function workbook() {
  return {lists:[{id:'list',name:'Estimating',companies:[{id:'co',name:'Freedom Customer',projects:[
    {id:'north',name:'North job',status:'Open',custom:{Region:'North'},takeoffs:[{id:'tn',name:'North takeoff',sheets:[sheet('sn','North scope')]}]},
    {id:'south',name:'South job',status:'Completed',custom:{Region:'South'},takeoffs:[{id:'ts',name:'South takeoff',sheets:[sheet('ss','South scope')]}]}
  ]}]}],customFields:{company:['Account'],project:['Region'],takeoff:['Estimator']},filterFields:['Region']};
}
let workspaceCookies;
async function openWorkbook(page, data = workbook(), name = 'Workspace tester') {
  const reuse = name === 'Workspace tester' && workspaceCookies;
  if (reuse) await page.context().addCookies(workspaceCookies);
  await page.goto('/');
  if (!reuse) {
    await page.locator('#server-login-name').fill(name);
    await page.locator('#server-login-password').fill('1313');await page.locator('#server-login-password').fill('1313');await page.locator('#server-login-form button').click(); await expect(page.locator('#server-login')).not.toBeVisible();
    if (name === 'Workspace tester') workspaceCookies = await page.context().cookies();
  }
  await expect(page.locator('#server-status')).toHaveText(/^(All changes saved|No project open)$/,{timeout:20000});
  await page.locator('#workspace-file > summary').click();
  const chooser = page.waitForEvent('filechooser'); await page.locator('#server-import').click();
  const workbookName='Organized '+Date.now();
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/projects') && r.request().method()==='GET');
  await (await chooser).setFiles({name:workbookName+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.locator('#import-preview button[type=submit]').click();
  await refreshed;
  await expect(page.locator('#server-title')).toHaveText(workbookName);
  await expect(page.locator('#server-status')).toHaveText('All changes saved', {timeout:20000});
}

test('Save as PDF downloads every takeoff option with readable pagination and complete pricing',async({page})=>{
  const {readFile}=await import('node:fs/promises');
  const {getDocument,OPS}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data=workbook(),takeoff=data.lists[0].companies[0].projects[0].takeoffs[0];
  takeoff.name='Complete takeoff';takeoff.note='Takeoff description';data.summaryNotes='Scope exclusions and clarifications.';
  const first=takeoff.sheets[0];first.note='Option-specific scope note';first.flatAddEnabled=true;first.roundTotal=100;
  first.fees=Array.from({length:8},(_,i)=>({id:'fee'+i,label:'Custom fee '+i,pct:1}));
  first.units=Array.from({length:9},(_,i)=>({id:'unit'+i,label:'Measured unit '+i,qty:i+1}));
  first.units[0]={id:'unit0',label:'SF',qty:160};
  first.rows=[{id:'section',type:'section',name:'Site preparation',note:'Section scope included',collapsed:true},
    ...Array.from({length:65},(_,i)=>({id:'item'+i,kind:'labor',name:`Export item ${String(i).padStart(3,'0')}`,count:1,time:1,days:1,cost:125,markup:5,flatAdd:10,note:'Detail visible even when collapsed. José’s crew — 25 m².'})),
    {id:'section-end',type:'sectionEnd'},
    {id:'long',kind:'labor',name:'Long note item',cost:100,count:1,time:1,days:1,note:Array.from({length:130},(_,i)=>`Detailed scope line ${i}: Include cutting and cleanup.`).join('\n')+'\nEND OF LONG NOTE'}];
  takeoff.sheets.push({...sheet('second','Second option'),rows:[{id:'svc',kind:'service',name:'Service with add-ons',count:1,time:1,days:1,cost:100,parts:[{id:'p',name:'Included component',count:'2',time:'1',days:'1',cost:'5',markup:'0'}]}]});
  const picture=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');ctx.fillStyle='#d8e5ed';ctx.fillRect(0,0,320,180);ctx.fillStyle='#203440';ctx.font='20px sans-serif';ctx.fillText('Site reference',20,60);return canvas.toDataURL('image/png');});
  takeoff.sheets[1].rows[0].pics=[{id:'photo',name:'Site reference photo',url:picture}];
  takeoff.sheets.push({...sheet('empty','Empty alternative'),rows:[]});
  await openWorkbook(page,data);
  await expect(page.locator('#takeoff-share + #takeoff-pdf')).toBeVisible();
  const before=await page.evaluate(()=>JSON.stringify(window.estimator.getShared()));
  const downloadPromise=page.waitForEvent('download');await page.locator('#takeoff-pdf').click();const download=await downloadPromise;
  expect(download.suggestedFilename()).toBe('Complete takeoff - Takeoff.pdf');
  await download.saveAs('.tools/takeoff-export-review.pdf');
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.getShared()))).toBe(before);
  const loading=getDocument({data:new Uint8Array(await readFile(await download.path())),useSystemFonts:false});
  const pdf=await loading.promise;
  expect(pdf.numPages).toBeGreaterThan(3);
  let all='',hasImage=false,sfColumnVerified=false;
  for(let i=1;i<=pdf.numPages;i++){
    const pageData=await pdf.getPage(i),content=await pageData.getTextContent();
    const operators=await pageData.getOperatorList();hasImage||=operators.fnArray.some(op=>op===OPS.paintImageXObject||op===OPS.paintInlineImageXObject);
    const text=content.items.map(item=>item.str||'').join(' ');all+=text+'\n';
    if(i===1){
      const firstRow=content.items.find(item=>item.str==='1. North scope');
      const totalRow=content.items.find(item=>item.str==='Complete takeoff total');
      const amountsAt=row=>content.items.filter(item=>item.str?.startsWith('$')&&Math.abs(item.transform[5]-row.transform[5])<1);
      const rowAmounts=amountsAt(firstRow),totalAmounts=amountsAt(totalRow);
      expect(totalAmounts).toHaveLength(3);
      totalAmounts.forEach((amount,index)=>expect(amount.transform[4]+amount.width).toBeCloseTo(rowAmounts[index].transform[4]+rowAmounts[index].width,1));
    }
    const sfHeader=content.items.find(item=>item.str==='SF price');
    if(sfHeader){
      const headerEdge=sfHeader.transform[4]+sfHeader.width;
      const price=content.items.find(item=>item.str==='$0.95'&&Math.abs(item.transform[4]+item.width-headerEdge)<1);
      if(price)sfColumnVerified=true;
    }
    expect(text).toContain(`Page ${i} of ${pdf.numPages}`);
    for(const item of content.items.filter(item=>item.str?.trim())){
      expect(item.transform[4]).toBeGreaterThanOrEqual(35);
      expect(item.transform[4]+item.width).toBeLessThanOrEqual(pageData.view[2]-35);
      expect(item.transform[5]).toBeGreaterThan(10);
      expect(item.transform[5]+item.height).toBeLessThan(603);
    }
  }
  for(let i=0;i<65;i++)expect(all.split(`Export item ${String(i).padStart(3,'0')}`)).toHaveLength(2);
  for(const expected of ['Site preparation','Section scope included','Takeoff description','Scope exclusions and clarifications.','Second option','Included component','$110.00','$113.30','END OF LONG NOTE','Custom fee 7','Measured unit 8','José’s crew','25 m²','North scope total'])expect(all).toContain(expected);
  expect(all).not.toContain('South takeoff');
  expect(all).not.toContain('Item / section reference');
  expect(all).not.toContain('Scope notes and details');
  expect(all).not.toContain('Additional pricing');
  expect(all).not.toContain('matching item numbers');
  expect(all).not.toContain('Rounded line');
  expect(all).not.toContain('— subtotal');
  expect(all).not.toContain('Option total');
  expect(all).not.toContain('Option summary');
  expect(all).not.toContain('Option / scope');
  expect(all).not.toContain('All options combined');
  expect(all).not.toMatch(/Option \d+ ·/);
  expect(all.split('North scope total')).toHaveLength(2);
  expect(all).toContain('SF price');
  expect(all).toContain('Qty 160');
  expect(all).not.toContain('SF price / Qty');
  expect(sfColumnVerified).toBe(true);
  expect(all).not.toContain('— quantities');
  expect(all.indexOf('Section scope included')).toBeLessThan(all.indexOf('Export item 000'));
  expect(all.indexOf('Detail visible even when collapsed.')).toBeLessThan(all.indexOf('Export item 001'));
  expect(all.match(/Detail visible even when collapsed\./g)).toHaveLength(65);
  expect(all).toContain('Site reference photo');expect(all).toContain('No line items in this scope.');expect(hasImage).toBe(true);
  await loading.destroy();
  await page.locator('#rail .tab-summary').click();
  await expect(page.locator('#takeoff-share + #takeoff-pdf')).toBeVisible();
});

test.describe('phone layouts',()=>{
test.use({hasTouch:true});
test('phone line-item cards keep editing, sections, totals and desktop table behavior',async({page})=>{
  await page.setViewportSize({width:390,height:844});
  const data=workbook(),sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.rows.unshift({id:'mobile-section',type:'section',name:'Concrete work'});
  sh.rows.push({id:'mobile-end',type:'sectionEnd',sid:'mobile-section'});
  await openWorkbook(page,data);
  const row=page.locator('#body tr[data-id="row-sn"]');
  await expect(page.locator('body')).toHaveClass(/mobile-sheet/);
  await expect(page.locator('#sheetTable thead')).toBeHidden();
  await expect(row.locator('[aria-label="cost"]')).toBeVisible();
  await expect(row.locator('td[data-mobile-label="Cost"]')).toBeVisible();
  await expect(row.locator('td[data-mobile-label="Fee"]')).toBeVisible();
  await row.locator('[aria-label="cost"]').tap();await expect(row.locator('[aria-label="cost"]')).toBeFocused();
  await row.locator('[aria-label="cost"]').fill('200');await row.locator('[aria-label="cost"]').blur();
  await expect(page.locator('#tGrand .v')).toHaveText('206.00');
  await page.screenshot({path:'test-results/mobile-line-item-cards.png',fullPage:true});
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:innerWidth}));
  expect(width.scroll).toBeLessThanOrEqual(width.view+1);
  const bounds=await row.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(391);
  await page.locator('#body tr[data-id="mobile-section"] .caret').click();await expect(row).toBeHidden();
  await page.locator('#body tr[data-id="mobile-section"] .caret').click();await expect(row).toBeVisible();
  await row.getByRole('button',{name:'Duplicate this line',exact:true}).click();
  await expect(page.locator('#tGrand .v')).toHaveText('412.00');
  await page.locator('.mobile-sheet-tools').getByRole('button',{name:'Table view',exact:true}).click();
  await expect(page.locator('#sheetTable thead')).toBeVisible();
  await page.locator('#sheetTable thead .col-fee .h-lab-in').fill('Permit');
  await page.locator('.mobile-sheet-tools').getByRole('button',{name:'Card view',exact:true}).click();
  await expect(row.locator('td[data-mobile-label="Permit"]')).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});
  await expect(page.locator('#sheetTable thead')).toBeVisible();
  await expect(page.locator('.mobile-sheet-tools')).toBeHidden();
  expect(await row.evaluate(el=>getComputedStyle(el).display)).toBe('table-row');
  await expect(page.locator('#tGrand .v')).toHaveText('412.00');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await expect(page.locator('#tGrand .v')).toHaveText('412.00');
});

test('narrow phone cards label hidden columns, fees, units, services and rounded totals correctly',async({page})=>{
  await page.setViewportSize({width:320,height:740});
  const data=workbook(),sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.hiddenCols=['time','days'];sh.flatAddEnabled=true;sh.roundColumnVisible=true;sh.roundTotal=10;
  sh.units=[{id:'sf',label:'SF',qty:10}];sh.fees=[{id:'permit',label:'Permit',pct:5},{id:'tax',label:'Tax',pct:2}];
  sh.rows=[{id:'sec',type:'section',name:'Site work'},
    {id:'service',kind:'service',name:'Delivery and fuel',count:1,time:1,days:1,cost:100,markup:10,flatAdd:5,parts:[{id:'fuel',name:'Fuel',kind:'part',cost:20,count:1}]},
    {id:'construct',kind:'construct',name:'Assembly',count:1,time:1,days:1,markup:0,parts:[{id:'part',name:'Concrete',kind:'material',cost:50,count:2}]},
    {id:'end',type:'sectionEnd',sid:'sec'}];
  await openWorkbook(page,data);
  const row=page.locator('#body tr[data-id="service"]');
  await page.locator('.mobile-sheet-tools').getByRole('button',{name:'Table view',exact:true}).click();
  await page.locator('#sheetTable [data-hide="time"]').click();
  await page.locator('#sheetTable [data-hide="days"]').click();
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#hiddenCols').getByRole('button',{name:'+ Round',exact:true}).click();
  await page.locator('#workspace-estimate > summary').press('Escape');
  await page.locator('.mobile-sheet-tools').getByRole('button',{name:'Card view',exact:true}).click();
  await expect(row.locator('[aria-label="time"]')).toHaveCount(0);
  await expect(row.locator('[aria-label="flatAdd"]')).toBeVisible();
  await expect(row.locator('td[data-mobile-label="Flat add $"]')).toBeVisible();
  await expect(row.locator('td[data-mobile-label="Markup"] input')).toHaveAttribute('aria-label','Markup percent');
  for(const label of ['Grand','Permit','Tax','Unit price / SF','Round'])await expect(row.locator('td[data-mobile-label="'+label+'"]')).toBeVisible();
  await expect(page.locator('#body tr[data-id="sec"] td[data-mobile-label="Grand"] .v')).toHaveText('253.59');
  await row.locator('[aria-label="cost"]').fill('150');await row.locator('[aria-label="cost"]').blur();
  await expect(page.locator('#tGrand .v')).toHaveText('288.90');
  await expect(page.locator('#tGrandLipMoney .v')).toHaveText('290.00');
  await page.locator('.mobile-sheet-tools').getByRole('button',{name:'+ Item',exact:true}).click();
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(3);
  await expect(page.locator('#tGrand .v')).toHaveText('288.90');
  await page.screenshot({path:'test-results/mobile-narrow-cards.png',fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
  await page.emulateMedia({media:'print'});
  expect(await row.evaluate(el=>getComputedStyle(el).display)).toBe('table-row');
  await page.emulateMedia({media:'screen'});
  await page.setViewportSize({width:760,height:900});await expect(page.locator('#sheetTable thead')).toBeHidden();
  await page.setViewportSize({width:1024,height:900});await expect(page.locator('#sheetTable thead')).toBeVisible();
});

});

test('takeoff header edits the owning job status across pages and sibling takeoffs',async({page})=>{
  const data=workbook();data.statuses=['Open','Reviewing','Completed','Closed'];
  data.lists[0].companies[0].projects[0].takeoffs.push({id:'sibling',name:'Alternate takeoff',sheets:[sheet('sibling-sheet','Alternate scope')]});
  await openWorkbook(page,data);
  const status=page.getByRole('combobox',{name:'Job status',exact:true});
  await expect(status).toHaveValue('Open');
  await expect(status.locator('option')).toHaveText(data.statuses);
  await status.selectOption('Reviewing');
  await page.locator('#rail .tab-summary').click();
  await expect(status).toHaveValue('Reviewing');
  await expect(page.locator('#summaryContext')).toContainText('Reviewing');
  await page.screenshot({path:'test-results/takeoff-job-status.png',fullPage:true});
  await status.selectOption('Completed');
  await expect(page.locator('#summaryContext')).toContainText('Completed');
  await expect(page.locator('#sumBlocks .summary-project')).toContainText('Completed');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'sibling',sheet:'sibling-sheet',view:'sheet'}));
  await expect(status).toHaveValue('Completed');
  await status.selectOption('Closed');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'sheet'}));
  await expect(status).toHaveValue('Completed');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'summary'}));
  await expect(status).toHaveValue('Closed');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await expect(status).toHaveValue('Closed');
  const jobs=await page.evaluate(()=>window.estimator.getShared().lists[0].companies[0].projects);
  expect(jobs.find(job=>job.id==='north').status).toBe('Closed');
  expect(jobs.find(job=>job.id==='south').status).toBe('Completed');
  expect(jobs.find(job=>job.id==='north').takeoffs.every(takeoff=>takeoff.status===undefined)).toBe(true);
});

test('AI Data marks only the selected estimate and persists when toggled',async({page})=>{
  await openWorkbook(page);
  const checkbox=page.getByRole('checkbox',{name:'AI Data',exact:true});
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  const confirmation=page.getByRole('alertdialog',{name:'Confirm action'});
  await expect(confirmation).toContainText('Allow active AI access keys to read this estimate as reference data?');
  await expect(checkbox).not.toBeChecked();
  await confirmation.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(confirmation).toHaveCount(0);
  await expect(checkbox).toBeFocused();
  await checkbox.click();
  await confirmation.getByRole('combobox',{name:'Pricing method'}).selectOption('unit-price');
  await confirmation.getByRole('checkbox',{name:'Concrete pour',exact:true}).check();
  await confirmation.getByRole('checkbox',{name:'Demo',exact:true}).check();
  await confirmation.getByRole('checkbox',{name:'Saw cutting',exact:true}).check();
  await confirmation.getByRole('checkbox',{name:'Prevailing wage',exact:true}).check();
  await confirmation.getByRole('checkbox',{name:'Night time work',exact:true}).check();
  await confirmation.getByRole('button',{name:'Enable AI Data',exact:true}).click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(checkbox).toBeChecked();
  const data=await page.evaluate(()=>window.estimator.getShared());
  expect(data.lists[0].companies[0].projects[0].takeoffs[0].aiData).toBe(true);
  expect(data.lists[0].companies[0].projects[0].takeoffs[0].aiDataPrevailingWage).toBe(true);
  expect(data.lists[0].companies[0].projects[0].takeoffs[0].aiDataNightWork).toBe(true);
  expect(data.lists[0].companies[0].projects[1].takeoffs[0].aiDataPrevailingWage).toBeUndefined();
  expect(data.lists[0].companies[0].projects[1].takeoffs[0].aiDataNightWork).toBeUndefined();
  await expect(page.getByRole('checkbox',{name:'Prevailing wage',exact:true})).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Night time work',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'Prevailing wage',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Night time work',exact:true}).uncheck();
  expect(data.lists[0].companies[0].projects[0].takeoffs[0].aiDataMethod).toBe('unit-price');
  expect(data.lists[0].companies[0].projects[0].takeoffs[0].aiDataWorkTypes).toEqual(['concrete-pour','demo','saw-cutting']);
  await expect(page.getByRole('checkbox',{name:'Saw cutting',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'Saw cutting',exact:true}).uncheck();
  await page.getByRole('checkbox',{name:'Demo',exact:true}).uncheck();
  await page.locator('#takeoff-ai-data-method').selectOption('hourly');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#takeoff-ai-data-method')).toHaveValue('hourly');
  await expect(page.getByRole('checkbox',{name:'Prevailing wage',exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Night time work',exact:true})).not.toBeChecked();
  await page.screenshot({path:'test-results/ai-controls-layout.png',fullPage:true});
  await expect(page.getByRole('checkbox',{name:'Demo',exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Saw cutting',exact:true})).not.toBeChecked();
  await expect(page.getByRole('checkbox',{name:'Concrete pour',exact:true})).toBeChecked();
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'sheet'}));
  await expect(checkbox).not.toBeChecked();
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'summary'}));
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await confirmation.press('Escape');
  await expect(checkbox).toBeChecked();
  await checkbox.click();
  await confirmation.getByRole('button',{name:'Remove AI Data',exact:true}).click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(checkbox).not.toBeChecked();
  expect(await page.evaluate(()=>window.estimator.getShared().lists[0].companies[0].projects[0].takeoffs[0].aiData)).toBe(false);
});

test('AI Information lists checked estimates across workbooks and opens their exact location',async({page})=>{
  await openWorkbook(page);
  const suffix=Date.now().toString(),job='AI reference job '+suffix,estimate='AI reference estimate '+suffix;
  const data=workbook();
  const target=data.lists[0].companies[0].projects[1];target.name=job;target.takeoffs[0].name=estimate;target.takeoffs[0].aiData=true;target.takeoffs[0].aiDataMethod='mixed';target.takeoffs[0].aiDataWorkTypes=['concrete-pour','demo','saw-cutting'];
  target.takeoffs[0].sheets.push(sheet('extra','Extra page'));
  target.takeoffs[0].aiDataPrevailingWage=true;
  target.takeoffs[0].aiDataNightWork=true;
  const created=await (await page.request.post('/api/projects',{data:{name:'AI references '+suffix,book:data}})).json();
  await page.locator('#ai-information-open').click();
  await page.getByRole('button',{name:'+ Text entry',exact:true}).click();
  await page.locator('#ai-info-title').fill('Keep this unsaved draft');
  await page.getByRole('tab',{name:'AI Data',exact:true}).click();
  await page.locator('#ai-info-data-search').fill(suffix);
  const record=page.locator('.ai-info-estimate');
  await expect(record).toHaveCount(1);await expect(record).toContainText(job);await expect(record).toContainText('2 pages');
  await expect(record).not.toContainText('North takeoff');
  await expect(record).toContainText('Pricing method: Mixed');
  await expect(record).toContainText('Prevailing wage');
  await expect(record).toContainText('Night time work');
  await page.screenshot({path:'test-results/ai-data-layout.png',fullPage:true});
  await expect(record.locator('[data-work-type=concrete-pour]')).toHaveText('Concrete pour');
  await expect(record.locator('[data-work-type=demo]')).toHaveText('Demo');
  await expect(record.locator('[data-work-type=saw-cutting]')).toHaveText('Saw cutting');
  await page.locator('#ai-info-data-work-type').selectOption('saw-cutting');
  await expect(record).toHaveCount(1);
  await page.locator('#ai-info-data-work-type').selectOption('');
  await expect(record).toHaveCount(0);
  await page.locator('#ai-info-data-work-type').selectOption('both');
  await expect(record).toHaveCount(1);
  await page.locator('#ai-info-data-method').selectOption('hourly');
  await expect(record).toHaveCount(0);
  await page.locator('#ai-info-data-method').selectOption('mixed');
  await expect(record).toHaveCount(1);
  await page.getByRole('tab',{name:'Text library',exact:true}).click();
  await expect(page.locator('#ai-info-title')).toHaveValue('Keep this unsaved draft');
  await page.getByRole('tab',{name:'AI Data',exact:true}).click();
  page.once('dialog',dialog=>dialog.accept());
  await record.getByRole('button',{name:'Open estimate: '+estimate,exact:true}).click();
  await expect(page.locator('#ai-information-page')).toBeHidden();
  await expect.poll(()=>page.evaluate(()=>window.estimator.getLocation())).toMatchObject({list:'list',takeoff:'ts',view:'summary'});
  await expect(page.locator('#server-title')).toHaveText('AI references '+suffix);
  await expect(page.getByRole('checkbox',{name:'AI Data',exact:true})).toBeChecked();
  await page.getByRole('checkbox',{name:'AI Data',exact:true}).click();
  await page.getByRole('alertdialog',{name:'Confirm action'}).getByRole('button',{name:'Remove AI Data',exact:true}).click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.locator('#ai-information-open').click();
  await expect(record).toHaveCount(0);
  await expect(page.locator('#ai-info-data-count')).toContainText('0 of');
  const results=await (await page.request.get('/api/ai-information/estimates')).json();
  expect(results.estimates.some(item=>item.workbook===created.id)).toBe(false);
});

test('AI Information drag and drop moves folders with descendants, reorders and protects drafts',async({page})=>{
  await openWorkbook(page);
  const items=[
    {id:'a',kind:'folder',parent:'',title:'Rates',text:''},
    {id:'b',kind:'folder',parent:'',title:'Standards',text:''},
    {id:'nested',kind:'folder',parent:'a',title:'Concrete',text:''},
    {id:'child',kind:'entry',parent:'nested',title:'Cutting',text:'15 LF/hour'},
    {id:'entry',kind:'entry',parent:'',title:'Crew',text:'Two people'}
  ];
  const original=await (await page.request.get('/api/ai-information')).json();
  await page.request.put('/api/ai-information',{data:{revision:original.revision,items}});
  await page.locator('#ai-information-open').click();
  const row=id=>page.locator(`#ai-info-tree [data-id="${id}"]`);
  const read=async()=> (await (await page.request.get('/api/ai-information')).json()).items;
  await row('entry').dragTo(row('a'));
  await expect.poll(async()=>(await read()).find(i=>i.id==='entry').parent).toBe('a');
  await row('a').dragTo(row('b'));
  await expect.poll(async()=>(await read()).find(i=>i.id==='a').parent).toBe('b');
  expect((await read()).find(i=>i.id==='child').parent).toBe('nested');
  // A folder cannot be dropped into any of its own descendants.
  await row('b').dragTo(row('nested'));
  expect((await read()).find(i=>i.id==='b').parent).toBe('');
  await row('a').dragTo(page.locator('#ai-info-root-drop'));
  await expect.poll(async()=>(await read()).find(i=>i.id==='a').parent).toBe('');
  await row('a').dragTo(row('b'),{targetPosition:{x:20,y:2}});
  await expect.poll(async()=>(await read()).filter(i=>!i.parent).map(i=>i.id)).toEqual(['a','b']);
  await row('entry').click();
  await page.locator('#ai-info-text').fill('Unsaved crew guidance');
  await row('entry').dragTo(row('b'));
  await expect(page.locator('#ai-info-text')).toHaveValue('Unsaved crew guidance');
  expect((await read()).find(i=>i.id==='entry').parent).toBe('a');
  await expect(page.locator('#ai-info-status')).toContainText('Save your text edits');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await page.reload();
  await page.locator('#ai-information-open').click();
  await expect(page.locator('#ai-info-tree button')).toHaveText(['▸  Rates','▸  Concrete','—  Cutting','—  Crew','▸  Standards']);
});

test('AI Information organizes text, protects drafts and persists folder changes',async({page})=>{
  await openWorkbook(page);
  const existing=await (await page.request.get('/api/ai-information')).json();
  await page.request.put('/api/ai-information',{data:{revision:existing.revision,items:[]}});
  await page.locator('#ai-information-open').click();
  await page.getByRole('button',{name:'+ Folder',exact:true}).click();
  await page.locator('#ai-info-title').fill('Production rates');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await page.getByRole('button',{name:'+ Folder',exact:true}).click();
  await page.locator('#ai-info-title').fill('Concrete');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await page.getByRole('button',{name:'+ Text entry',exact:true}).click();
  await page.locator('#ai-info-title').fill('Concrete cutting');
  await page.locator('#ai-info-text').fill('15 LF per crew hour. Two-person crew.');
  await page.locator('#ai-info-text').press('End');
  await page.locator('#ai-info-text').pressSequentially('x');
  await page.locator('#ai-info-text').press('Control+z');
  await expect(page.locator('#ai-info-text')).toHaveValue('15 LF per crew hour. Two-person crew.');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await expect(page.locator('#ai-info-parent option:checked')).toHaveText('Production rates / Concrete');
  await page.locator('#ai-info-title').fill('Unsaved title');
  page.once('dialog',dialog=>dialog.dismiss());
  await page.getByRole('button',{name:'Back to estimating',exact:true}).click();
  await expect(page.locator('#ai-information-page')).toBeVisible();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Reload library',exact:true}).click();
  await expect(page.locator('#ai-info-title')).toHaveValue('Concrete cutting');
  await page.locator('#ai-info-parent').selectOption('');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await page.getByRole('button',{name:'Back to estimating',exact:true}).click();
  await page.reload();
  await page.locator('#ai-information-open').click();
  await page.locator('#ai-info-search').fill('Two-person');
  await page.locator('#ai-info-tree button').click();
  await expect(page.locator('#ai-info-text')).toHaveValue('15 LF per crew hour. Two-person crew.');
  await expect(page.locator('#ai-info-parent')).toHaveValue('');
  await expect(page.locator('#ai-information-page input[type=file]')).toHaveCount(0);
  await page.screenshot({path:'.tools/ai-information-desktop.png'});
  const current=await (await page.request.get('/api/ai-information')).json();
  await page.request.put('/api/ai-information',{data:{revision:current.revision,items:current.items.map(i=>i.title==='Concrete cutting'?{...i,text:'Updated by another estimator.'}:i)}});
  await page.locator('#ai-info-text').fill('My unsaved revision');
  await page.locator('#ai-info-save').click();
  await expect(page.locator('#ai-info-status')).toContainText('Someone changed');
  await expect(page.locator('#ai-info-text')).toHaveValue('My unsaved revision');
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Reload library',exact:true}).click();
  await expect(page.locator('#ai-info-text')).toHaveValue('Updated by another estimator.');
  await page.locator('#ai-info-search').fill('');
  await page.locator('#ai-info-tree button').filter({hasText:'Production rates'}).click();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#ai-information-page [data-action=delete]').click();
  await expect(page.locator('#ai-info-status')).toContainText('Saved.');
  await expect(page.locator('#ai-info-tree button')).toHaveCount(1);
  await page.setViewportSize({width:390,height:844});
  await page.locator('#ai-info-tree button').click();
  await page.screenshot({path:'.tools/ai-information-mobile.png'});
  expect(await page.locator('#ai-information-page').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});

test('delete workbook requires DELETE and removes the active workbook',async({page})=>{
  await openWorkbook(page);
  const name=await page.locator('#server-title').innerText();
  await page.locator('#server-projects').click();await page.locator('#server-tab-workbooks').click();
  await page.locator('#server-open').click();
  await page.getByRole('button',{name:'Delete workbook '+name,exact:true}).click();
  const submit=page.locator('#delete-workbook-dialog button[type=submit]');
  await expect(submit).toBeDisabled();
  await page.locator('#delete-workbook-confirm').fill('delete');await expect(submit).toBeDisabled();
  await page.locator('#delete-workbook-confirm').fill('DELETE');await expect(submit).toBeEnabled();
  await submit.click();await expect(page.locator('#delete-workbook-dialog')).not.toBeVisible();
  await expect(page.locator('#server-title')).toHaveText('Freedom Estimating');
  await expect(page.getByRole('button',{name:'Delete workbook '+name,exact:true})).toHaveCount(0);
});

test('scoped imports append projects and export just the selected customer',async({page})=>{
  await openWorkbook(page);
  await page.locator('#workspace-file').evaluate(el=>el.open=true);
  const chooser=page.waitForEvent('filechooser');await page.locator('#server-import').click();
  await (await chooser).setFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(workbook()))});
  await expect(page.locator('#import-detected')).toContainText('Detected: Workbook');
  await page.locator('#import-kind').selectOption('project');await page.locator('#import-preview button[type=submit]').click();
  await expect(page.locator('#transfer-dialog')).toBeVisible();
  await page.locator('#transfer-source').selectOption('1');
  await page.locator('#transfer-dialog button[type=submit]').click();
  await expect(page.locator('#transfer-dialog')).not.toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const data=await page.evaluate(()=>window.estimator.getShared());
  const projects=data.lists[0].companies[0].projects;
  expect(projects).toHaveLength(3);expect(projects[2].name).toBe('South job');expect(projects[2].id).not.toBe('south');
  expect(projects[2].takeoffs[0].sheets[0].rows[0].cost).toBe(125);
  await page.locator('#workspace-file').evaluate(el=>el.open=true);
  await page.locator('#server-export').click();await page.locator('#export-kind').selectOption('customer');await page.locator('#export-options button[type=submit]').click();
  const download=page.waitForEvent('download');await page.locator('#transfer-dialog button[type=submit]').click();
  const stream=await (await download).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  const exported=JSON.parse(Buffer.concat(chunks).toString());
  expect(exported._scope).toBe('customer');expect(exported.data.projects).toHaveLength(3);expect(exported.lists).toBeUndefined();
  await page.reload();await expect(page.locator('#server-status')).toHaveText('All changes saved');
  expect(await page.evaluate(()=>window.estimator.getShared().lists[0].companies[0].projects.length)).toBe(3);
});

test('takeoff Share creates selectable access links and revokes them',async({page})=>{
  await openWorkbook(page);
  await page.locator('#takeoff-share').click();await expect(page.locator('#share-name')).toHaveText('North takeoff');
  await expect(page.locator('#share-permission')).toHaveValue('read');await page.locator('#share-create').click();await expect(page.locator('#share-url')).toHaveValue(/\/share#[a-f0-9]{64}$/);
  await page.locator('#share-permission').selectOption('write');await page.locator('#share-create').click();
  const url=await page.locator('#share-url').inputValue();expect(url).toMatch(/\/share#[a-f0-9]{64}$/);
  await expect(page.locator('#share-links')).toContainText('View and edit');await expect(page.locator('#share-links')).toContainText('View only');
  await page.locator('#share-links p').filter({hasText:'View and edit'}).getByRole('button',{name:'Revoke'}).click();
  await expect(page.locator('#share-links p').filter({hasText:'View and edit'})).toContainText('Revoked');
});

test('takeoff AI access generates a scoped package, updates live, and offers undo', async ({page}) => {
  await openWorkbook(page,workbook(),'AI browser '+Date.now());
  await page.locator('#takeoff-ai-access').click();
  await expect(page.locator('#ai-access-scope')).toContainText('North takeoff');
  await page.locator('#ai-access-generate').click();
  await expect(page.locator('#ai-access-connection')).toHaveValue(/Authorization: Bearer/);
  const connection=await page.locator('#ai-access-connection').inputValue();
  expect(connection).toContain('Expires: Never');
  expect(connection).toContain('Unlimited saves.');
  // Restricted browsers may omit the Clipboard API entirely.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});
    document.execCommand=()=>false;
  });
  await page.locator('#ai-access-copy').click();
  await expect(page.locator('#ai-access-message')).toContainText('press Ctrl+C');
  expect(await page.locator('#ai-access-connection').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe(connection);
  // Permission rejection should also fall back, and report successful fallback copying.
  await page.evaluate(()=>{
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('Permission denied');}}});
    document.execCommand=command=>command==='copy';
  });
  await page.locator('#ai-access-copy').click();
  await expect(page.locator('#ai-access-message')).toHaveText('Connection package copied.');
  const key=/Authorization: Bearer ([a-f0-9]+)/.exec(connection)[1];
  const headers={Authorization:'Bearer '+key};
  const read=await (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  expect(read.takeoff.id).toBe('tn');
  read.takeoff.sheets[0].rows[0].name='AI updated cutting';
  const saved=await page.request.post('/api/ai/v1/save',{headers,data:{revision:read.revision,takeoff:read.takeoff,requestId:'browser-save'}});
  expect(saved.ok()).toBe(true);
  await page.locator('#ai-access-close').click();
  await expect(page.locator('#body .name-in').first()).toHaveValue('AI updated cutting');
  await page.locator('#takeoff-ai-access').click();
  await expect(page.locator('#ai-access-connection')).toHaveValue('');
  await expect(page.locator('#ai-access-grants')).toContainText('Active');
  await expect(page.locator('#ai-access-grants')).toContainText('never expires');
  await page.locator('#ai-access-changes summary').click();
  await page.getByRole('button',{name:'Undo AI change',exact:true}).click();
  await expect(page.locator('#ai-access-message')).toHaveText('AI change undone.');
  await page.locator('#ai-access-close').click();
  await expect(page.locator('#body .name-in').first()).toHaveValue('Concrete cutting');
  await page.locator('#takeoff-ai-access').click();
  const reread=await (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  reread.takeoff.sheets[0].rows[0].name='AI second save';
  expect((await page.request.post('/api/ai/v1/save',{headers,data:{revision:reread.revision,takeoff:reread.takeoff,requestId:'browser-second'}})).ok()).toBe(true);
  await page.getByRole('button',{name:'Revoke',exact:true}).click();
  await expect(page.locator('#ai-access-grants')).toContainText('Revoked');
  expect((await page.request.get('/api/ai/v1/takeoff',{headers})).status()).toBe(403);
});

test('Ctrl selection edits multiple fields and drags nonadjacent items together', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=['a','b','c','d'].map(id=>({id,kind:'labor',name:id,count:1,time:1,days:1,cost:10}));
  await openWorkbook(page,data);

  const row=id=>page.locator('#body tr[data-id="'+id+'"]');
  const first=row('a').locator('.name-in'), third=row('c').locator('.name-in');
  await first.click();
  await third.click({modifiers:['Control']});
  await expect(page.locator('.multi-input')).toHaveCount(2);
  await expect(first).toHaveClass(/multi-input/);
  await first.click({modifiers:['Control']});
  await expect(page.locator('.multi-input')).toHaveCount(1);
  await expect(third).toHaveClass(/multi-input/);
  await first.click({modifiers:['Control']});
  await expect(page.locator('.multi-input')).toHaveCount(2);
  await third.fill('Shared name');
  await expect(first).toHaveValue('Shared name');
  await expect(row('b').locator('.name-in')).toHaveValue('b');
  await page.keyboard.press('Escape');
  await expect(page.locator('.multi-input')).toHaveCount(0);
  const costA=row('a').getByRole('textbox',{name:'cost',exact:true}), costC=row('c').getByRole('textbox',{name:'cost',exact:true});
  await costA.click({modifiers:['Control']});
  await costC.click({modifiers:['Control']});
  await costC.fill('45');
  await expect(costA).toHaveValue('45');
  await page.keyboard.press('Control+z');
  await expect(costA).toHaveValue(/^10(?:\.00)?$/);
  await expect(costC).toHaveValue(/^10(?:\.00)?$/);
  await page.keyboard.press('Control+y');
  await expect(costA).toHaveValue(/^45(?:\.00)?$/);
  await expect(costC).toHaveValue(/^45(?:\.00)?$/);
  await page.keyboard.press('Escape');
  await row('a').locator('.grip').click({modifiers:['Control']});
  await row('c').locator('.grip').click({modifiers:['Control']});
  await expect(page.locator('#body .multi-row')).toHaveCount(2);
  const from=await row('a').locator('.grip').boundingBox(), to=await row('d').boundingBox();
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2); await page.mouse.down();
  await page.mouse.move(to.x+80,to.y+to.height*.8,{steps:12}); await page.mouse.up();
  expect(await page.evaluate(()=>window.estimator.exportBook().sheets[0].rows.map(r=>r.id))).toEqual(['b','d','a','c']);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(row('a').locator('.name-in')).toHaveValue('Shared name');
  expect(await page.evaluate(()=>window.estimator.exportBook().sheets[0].rows.map(r=>r.id))).toEqual(['b','d','a','c']);
});

test('Ctrl deselects immediately and keeps typing in the remaining selection', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=['a','b','c'].map(id=>({id,kind:'labor',name:id,count:1,time:1,days:1,cost:10}));
  await openWorkbook(page,data);
  const field=id=>page.locator('#body tr[data-id="'+id+'"] .name-in');
  await field('a').click();
  await field('b').click({modifiers:['Control']});
  await field('c').click({modifiers:['Control']});
  // Removing the focused cell must remove both selection and editing focus.
  await field('c').click({modifiers:['Control']});
  await expect(field('c')).not.toHaveClass(/multi-input/);
  await expect(field('c')).not.toBeFocused();
  await expect(page.locator('#body .multi-input')).toHaveCount(2);
  await page.keyboard.insertText('Selected only');
  for(const id of ['a','b']) await expect(field(id)).toHaveValue('Selected only');
  await expect(field('c')).toHaveValue('c');
  // Removing a different cell preserves the current selected editing field.
  await field('b').click({modifiers:['Control']});
  await expect(field('a')).toBeFocused();
  await expect(field('b')).not.toHaveClass(/multi-input/);
  await field('a').click({modifiers:['Control']});
  await expect(page.locator('#body .multi-input')).toHaveCount(0);
  await expect(field('a')).not.toBeFocused();
  // Toggling the same cell on and off requires exactly one click each time.
  await field('a').click({modifiers:['Control']});
  await expect(field('a')).toHaveClass(/multi-input/);
  await field('a').click({modifiers:['Control']});
  await expect(page.locator('#body .multi-input')).toHaveCount(0);
  await expect(field('a')).not.toBeFocused();
});

test('Shift selects a column range and Ctrl excludes individual cells from bulk edits', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=['a','b','c','d','e'].map(id=>({id,kind:'labor',name:id,count:1,time:1,days:1,cost:10}));
  await openWorkbook(page,data);
  const cost=id=>page.locator('#body tr[data-id="'+id+'"] input[aria-label="cost"]');
  await cost('a').click();
  await cost('e').click({modifiers:['Shift']});
  await expect(page.locator('#body .multi-input')).toHaveCount(5);
  await expect(page.locator('#body .multi-input:not([aria-label="cost"])')).toHaveCount(0);
  // Repeated Shift-click contracts the range around the original anchor.
  await cost('c').click({modifiers:['Shift']});
  await expect(page.locator('#body .multi-input')).toHaveCount(3);
  await cost('e').click({modifiers:['Shift']});
  await cost('b').click({modifiers:['Control']});
  await cost('d').click({modifiers:['Control']});
  await expect(page.locator('#body .multi-input')).toHaveCount(3);
  await cost('e').fill('45');
  for(const id of ['a','c','e']) await expect(cost(id)).toHaveValue('45');
  for(const id of ['b','d']) await expect(cost(id)).toHaveValue(/^10(?:\.00)?$/);
  await cost('b').click({modifiers:['Control']});
  await expect(page.locator('#body .multi-input')).toHaveCount(4);
  await page.keyboard.press('Escape');
  await cost('e').click();
  await cost('a').click({modifiers:['Shift']});
  await expect(page.locator('#body .multi-input')).toHaveCount(5);
  await page.keyboard.press('Escape');
  await expect(page.locator('#body .multi-input')).toHaveCount(0);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  for(const id of ['a','c','e']) await expect(cost(id)).toHaveValue(/^45(?:\.00)?$/);
  for(const id of ['b','d']) await expect(cost(id)).toHaveValue(/^10(?:\.00)?$/);
});

test('Shift column ranges skip collapsed rows and cells without editable values', async ({page}) => {
  const data=workbook();
  const item=id=>({id,kind:'labor',name:id,count:1,time:1,days:1,cost:10});
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=[
    item('a'),{id:'section',type:'section',name:'Hidden section',collapsed:true},item('hidden'),
    {id:'end',type:'sectionEnd'},{...item('blank'),kind:'none'},item('b'),item('c')
  ];
  await openWorkbook(page,data);
  const cost=id=>page.locator('#body tr[data-id="'+id+'"] input[aria-label="cost"]');
  await page.locator('#body tr[data-id="section"] .caret[aria-expanded="true"]').click();
  await expect(cost('hidden')).not.toBeVisible();
  await cost('a').click();
  // A different column starts a fresh anchor instead of selecting a rectangle.
  await page.locator('#body tr[data-id="c"] .name-in').click({modifiers:['Shift']});
  await expect(page.locator('#body .multi-input')).toHaveCount(0);
  await cost('a').click();
  await cost('c').click({modifiers:['Shift']});
  await expect(page.locator('#body .multi-input')).toHaveCount(3);
  await cost('c').fill('25');
  for(const id of ['a','b','c']) await expect(cost(id)).toHaveValue('25');
  await expect(cost('hidden')).toHaveValue(/^10(?:\.00)?$/);
});

test('section deletion offers keeping items or deleting the complete nested section', async ({page}) => {
  const data=workbook();
  const sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  const item=id=>({id,kind:'labor',name:id,count:1,time:1,days:1,cost:10});
  sh.rows=[item('before'),{id:'parent',type:'section',name:'Parent'},item('inside'),
    {id:'child',type:'section',name:'Child'},item('nested'),{id:'child-end',type:'sectionEnd',sid:'child'},
    {id:'parent-end',type:'sectionEnd',sid:'parent'},item('after')];
  await openWorkbook(page,data);
  const remove=()=>page.locator('#body tr[data-id="parent"]').getByRole('button',{name:'Delete this section',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Delete section',exact:true});
  const ids=()=>page.evaluate(()=>window.estimator.exportBook().sheets[0].rows.map(r=>r.id));
  await remove();
  await expect(dialog).toContainText('Do you want to delete the items under this section as well?');
  await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();
  await page.keyboard.press('Escape');
  expect(await ids()).toEqual(sh.rows.map(r=>r.id));
  await remove();
  await dialog.getByRole('button',{name:'Keep items',exact:true}).click();
  expect(await ids()).toEqual(['before','inside','child','nested','child-end','after']);
  await page.keyboard.press('Control+z');
  expect(await ids()).toEqual(sh.rows.map(r=>r.id));
  await remove();
  await dialog.getByRole('button',{name:'Delete section and items',exact:true}).click();
  expect(await ids()).toEqual(['before','after']);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('North scope');
  expect(await ids()).toEqual(['before','after']);
});

test('company names suggest existing matches while typing and reject duplicates across lists', async ({page}) => {
  const data=workbook();
  data.lists.push({id:'archive',name:'Archive',companies:[{id:'archived-company',name:'Empire Builders',projects:[]}]});
  await openWorkbook(page,data);await page.locator('#server-projects').click();
  const companies=()=>page.evaluate(()=>window.estimator.getShared().lists.flatMap(list=>list.companies));
  await page.locator('#addCompany').click();
  const name=page.locator('#editor').getByLabel('Company name',{exact:true});
  const error=page.locator('#company-name-error');
  const matches=page.locator('#company-name-matches');
  await expect(matches).toBeHidden();
  await name.fill('  EMP ');
  await expect(matches).toContainText('Empire Builders');
  await expect(matches).toContainText('Archive');
  await expect(name).toBeFocused();
  await name.fill('builders');await expect(matches).toContainText('Empire Builders');
  await name.fill('');await expect(matches).toBeHidden();
  await page.locator('#editor').getByLabel('Phone',{exact:true}).fill('555-0123');
  for(const value of ['Freedom Customer','  freedom   CUSTOMER  ','EMPIRE builders']){
    await name.fill(value);await page.locator('#edSave').click();
    await expect(error).toContainText('already exists');
    await expect(name).toHaveAttribute('aria-invalid','true');
    await expect(name).toBeFocused();
    await expect(page.locator('#editor').getByLabel('Phone',{exact:true})).toHaveValue('555-0123');
    expect((await companies()).length).toBe(2);
  }
  await expect(error).toContainText('Archive');
  await name.fill('New customer');await expect(error).toBeHidden();await expect(matches).toBeHidden();
  await page.locator('#edSave').click();await expect(page.locator('#editor')).toBeHidden();
  const added=(await companies()).find(company=>company.name==='New customer');
  expect(added.phone).toBe('555-0123');
  await page.locator(`[data-company="${added.id}"]`).getByTitle('Edit this company',{exact:true}).click();
  await expect(matches).toBeHidden();
  await name.fill('freedom customer');await page.locator('#edSave').click();
  await expect(error).toContainText('already exists');
  await name.fill('New customer');await page.locator('#edSave').click();
  await expect(page.locator('#editor')).toBeHidden();
  await page.locator('[data-company="co"]').getByTitle('Edit this company',{exact:true}).click();
  await page.locator('#editor').getByLabel('Phone',{exact:true}).fill('555-0199');
  await page.locator('#edSave').click();await expect(page.locator('#editor')).toBeHidden();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const saved=await companies();expect(saved.length).toBe(3);
  expect(saved.find(company=>company.id==='co').phone).toBe('555-0199');
});

test('company deletion confirms, switches active takeoffs, and preserves an empty list', async ({page}) => {
  const data=workbook();
  data.lists[0].companies.push({id:'remaining',name:'Remaining customer',projects:[{id:'remaining-project',name:'Other job',takeoffs:[{id:'remaining-takeoff',name:'Other takeoff',sheets:[sheet('remaining-sheet','Remaining scope')]}]}]});
  await openWorkbook(page,data); await page.locator('#server-projects').click();
  await page.locator('#addCompany').click();
  await page.locator('#editor').getByLabel('Company name',{exact:true}).fill('New empty company');
  await page.locator('#edSave').click();
  const added=page.locator('.p-co').filter({has:page.getByText('New empty company',{exact:true})});
  const dialog=page.getByRole('alertdialog');
  await added.getByTitle('Delete this company',{exact:true}).click();
  await expect(dialog).toContainText('all its projects and takeoffs');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(added).toBeVisible();
  await added.getByTitle('Delete this company',{exact:true}).click();
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(added).toHaveCount(0);
  await page.locator('[data-company="co"]').getByTitle('Delete this company',{exact:true}).click();
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#title')).toHaveValue('Remaining scope');
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies.map(c=>c.id))).toEqual(['remaining']);
  await page.locator('[data-company="remaining"]').getByTitle('Delete this company',{exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-company="remaining"]')).toBeVisible();
  await page.locator('[data-company="remaining"]').getByTitle('Delete this company',{exact:true}).click();
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#emptyTakeoff')).toBeVisible();
  await expect(page.locator('#sheetCard')).not.toBeVisible();
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies)).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#title')).toHaveValue('Remaining scope');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#emptyTakeoff')).toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#emptyTakeoff')).toBeVisible();
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies)).toEqual([]);
});

test('projects and takeoffs can duplicate, move and copy between customers', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].collapsed=false;
  data.lists[0].companies[0].projects[0].collapsed=false;
  data.lists[0].companies.push({id:'dest-co',name:'Destination customer',projects:[{id:'dest-pr',name:'Destination job',takeoffs:[]}]});
  const original=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  original.units=[{id:'area',label:'SF',qty:50}];
  original.rows=[{id:'sec',type:'section',name:'Section',units:{area:{qty:20}}},...original.rows,{id:'end',type:'sectionEnd',sid:'sec'}];
  await openWorkbook(page,data); await page.locator('#server-projects').click();
  await page.locator('[data-company="co"] > .p-head > .p-name').click();
  await page.locator('[data-project="north"] > .p-head > .p-name').click();
  const dialog=page.getByRole('dialog',{name:'Move or copy project',exact:true});
  const projectAction=page.locator('[data-project="north"] > .p-head').getByTitle('Move or copy this project');
  await expect(page.getByTitle('Duplicate this project',{exact:true})).toHaveCount(0);
  await projectAction.click();
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await projectAction.click();
  await dialog.getByRole('button',{name:'Duplicate',exact:true}).click();
  let companies=await page.evaluate(()=>window.estimator.exportBook().lists[0].companies);
  const copied=companies[0].projects.find(p=>p.name==='North job copy').takeoffs[0];
  expect(copied.id).not.toBe('tn');
  expect(copied.active).toBe(copied.sheets[0].id);
  expect(copied.sheets[0].rows[2].sid).toBe(copied.sheets[0].rows[0].id);
  expect(copied.sheets[0].rows[0].units[copied.sheets[0].units[0].id]).toEqual({qty:20});
  await projectAction.click();
  await dialog.getByLabel('Action',{exact:true}).selectOption('copy');
  await dialog.getByLabel('Destination company').selectOption('dest-co');
  await dialog.getByRole('button',{name:'Copy',exact:true}).click();
  await projectAction.click();
  await dialog.getByLabel('Action',{exact:true}).selectOption('move');
  await expect(dialog.getByRole('button',{name:'Move',exact:true})).toBeDisabled();
  await dialog.getByLabel('Destination company').selectOption('dest-co');
  await dialog.getByRole('button',{name:'Move',exact:true}).click();
  companies=await page.evaluate(()=>window.estimator.exportBook().lists[0].companies);
  expect(companies[0].projects.some(p=>p.id==='north')).toBe(false);
  expect(companies[1].projects.map(p=>p.name)).toEqual(['Destination job','North job copy','North job']);
  await page.keyboard.press('Control+z');
  await expect(page.locator('[data-company="co"] [data-project="north"]')).toHaveCount(1);
  const takeoffDialog=page.getByRole('dialog',{name:'Move or copy takeoff',exact:true});
  const takeoffAction=page.locator('[data-takeoff="tn"]').getByTitle('Move or copy this takeoff');
  for (const action of ['duplicate','copy','move']){
    await takeoffAction.click();
    await takeoffDialog.getByLabel('Action',{exact:true}).selectOption(action);
    if(action!=='duplicate'){
      await takeoffDialog.getByLabel('Destination company').selectOption('dest-co');
      await takeoffDialog.getByLabel('Destination project').selectOption('dest-pr');
    }
    await takeoffDialog.getByRole('button',{name:action==='duplicate'?'Duplicate':action==='copy'?'Copy':'Move',exact:true}).click();
  }
  companies=await page.evaluate(()=>window.estimator.exportBook().lists[0].companies);
  expect(companies[0].projects.find(p=>p.id==='north').takeoffs.map(t=>t.name)).toEqual(['North takeoff copy']);
  expect(companies[1].projects[0].takeoffs.map(t=>t.name)).toEqual(['North takeoff copy','North takeoff']);
  await expect(page.locator('#title')).toHaveValue('North scope');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('North scope');
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies[1].projects[0].takeoffs.map(t=>t.name))).toEqual(['North takeoff copy','North takeoff']);
});

test('new jobs detect addresses across customers and offer existing or new projects', async ({page}) => {
  const data=workbook();
  data.lists[0].companies.push({id:'other-customer',name:'Other Customer',projects:[
    {id:'existing-job',name:'Existing job',address:'123 Main Street, Suite 4',takeoffs:[{id:'existing-takeoff',name:'Existing takeoff',sheets:[sheet('existing-sheet','Existing scope')]}]}
  ]});
  await openWorkbook(page,data);
  const add=page.locator('[data-company="co"] > .p-head button[title="Add a project"]');
  const editor=page.locator('#editor');
  const dialog=page.getByRole('dialog',{name:'This address has already been added'});
  await page.locator('#server-projects').click();
  await add.click();
  await editor.getByLabel('Project name',{exact:true}).fill('New job');
  await editor.getByLabel('Address',{exact:true}).fill(' 123 MAIN ST. #4 ');
  await page.locator('#edSave').click();
  await expect(dialog).toContainText('Other Customer');
  await expect(dialog).toContainText('Existing job');
  await dialog.getByRole('button',{name:'Back',exact:true}).click();
  await expect(editor.getByLabel('Project name',{exact:true})).toHaveValue('New job');
  await page.locator('#edSave').click();
  await dialog.getByRole('button',{name:'View existing project'}).click();
  await expect(editor.getByLabel('Project name',{exact:true})).toHaveValue('Existing job');
  await expect(page.locator('#title')).toHaveValue('Existing scope');
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies[0].projects.length)).toBe(2);
  await page.locator('#edCancel').click();
  await add.click();
  await editor.getByLabel('Project name',{exact:true}).fill('Intentional duplicate');
  await editor.getByLabel('Address',{exact:true}).fill('123 Main St Ste 4');
  await page.locator('#edSave').click();
  await dialog.getByRole('button',{name:'Create new project anyway'}).click();
  await expect(editor).not.toBeVisible();
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies[0].projects.length)).toBe(3);
  await add.click();
  await editor.getByLabel('Project name',{exact:true}).fill('Different suite');
  await editor.getByLabel('Address',{exact:true}).fill('123 Main St Suite 5');
  await page.locator('#edSave').click();
  await expect(editor).not.toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(()=>window.estimator.exportBook().lists[0].companies[0].projects.length)).toBe(4);
});

test('visible page actions duplicate a complete option and confirm deletion', async ({page}) => {
  const data = workbook();
  const source = data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  source.units = [{id:'unit-original',label:'SF',qty:100}];
  source.rows = [{id:'section-original',type:'section',name:'Section',units:{'unit-original':{qty:25}}},
    ...source.rows, {id:'end-original',type:'sectionEnd',sid:'section-original'}];
  source.notes = 'Keep these notes';
  await openWorkbook(page, data);
  const actions = page.locator('#workspace-page-actions');
  await expect(page.locator('#deleteSheet')).toHaveCount(0);
  await expect(page.locator('#workspace-estimate #deleteSheet')).toHaveCount(0);
  const original = await page.evaluate(() => window.estimator.exportBook().sheets[0]);
  await actions.locator('#duplicateSheet').click();
  await expect(page.locator('#title')).toHaveValue('North scope (copy)');
  const copied = await page.evaluate(() => window.estimator.exportBook().sheets[1]);
  expect(copied.id).not.toBe(original.id);
  expect(copied.rows[0].id).not.toBe(original.rows[0].id);
  expect(copied.rows[2].sid).toBe(copied.rows[0].id);
  expect(copied.rows[0].units[copied.units[0].id]).toEqual({qty:25});
  expect(copied.rows[1].name).toBe(original.rows[1].name);
  expect(copied.fees[0].pct).toBe(original.fees[0].pct);
  expect(copied.notes).toBe(original.notes);
  await page.locator('#title').fill('Independent copy');
  expect(await page.evaluate(() => window.estimator.exportBook().sheets[0].title)).toBe('North scope');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Independent copy');
  await page.getByRole('button',{name:'Delete option 2',exact:true}).click();
  await expect(page.locator('#rail .tab[data-sheet]')).toHaveCount(2);
  await expect(page.getByRole('alertdialog')).toContainText('Are you sure you want to delete this option?');
  await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#title')).toHaveValue('North scope');
  await expect(page.locator('#rail .tab[data-sheet]')).toHaveCount(1);
  await expect(page.getByRole('button',{name:'Delete option 1',exact:true})).toBeDisabled();
  await expect(page.locator('#rail .tab[data-sheet]')).toHaveCount(1);
});

test('option close buttons skip empty pages and use cancellable dialogs for content and reset', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets.push({id:'blank',title:'',
    fees:[{id:'blank-fee',label:'Fee',pct:3}],units:[{id:'blank-unit',label:'SF',qty:''}],
    rows:[{id:'blank-row',kind:'labor',name:'',count:1,time:1,days:1,cost:'',markup:0}]});
  await openWorkbook(page,data);
  const dialog=page.getByRole('alertdialog');
  await page.getByRole('button',{name:'Delete option 2',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#rail .tab[data-sheet]')).toHaveCount(1);
  await expect(page.locator('#title')).toHaveValue('North scope');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#rail .tab[data-sheet]')).toHaveCount(2);
  await page.locator('#rail [data-sheet="blank"]').click();
  await page.locator('#sheetNotes').fill('Notes alone must count as content');
  await page.getByRole('button',{name:'Delete option 2',exact:true}).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Cancel'})).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#sheetNotes')).toHaveValue('Notes alone must count as content');
  await page.getByRole('button',{name:'Delete option 1',exact:true}).click();
  await dialog.getByRole('button',{name:'Cancel'}).click();
  await expect(page.locator('#title')).toHaveValue('');
  await page.getByRole('button',{name:'Delete option 1',exact:true}).click();
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#rail [data-sheet="blank"]')).toHaveAttribute('aria-selected','true');
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#reset').click();
  await expect(page.locator('#reset')).toHaveText('Reset sheet');
  await expect(dialog).toContainText('Are you sure you want to reset this sheet?');
  await page.keyboard.press('Escape');
  await expect(page.locator('#sheetNotes')).toHaveValue('Notes alone must count as content');
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#reset').click();
  await dialog.getByRole('button',{name:'Reset',exact:true}).click();
  await expect(page.locator('#sheetNotes')).toHaveValue('');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#sheetNotes')).toHaveValue('Notes alone must count as content');
  await expect(page.getByRole('button',{name:'Delete option 1',exact:true})).toBeDisabled();
});

test('option tabs still reorder with separate close buttons', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets.push(sheet('second','Second'),sheet('third','Third'));
  await openWorkbook(page,data);
  const labels=page.locator('#rail .option-tab-label');
  await expect(labels).toHaveText(['1 - North scope','2 - Second','3 - Third']);
  const source=await page.locator('#rail [data-sheet="third"]').boundingBox();
  const target=await page.locator('#rail [data-sheet="sn"]').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(target.x+2,target.y+target.height/2,{steps:15});
  await page.mouse.up();
  expect(await page.locator('#rail .tab[data-sheet]').evaluateAll(tabs=>tabs.map(t=>t.dataset.sheet))).toEqual(['third','sn','second']);
  await expect(page.locator('#rail .option-close')).toHaveCount(3);
  await expect(labels).toHaveText(['1 - Third','2 - North scope','3 - Second']);
  expect(await page.evaluate(() => window.estimator.exportBook().sheets.map(s=>s.num))).toEqual([1,2,3]);
  await page.keyboard.press('Control+z');
  expect(await page.locator('#rail .tab[data-sheet]').evaluateAll(tabs=>tabs.map(t=>t.dataset.sheet))).toEqual(['sn','second','third']);
  await expect(labels).toHaveText(['1 - North scope','2 - Second','3 - Third']);
  await page.keyboard.press('Control+y');
  await expect(labels).toHaveText(['1 - Third','2 - North scope','3 - Second']);
  await page.locator('#title').fill('Concrete cutting and removal throughout the entire building');
  await expect(labels.nth(1)).toHaveText('2 - Concrete cutting and r…');
  await expect(page.locator('#rail [data-sheet="sn"] .tab-tip')).toHaveText('Concrete cutting and removal throughout the entire building');
  expect((await page.locator('#rail [data-sheet="sn"]').boundingBox()).width).toBeLessThanOrEqual(210);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(labels).toHaveText(['1 - Third','2 - Concrete cutting and r…','3 - Second']);
  await page.getByRole('button',{name:'Delete option 1',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();
  await expect(labels).toHaveText(['1 - Concrete cutting and r…','2 - Second']);
});

test('many option tabs scroll within the window and keep the selected page visible', async ({page}) => {
  const data=workbook(), tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  tk.sheets=Array.from({length:24},(_,i)=>sheet('option-'+i,'Scope for option '+(i+1)));
  await openWorkbook(page,data);
  const rail=page.locator('#rail');
  const size=await rail.evaluate(el=>({width:el.clientWidth,content:el.scrollWidth,right:el.getBoundingClientRect().right,viewport:innerWidth}));
  expect(size.content).toBeGreaterThan(size.width);
  expect(size.right).toBeLessThanOrEqual(size.viewport);
  await rail.hover();
  await page.mouse.wheel(0,600);
  await expect.poll(()=>rail.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);
  const before=await rail.evaluate(el=>el.scrollLeft);
  await page.locator('#title').fill('Renamed first page');
  expect(await rail.evaluate(el=>el.scrollLeft)).toBeCloseTo(before,0);
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'option-23',view:'sheet'}));
  const selected=rail.locator('[data-sheet="option-23"]');
  await expect(selected).toBeInViewport();
  await expect(selected).toHaveAttribute('aria-selected','true');
  await rail.locator('.tab-add').click();
  await expect(rail.locator('.option-tab')).toHaveCount(25);
  await expect(rail.locator('[aria-selected="true"]')).toBeInViewport();
  await page.setViewportSize({width:800,height:900});
  expect(await rail.evaluate(el=>el.getBoundingClientRect().right <= innerWidth)).toBe(true);
  await rail.evaluate(el=>{el.scrollLeft=0;});
  await rail.locator('.tab-summary').click();
  await expect(page.locator('#summaryCard')).toBeVisible();
});

test('large takeoffs batch typing saves and add items without rebuilding existing rows', async ({page}) => {
  const data=workbook(), sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.rows=Array.from({length:180},(_,i)=>({...sh.rows[0],id:'large-'+i,name:'Line '+i}));
  await openWorkbook(page,data);
  const field=page.locator('#body input[aria-label="Item name"]').first();
  await field.focus();
  await field.press('End');
  await page.evaluate(()=>{
    const original=window.estimator.getShared;
    window.snapshotReads=0;
    window.estimator.getShared=function(...args){window.snapshotReads++;return original.apply(this,args);};
    window.retainedRow=document.querySelector('#body tr');
  });
  const suffix=' responsive typing';
  await field.pressSequentially(suffix,{delay:10});
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  expect(await page.evaluate(()=>window.snapshotReads)).toBeLessThan(suffix.length/2);
  await expect(field).toHaveValue('Line 0'+suffix);
  await page.evaluate(()=>{window.retainedIcon=document.querySelector('#body .kind-btn svg');});
  await page.locator('#body input[aria-label="cost"]').first().fill('200');
  await expect(page.locator('#tGrand .v')).toHaveText('23,252.25');
  expect(await page.evaluate(()=>window.retainedIcon===document.querySelector('#body .kind-btn svg'))).toBe(true);
  await page.locator('#add').click();
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(181);
  expect(await page.evaluate(()=>window.retainedRow===document.querySelector('#body tr'))).toBe(true);
  await expect(page.locator('#body input[aria-label="Item name"]').last()).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(180);
  await expect(field).toHaveValue('Line 0'+suffix);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(field).toHaveValue('Line 0'+suffix);
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(180);
});

test('pending takeoff typing survives remote edits and an offline reconnect', async ({page,browser,baseURL}) => {
  await openWorkbook(page);
  const context=await browser.newContext({baseURL});
  try {
    const peer=await context.newPage();
    await peer.goto('/');
    await peer.locator('#server-login-name').fill('Typing peer '+Date.now());
    await peer.locator('#server-login-password').fill('1313');
    await peer.locator('#server-login-form button').click();
    await expect(peer.locator('#server-login')).not.toBeVisible();
    const name=await page.locator('#server-title').textContent();
    await peer.locator('#server-list .server-project').filter({hasText:name}).click();
    await expect(peer.locator('#title')).toHaveValue('North scope');
    const selector='#body input[aria-label="Item name"]';
    await page.locator(selector).first().fill('Pending local name');
    await peer.locator('#title').fill('Remote scope');
    await expect(page.locator('#title')).toHaveValue('Remote scope');
    await expect(peer.locator(selector).first()).toHaveValue('Pending local name');
    await page.context().setOffline(true);
    await page.evaluate(()=>{
      const original=window.estimator.getShared;
      window.offlineSnapshots=0;
      window.estimator.getShared=function(...args){window.offlineSnapshots++;return original.apply(this,args);};
    });
    await page.locator(selector).first().fill('Offline typed name');
    await expect.poll(()=>page.evaluate(()=>window.offlineSnapshots)).toBeGreaterThan(0);
    await peer.locator('#title').fill('Scope edited during outage');
    await page.context().setOffline(false);
    await expect(peer.locator(selector).first()).toHaveValue('Offline typed name',{timeout:20000});
    await expect(page.locator('#server-status')).toHaveText('All changes saved');
    await page.reload();
    await expect(page.locator(selector).first()).toHaveValue('Offline typed name');
    await expect(page.locator('#title')).toHaveValue('Scope edited during outage');
  } finally { await context.close(); }
});

test('Ctrl+Z and Ctrl+Y undo workbook edits, additions, deletions and editor drafts', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await openWorkbook(page);
  await expect(page.locator('#workspace-undo')).toBeDisabled();
  await page.locator('#title').fill('Changed scope');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#title')).toHaveValue('North scope');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#title')).toHaveValue('Changed scope');
  await page.locator('#add').click();
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(1);
  await page.keyboard.press('Control+Shift+z');
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(2);
  await page.locator('#duplicateSheet').click();
  await expect(page.locator('#rail [data-sheet]')).toHaveCount(2);
  await page.getByRole('button',{name:'Delete option 2',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Delete',exact:true}).click();
  await expect(page.locator('#rail [data-sheet]')).toHaveCount(1);
  await page.keyboard.press('Control+z');
  await expect(page.locator('#rail [data-sheet]')).toHaveCount(2);
  await expect(page.locator('#title')).toHaveValue('Changed scope (copy)');
  await page.keyboard.press('Control+y');
  await expect(page.locator('#rail [data-sheet]')).toHaveCount(1);
  const draftName=page.locator('#body input[aria-label="Item name"]').first();
  await draftName.fill('Draft change');
  await page.keyboard.press('Control+z');
  await expect(draftName).toHaveValue('Concrete cutting');
  await page.keyboard.press('Control+y');
  await expect(draftName).toHaveValue('Draft change');
  await draftName.blur();
  await expect(page.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Draft change');
  await page.locator('#workspace-undo').click();
  await expect(page.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Concrete cutting');
  await page.locator('#workspace-redo').click();
  await expect(page.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Draft change');
  await page.keyboard.press('Control+z');
  await page.locator('#title').fill('New branch');
  await expect(page.locator('#workspace-redo')).toBeDisabled();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('New branch');
  await expect(page.locator('#workspace-undo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('undo only affects my edits and redo syncs to other estimators', async ({page,browser,baseURL}) => {
  await openWorkbook(page);
  const context=await browser.newContext({baseURL});
  try {
    const peer=await context.newPage();
    await peer.goto('/');
    await peer.locator('#server-login-name').fill('Undo peer '+Date.now());
    await peer.locator('#server-login-password').fill('1313');await peer.locator('#server-login-password').fill('1313');await peer.locator('#server-login-form button').click();
    await expect(peer.locator('#server-login')).not.toBeVisible();
    const name=await page.locator('#server-title').textContent();
    await peer.locator('#server-list .server-project').filter({hasText:name}).click();
    await expect(peer.locator('#title')).toHaveValue('North scope');
    await page.locator('#title').fill('My scope');
    await expect(peer.locator('#title')).toHaveValue('My scope');
    await expect(peer.locator('#workspace-undo')).toBeDisabled();
    await peer.locator('#body input[aria-label="cost"]').first().focus();
    await peer.locator('#body input[aria-label="cost"]').first().fill('88');
    await expect(page.locator('#body input[aria-label="cost"]').first()).toHaveValue('88.00');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#title')).toHaveValue('North scope');
    await expect(peer.locator('#title')).toHaveValue('North scope');
    await expect(peer.locator('#body input[aria-label="cost"]').first()).toHaveValue(/^88(?:\.00)?$/);
    await page.keyboard.press('Control+y');
    await expect(peer.locator('#title')).toHaveValue('My scope');
    await expect(page.locator('#body input[aria-label="cost"]').first()).toHaveValue('88.00');
    await peer.keyboard.press('Control+z');
    await expect(page.locator('#body input[aria-label="cost"]').first()).toHaveValue('125.00');
    await expect(page.locator('#title')).toHaveValue('My scope');
    const draft=page.locator('#body input[aria-label="Item name"]').first();
    await draft.fill('My draft');
    await peer.locator('#body input[aria-label="cost"]').first().focus();
    await peer.locator('#body input[aria-label="cost"]').first().fill('99');
    await expect(page.locator('#body input[aria-label="cost"]').first()).toHaveValue('99.00');
    await page.keyboard.press('Control+z');
    await expect(draft).toHaveValue('Concrete cutting');
    await page.keyboard.press('Control+y');
    await expect(draft).toHaveValue('My draft');
    await draft.blur();
    await expect(peer.locator('#body input[aria-label="Item name"]').first()).toHaveValue('My draft');
    await expect(peer.locator('#body input[aria-label="cost"]').first()).toHaveValue(/^99(?:\.00)?$/);
    await page.context().setOffline(true);
    await page.locator('#title').fill('Offline edit');
    await page.keyboard.press('Control+z');
    await expect(page.locator('#title')).toHaveValue('My scope');
    await page.keyboard.press('Control+y');
    await expect(page.locator('#title')).toHaveValue('Offline edit');
    await page.context().setOffline(false);
    await expect(peer.locator('#title')).toHaveValue('Offline edit',{timeout:20000});
  } finally { await context.close(); }
});

test('an older server missing preferences still opens workbooks without a JSON crash',async({page})=>{
  await page.route('**/api/preferences',route=>route.fulfill({status:404,contentType:'text/html',body:'<!DOCTYPE html><html>Cannot GET /api/preferences</html>'}));
  await openWorkbook(page);
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await expect(page.locator('#sheetCard')).toBeVisible();
  await expect(page.locator('#server-message')).toContainText('restart the Node project');
  await expect(page.locator('#server-message')).not.toContainText('Unexpected token');
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#workspace-cursor')).toBeDisabled();
});

test('last selected workbook survives sign-out and opens in a fresh browser',async({page,browser,baseURL})=>{
  const name='Remember workbook '+Date.now();
  await openWorkbook(page,workbook(),name);
  await page.locator('#server-projects').click();await page.locator('#server-tab-workbooks').click();
  const selected='Last selected '+Date.now();
  await page.locator('#server-new').click();await page.locator('#server-name-input').fill(selected);
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/projects') && r.request().method()==='GET');
  await page.locator('#server-name-form button[type=submit]').click();
  await refreshed;
  await expect(page.locator('#server-title')).toHaveText(selected);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.locator('#rail .tab-add').click();
  await page.locator('#title').fill('Remember this tab');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const lastLocation=await page.evaluate(()=>window.estimator.getLocation());
  await expect.poll(async()=>{
    const projects=await (await page.request.get('/api/projects')).json();
    const id=projects.find(p=>p.name===selected).id;
    const recent=await (await page.request.get('/api/projects/'+id+'/recent?user='+encodeURIComponent(name))).json();
    return recent.items[0]?.sheet;
  }).toBe(lastLocation.sheet);
  await page.locator('#server-signout').click();await expect(page.locator('#server-login')).toBeVisible();
  const context=await browser.newContext({baseURL});
  try {
    const fresh=await context.newPage();await fresh.goto('/');
    await fresh.locator('#server-login-name').fill(name);await fresh.locator('#server-login-password').fill('1313');await fresh.locator('#server-login-password').fill('1313');await fresh.locator('#server-login-form button').click();
    await expect(fresh.locator('#server-status')).toHaveText('All changes saved');
    await expect(fresh.locator('#server-title')).toHaveText(selected);
    await expect(fresh.locator('#title')).toHaveValue('Remember this tab');
    await expect(fresh.locator('#sheetCard')).toBeVisible();
  } finally {await context.close();}
});

test('shared cursor style persists without changing local mouse cursors', async ({page}) => {
  await openWorkbook(page,workbook(),'Cursor tester '+Date.now());
  await page.locator('#workspace-view > summary').click();
  const saved = page.waitForResponse(r=>r.url().endsWith('/api/preferences') && r.request().method()==='PUT');
  await page.locator('#workspace-cursor').selectOption('arrow');
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-shared-cursor','arrow');
  await expect(page.locator('#add')).toHaveCSS('cursor','pointer');
  await expect(page.locator('#title')).toHaveCSS('cursor','text');
  await expect(page.locator('#sheetTable .col-resizer').first()).toHaveCSS('cursor','col-resize');
  await page.locator('#workspace-color-toggle').click();
  await expect(page.locator('#workspace-color-options .workspace-color-line[data-color="#8755ce"]')).toHaveCSS('background-color','rgb(135, 85, 206)');
  await expect(page.locator('#workspace-color-options .workspace-color-line')).toHaveCount(8);
  await page.screenshot({path:'test-results/cursor-color-picker.png'});
  await page.getByRole('radio',{name:'Purple',exact:true}).check();
  await expect(page.locator('body')).toHaveAttribute('data-shared-cursor-color','#8755ce');
  await page.reload();
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#workspace-cursor')).toHaveValue('arrow');
  await expect(page.locator('#workspace-color-name')).toHaveText('Purple');
  await expect(page.locator('#workspace-color-toggle .workspace-color-line')).toHaveCSS('background-color','rgb(135, 85, 206)');
  const savedCrosshair = page.waitForResponse(r=>r.url().endsWith('/api/preferences') && r.request().method()==='PUT');
  await page.locator('#workspace-cursor').selectOption('crosshair');
  expect((await savedCrosshair).ok()).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-shared-cursor','crosshair');
  await expect(page.locator('body')).not.toHaveCSS('cursor','crosshair');
});

test('large estimate scrolls without changing rows or totals', async ({page}) => {
  const data = workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows = Array.from({length:250}, (_,i) =>
    ({id:'scroll-'+i,kind:'labor',name:'Cutting task '+i,count:1,time:1,days:1,cost:125,markup:0,note:'Crew detail'}));
  await openWorkbook(page, data);
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#roundTotal').selectOption('100');
  await page.locator('#workspace-estimate > summary').press('Escape');
  const total = await page.locator('#tGrand').textContent();
  const session = await page.context().newCDPSession(page);
  await session.send('Performance.enable');
  const before = (await session.send('Performance.getMetrics')).metrics;
  const timings = await page.evaluate(async () => {
    const scroll = document.querySelector('#sheetCard .scroll'), gaps = [];
    let previous = performance.now();
    for (let i=0;i<90;i++) {
      await new Promise(requestAnimationFrame);
      const now=performance.now(); gaps.push(now-previous); previous=now;
      scroll.scrollTop = (i+1)*35;
    }
    return {frames:gaps.length, over32ms:gaps.filter(x=>x>32).length, average:gaps.reduce((a,b)=>a+b)/gaps.length, scrollTop:scroll.scrollTop};
  });
  const after = (await session.send('Performance.getMetrics')).metrics;
  const delta = name => (after.find(m=>m.name===name).value-before.find(m=>m.name===name).value)*1000;
  console.log('Scroll profile', JSON.stringify({...timings,taskMs:delta('TaskDuration'),layoutMs:delta('LayoutDuration'),styleMs:delta('RecalcStyleDuration')}));
  expect(timings.scrollTop).toBeGreaterThan(1000);
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(250);
  await expect(page.locator('#tGrand')).toHaveText(total);
});

test('compact library creation menu opens each editor and supports keyboard dismissal', async ({page}) => {
  await openWorkbook(page);
  await page.locator('#libToggle').click();
  const create=page.locator('#libCreate');
  for(const [button,mode] of [['libNew','item'],['libNewPart','part'],['libNewCon','construct'],['libNewSvc','service'],['libNewSec','section'],['libNewScope','scope']]){
    await expect(page.locator('#'+button)).not.toBeVisible();
    await create.locator('summary').click();
    await page.locator('#'+button).click();
    await expect(page.locator('#edTitle')).toHaveText('New '+mode);
    await expect(create).not.toHaveAttribute('open','');
    await page.locator('#edCancel').click();
  }
  await create.locator('summary').press('Enter');
  await expect(page.locator('#libNew')).toBeVisible();
  await create.locator('summary').press('Escape');
  await expect(page.locator('#libNew')).not.toBeVisible();
  await page.locator('.lib-save-existing > summary').click();
  await page.locator('#libCaptureType').selectOption('page');
  await expect(page.locator('#libCapScope')).toBeVisible();
});

test('library folders can be renamed with contents preserved and conflicting names rejected', async ({page}) => {
  const data = workbook();
  data.folders = ['Tools','Tools/Empty','Other'];
  data.templates = {items:[{id:'saw',name:'Saw',folder:'Tools',kind:'equipment',cost:125}],
    sections:[{id:'crew',name:'Crew',folder:'Tools/Nested',items:[]}]};
  await openWorkbook(page, data);
  await page.locator('#libToggle').click();
  const folder = page.locator('#libAll .folder-head[data-folder="Tools"]');
  await folder.getByRole('button', {name:'Rename',exact:true}).click();
  const name = page.getByRole('textbox', {name:'Folder name',exact:true});
  await name.fill('Cancelled');
  await name.press('Escape');
  await expect(folder).toBeVisible();
  await folder.getByRole('button', {name:'Rename',exact:true}).click();
  await name.fill('Other');
  await name.press('Enter');
  await expect(name).toBeVisible();
  expect(await name.evaluate(el => el.validationMessage)).toContain('already exists');
  await name.fill('Equipment');
  await name.press('Enter');
  await expect(page.locator('#libAll .folder-head[data-folder="Equipment"]')).toBeVisible();
  const renamed = await page.evaluate(() => window.estimator.exportBook());
  expect(renamed.folders).toEqual(['Equipment','Equipment/Empty','Other']);
  expect(renamed.templates.items[0].folder).toBe('Equipment');
  expect(renamed.templates.sections[0].folder).toBe('Equipment/Nested');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#libAll .folder-head[data-folder="Tools"]')).toBeVisible();
  await page.keyboard.press('Control+y');
  await expect(page.locator('#libAll .folder-head[data-folder="Equipment"]')).toBeVisible();
  await page.locator('#libAll .folder-head[data-folder="Equipment"]').click();
  await expect(page.locator('#libAll .tpl-name').getByText('Saw',{exact:true})).toBeVisible();
  await page.locator('#libAll .folder-head[data-folder="Equipment/Empty"]').getByRole('button',{name:'Rename',exact:true}).click();
  await name.fill('Spare');
  await name.press('Enter');
  await expect(page.locator('#libAll .folder-head[data-folder="Equipment/Spare"]')).toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const saved = await page.evaluate(() => window.estimator.exportBook());
  expect(saved.folders).toContain('Equipment/Spare');
  expect(saved.templates.sections[0].folder).toBe('Equipment/Nested');
});

test('all library template types and empty folders require deletion confirmation', async ({page}) => {
  const data=workbook();
  data.folders=['Empty folder'];
  data.templates=Object.fromEntries(['items','sections','parts','constructs','services','scopes'].map(kind =>
    [kind,[{id:'delete-'+kind,name:'Delete '+kind,kind:'labor',items:[],parts:[],cost:10}]]));
  await openWorkbook(page,data);
  await page.locator('#libToggle').click();
  const dialog=page.getByRole('alertdialog');
  for (const kind of Object.keys(data.templates)) {
    const card=page.locator('#libAll .tpl').filter({has:page.getByText('Delete '+kind,{exact:true})});
    await card.getByTitle('Delete this template').click();
    await expect(dialog).toContainText('Delete '+kind);
    await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
    await expect(card).toBeVisible();
    await card.getByTitle('Delete this template').click();
    await dialog.getByRole('button',{name:'Delete',exact:true}).click();
    await expect(card).toHaveCount(0);
  }
  const folder=page.locator('#libAll .folder-head[data-folder="Empty folder"]');
  await folder.getByTitle('Delete this folder',{exact:true}).click();
  await expect(dialog).toContainText('Empty folder');
  await page.keyboard.press('Escape');
  await expect(folder).toBeVisible();
  await folder.getByTitle('Delete this folder',{exact:true}).click();
  await dialog.getByRole('button',{name:'Delete',exact:true}).click();
  await expect(folder).toHaveCount(0);
});

test('library Duplicate creates independent copies in the same folder and saves them', async ({page}) => {
  const data = workbook();
  data.templates = {items:[{id:'original-template',name:'Saw',folder:'Tools',kind:'equipment',cost:125,
    note:'Keep this detail',pics:[{id:'original-picture',name:'Saw photo',url:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}]}]};
  await openWorkbook(page, data);
  await page.locator('#libToggle').click();
  await page.locator('#libAll .folder-head[data-folder="Tools"]').click();
  const original = page.locator('#libAll .tpl').filter({has:page.getByText('Saw', {exact:true})});
  await original.getByRole('button', {name:'Duplicate',exact:true}).click();
  await expect(page.locator('#libAll .tpl-name').getByText('Saw (copy)', {exact:true})).toBeVisible();
  await expect(page.locator('#editor')).not.toBeVisible();
  const items = await page.evaluate(() => window.estimator.exportBook().templates.items);
  expect(items).toHaveLength(2);
  expect(items[1].id).not.toBe(items[0].id);
  expect(items[1].pics[0].id).not.toBe(items[0].pics[0].id);
  expect(items[1]).toMatchObject({folder:'Tools',kind:'equipment',cost:125,note:'Keep this detail'});
  expect(items[1].pics[0].url).toBe(items[0].pics[0].url);
  await original.getByRole('button', {name:'Duplicate',exact:true}).click();
  await expect(page.locator('#libAll .tpl-name').getByText('Saw (copy 2)', {exact:true})).toBeVisible();
  const copy = page.locator('#libAll .tpl').filter({has:page.getByText('Saw (copy)', {exact:true})});
  await copy.getByTitle('Delete this template').click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('Saw (copy)');
  await expect(copy).toBeVisible();
  await confirmation.getByRole('button', {name:'Cancel',exact:true}).click();
  await expect(copy).toBeVisible();
  await copy.getByTitle('Delete this template').click();
  await page.keyboard.press('Escape');
  await expect(copy).toBeVisible();
  await copy.getByTitle('Delete this template').click();
  await confirmation.getByRole('button', {name:'Delete',exact:true}).click();
  await expect(copy).toHaveCount(0);
  await expect(original).toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const saved = await page.evaluate(() => window.estimator.exportBook().templates.items);
  expect(saved.map(t => t.name)).toEqual(['Saw','Saw (copy 2)']);
});

test('sheet lines no longer expose picture controls', async ({page}) => {
  await openWorkbook(page);
  await expect(page.locator('#body .pic-btn-row, #body .pic-strip')).toHaveCount(0);
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#showPics, #hidePics')).toHaveCount(0);
  await page.locator('#workspace-view > summary').press('Escape');
  await expect(page.locator('#body .card-btn')).toHaveCount(0);
});

test('custom dropdowns support company, project and takeoff values and survive reloads', async ({page}) => {
  await openWorkbook(page);
  await page.locator('#server-projects').click();
  await page.locator('#projOptions').click();
  const editor = page.locator('#edBody');
  for (const [location, choices] of [['Project','North\nSouth\nSouth\n  West  \n'],['Company','Commercial\nResidential'],['Takeoff','Alex\nSam']]) {
    await page.getByRole('tab',{name:location,exact:true}).click();
    await editor.getByLabel('Field type',{exact:true}).selectOption('dropdown');
    await editor.getByLabel('Dropdown choices',{exact:true}).fill(choices);
    await editor.getByLabel('Field type',{exact:true}).focus();
  }
  await page.getByRole('tab',{name:'Project',exact:true}).click();
  await expect(editor.getByLabel('Dropdown choices',{exact:true})).toHaveValue('North\nSouth\nWest');
  await editor.getByLabel('Field name',{exact:true}).fill('Area');
  await editor.getByLabel('Field type',{exact:true}).focus();
  await page.screenshot({path:'test-results/custom-dropdown-settings.png',fullPage:true});
  await page.locator('#edCancel').click();
  await page.getByTitle('Edit this company',{exact:true}).click();
  await editor.getByLabel('Account',{exact:true}).selectOption('Commercial');
  await page.locator('#edSave').click();
  await page.locator('[data-company="co"] > .p-head > .p-name').click();
  await page.locator('[data-project="north"]').getByTitle('Edit this project',{exact:true}).click();
  await expect(editor.getByLabel('Area',{exact:true})).toHaveValue('North');
  await editor.getByLabel('Area',{exact:true}).selectOption('West');
  await page.locator('#edCancel').click();
  await page.locator('[data-project="north"]').getByTitle('Edit this project',{exact:true}).click();
  await expect(editor.getByLabel('Area',{exact:true})).toHaveValue('North');
  await editor.getByLabel('Area',{exact:true}).selectOption('West');
  await page.locator('#edSave').click();
  await page.locator('[data-project="north"] > .p-head > .p-name').click();
  await page.locator('[data-takeoff="tn"]').getByTitle('Edit this takeoff',{exact:true}).click();
  await editor.getByLabel('Estimator',{exact:true}).selectOption('Sam');
  await page.locator('#edSave').click();
  await page.locator('#projOptions').click();
  await editor.getByLabel('Dropdown choices',{exact:true}).fill('North\nSouth');
  await page.locator('#edCancel').click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const saved = await page.evaluate(() => window.estimator.getShared());
  const company = saved.lists[0].companies.find(c => c.id === 'co'), project = company.projects.find(p => p.id === 'north');
  expect(company.custom.Account).toBe('Commercial');
  expect(project.custom.Area).toBe('West');
  expect(project.takeoffs[0].custom.Estimator).toBe('Sam');
  expect(saved.customFieldSettings.project.Area).toEqual({type:'dropdown',options:['North','South']});
  expect(saved.customFieldSettings.project.Region).toBeUndefined();
  if (!await page.locator('#projOptions').isVisible()) await page.locator('#server-projects').click();
  if (!await page.locator('[data-project="north"]').isVisible()) await page.locator('[data-company="co"] > .p-head > .p-name').click();
  await page.locator('[data-project="north"]').getByTitle('Edit this project',{exact:true}).click();
  await expect(editor.getByLabel('Area',{exact:true})).toHaveValue('West');
  await expect(editor.getByLabel('Area',{exact:true}).locator('option:checked')).toHaveText('West (current value)');
  await page.locator('#edCancel').click();
  await page.locator('#projOptions').click();
  await editor.getByLabel('Field type',{exact:true}).selectOption('text');
  await expect(editor.getByLabel('Dropdown choices',{exact:true})).not.toBeVisible();
  await page.locator('#edCancel').click();
  await page.locator('[data-project="north"]').getByTitle('Edit this project',{exact:true}).click();
  await expect(editor.getByRole('textbox',{name:'Area',exact:true})).toHaveValue('West');
});

test('one project drawer retains hierarchy, custom details and filters', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openWorkbook(page); await page.locator('#server-projects').click();
  await expect(page.locator('#projToggle')).not.toBeVisible();
  await expect(page.locator('#server-drawer #projects')).toBeVisible();
  await expect(page.locator('#server-browser')).not.toBeVisible();
  await expect(page.locator('.workbook-controls')).not.toBeVisible();
  await expect(page.locator('#projBody [data-project]')).toHaveCount(0);
  await page.locator('[data-company="co"] > .p-head > .p-name').click();
  await expect(page.locator('#projBody [data-takeoff]')).toHaveCount(0);
  await page.locator('[data-project="south"] > .p-head.lvl2 > .p-name').click();
  const editSize=await page.getByTitle('Edit this project',{exact:true}).first().boundingBox();
  expect(editSize.width).toBeGreaterThanOrEqual(44);expect(editSize.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('#projBody')).toContainText('Freedom Customer');
  await expect(page.locator('#projBody')).toContainText('North job');
  await page.locator('[data-takeoff="ts"]').click(); await expect(page.locator('#summaryCard')).toBeVisible();
  await page.locator('#projOptions').click();
  await expect(page.locator('#edTitle')).toHaveText('Project settings');
  const drawerBox = await page.locator('#server-drawer').boundingBox(), editorBox = await page.locator('#editor').boundingBox();
  expect(editorBox.x).toBeGreaterThanOrEqual(drawerBox.x + drawerBox.width);
  await expect(page.locator('#edBody')).not.toContainText('Appearance');
  await expect(page.locator('#edBody')).not.toContainText('Download');
  await page.locator('#edBody input[aria-label="Field name"]').fill('Area');
  await page.getByRole('tab',{name:'Filters',exact:true}).click();
  await expect(page.getByRole('checkbox',{name:'Area',exact:true})).toBeChecked();
  await page.getByRole('tab',{name:'Statuses',exact:true}).click();
  await page.locator('input[aria-label="Status name"]').first().fill('Bidding');
  await page.locator('#edCancel').click();
  await page.locator('#projFilterBtn').click();
  await expect(page.locator('.filter-pop')).toContainText('Area');
  await page.locator('.filter-pop').getByRole('checkbox',{name:'North',exact:true}).check();
  await expect(page.locator('#projBody')).toContainText('North job');
  await expect(page.locator('#projBody')).not.toContainText('South job');
  await page.locator('.filter-pop').getByRole('button',{name:'Clear filters'}).click();
  await expect(page.locator('#projBody')).toContainText('South job');
  await page.locator('#server-title').click();
  await page.locator('#workspace-file > summary').click();
  const downloaded = page.waitForEvent('download'); await page.locator('#server-export').click();await page.locator('#export-options button[type=submit]').click();
  const download = await downloaded;
  const stream = await download.createReadStream(); let text=''; for await(const chunk of stream) text += chunk.toString();
  const saved = JSON.parse(text), projects = saved.lists[0].companies[0].projects;
  expect(projects[0].custom.Area).toBe('North'); expect(projects[1].custom.Area).toBe('South');
  expect(projects[0].status).toBe('Bidding'); expect(saved.filterFields).toContain('Area');
  await page.locator('#projOptions').click();
  await page.screenshot({path:'test-results/project-settings.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('projects show my current takeoff and page even when the hierarchy is collapsed', async ({page}) => {
  const data = workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets.push(sheet('sn2','Second scope'));
  await openWorkbook(page,data);
  await page.locator('#server-projects').click();
  const company = page.locator('[data-company="co"] > .p-head');
  await expect(company).toHaveAttribute('title', /North job \/ North takeoff · Tab 1/);
  await expect(page.locator('.project-current-location,.project-presence')).toHaveCount(0);
  await company.locator('.p-name').click();
  const north = page.locator('[data-project="north"] > .p-head');
  await expect(north).toHaveClass(/is-current-location/);
  await north.locator('.p-name').click();
  const takeoff = page.locator('[data-takeoff="tn"]');
  await expect(takeoff).toHaveAttribute('aria-current','location');
  await page.locator('#rail [data-sheet="sn2"]').click();
  await expect(takeoff).toHaveAttribute('title','You are here · Tab 2');
  await page.locator('#rail .tab-summary').click();
  await expect(company).toHaveAttribute('title', /Summary/);
  await page.locator('[data-project="south"] > .p-head > .p-name').click();
  await page.locator('[data-takeoff="ts"]').click();
  await expect(page.locator('[data-takeoff="ts"]')).toHaveAttribute('aria-current','location');
  await expect(takeoff).not.toHaveClass(/is-current-location/);
  await expect(north.locator('.project-current-location')).toHaveCount(0);
  await expect(company).toHaveAttribute('title', /South job \/ South takeoff/);
  await page.locator('#projCollapse').click();
  await expect(company).toHaveClass(/has-location/);
});

test('project presence, tab highlights, collapse and recent views work for two users',async({page,browser,baseURL})=>{
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets.push(sheet('sn2','Second scope'));
  const name='Navigator '+Date.now(), other='Viewer '+Date.now();
  await openWorkbook(page,data,name);
  const context=await browser.newContext({baseURL}), peer=await context.newPage();
  try {
    await peer.goto('/');await peer.locator('#server-login-name').fill(other);await peer.locator('#server-login-password').fill('1313');await peer.locator('#server-login-password').fill('1313');await peer.locator('#server-login-form button').click();
    const workbookName=await page.locator('#server-title').textContent();
    await peer.locator('#server-list .server-project').filter({hasText:workbookName}).click();
    await expect(peer.locator('#server-status')).toHaveText('All changes saved');
    await peer.locator('#rail [data-sheet="sn2"]').click();
    await expect(page.locator('#rail [data-sheet="sn2"] .tab-presence')).toContainText(other);
    await expect(page.locator('#server-people .server-person')).toHaveAttribute('title',/Freedom Customer → North job → North takeoff → Tab 2/);
    await page.locator('#server-projects').click();
    await page.locator('[data-company="co"] > .p-head > .p-name').click();
    await expect(page.locator('[data-project="north"] > .p-head.lvl2')).toHaveAttribute('title',new RegExp(other));
    await expect(page.locator('.project-presence,.project-current-location')).toHaveCount(0);
    const peerColor=await page.locator('#server-people .server-person').evaluate(el=>el.style.getPropertyValue('--peer'));
    expect(await page.locator('[data-project="north"] > .p-head.lvl2').evaluate(el=>el.style.getPropertyValue('--location-stripe'))).toContain(peerColor);
    await page.locator('#projCollapse').click();
    await expect(page.locator('#projBody [data-project]')).toHaveCount(0);
    await expect(page.locator('[data-company="co"] > .p-head')).toHaveAttribute('title',new RegExp(other));
    // Collapsing is personal and must not collapse the other user's hierarchy.
    await peer.locator('#server-projects').click();
    await peer.locator('[data-company="co"] > .p-head > .p-name').click();
    await peer.locator('[data-project="south"] > .p-head.lvl2 > .p-name').click();
    await expect(peer.locator('[data-takeoff="ts"]')).toBeVisible();
    await peer.locator('[data-takeoff="ts"]').click();
    await expect(page.locator('#rail .tab-presence')).toHaveCount(0);
    await expect(page.locator('#server-people .server-person')).toHaveAttribute('title',/South job/);
    await page.locator('#server-tab-recent').click();
    await expect(page.locator('#server-recent-user')).toHaveValue(name);
    await expect(page.locator('#server-recent-list')).toContainText('North job');
    await expect(page.locator('#server-recent-user option').filter({hasText:other})).toHaveCount(1);
    await page.locator('#server-recent-user').selectOption(other);
    await expect(page.locator('#server-recent-list')).toContainText('South job');
    await expect(page.locator('#server-recent-list .recent-project').first()).toContainText('South job');
    await page.locator('#server-recent-list .recent-project').filter({hasText:'North job'}).click();
    await expect(page.locator('#title')).toHaveValue('Second scope');
    await expect(page.locator('#server-hierarchy')).toBeVisible();
    await expect(page.locator('.workbook-controls')).not.toBeVisible();
    await page.screenshot({path:'test-results/project-navigation.png',fullPage:true});
    await page.locator('#server-tab-recent').click();
    await page.screenshot({path:'test-results/recent-projects.png',fullPage:true});
    await page.reload();
    await expect(page.locator('#server-status')).toHaveText('All changes saved');
    await expect(page.locator('#server-title')).toHaveText(workbookName);
    await expect(page.locator('#title')).toHaveValue('Second scope');
    await page.locator('#server-projects').click();
    await expect(page.locator('#projBody [data-project]')).toHaveCount(0);
    await page.locator('[data-company="co"] > .p-head > .p-name').click();
    await expect(page.locator('#projBody [data-takeoff]')).toHaveCount(0);
  } finally {await context.close();}
});

test('Scope fetch keeps per-takeoff review marks and never replaces estimate pages',async({page})=>{
  const data=workbook();data.lists[0].companies[0].projects[0].zztakeoffLink='https://www.zztakeoff.com/app/takeoff?projectId=north';
  let revision=0,failed=false,polls=0;
  await page.route('**/api/zztakeoff/status',route=>route.fulfill({json:{connected:true}}));
  await page.route('**/api/zztakeoff/scope/jobs',route=>{polls=0;return route.fulfill({status:202,json:{id:'test-job',state:'pending'}});});
  await page.route('**/api/zztakeoff/scope/jobs/test-job',route=>{
    if(polls++===0)return route.fulfill({json:{state:'pending',stage:'reading scope items'}});
    if(failed)return route.fulfill({json:{state:'failed',error:'ZZTakeoff timed out while reading scope items. Your saved scope is unchanged.'}});
    return route.fulfill({json:{state:'complete',result:{source:'north',fetchedAt:'2026-09-30T12:00:00Z',items:[
      {id:'a',name:revision?'Concrete slab revised':'Concrete slab',measurements:revision?'area: 180 SF':'area: 160 SF',group:'Level 1',pages:[{id:'p1',name:'A1 - Floor plan'}]},
      {id:'b',name:'Sawcut perimeter',measurements:'length: 80 LF',group:'Level 1',pages:[{id:'p1',name:'A1 - Floor plan'}]},
      {id:'c',name:'Extra slab',measurements:'area: 160 SF',group:'Alternate',pages:[{id:'p2',name:'A2 - Details'}]},
      ...(revision?[]:[{id:'d',name:'Reference note',group:'Notes'}])
    ]}}});
  });
  await openWorkbook(page,data);
  const original=await page.evaluate(()=>JSON.stringify(window.estimator.getShared().lists[0].companies[0].projects.find(p=>p.id==='north').takeoffs[0].sheets));
  await page.locator('#rail .tab-scope').click();
  await expect(page.locator('#scopeCard')).toBeVisible();
  await expect(page.locator('#scope-ai-access')).toBeChecked();
  await page.locator('#scope-ai-access').uncheck();
  await expect(page.locator('#scope-source')).toHaveValue(data.lists[0].companies[0].projects[0].zztakeoffLink);
  await page.locator('#scope-fetch').click();
  await expect(page.locator('#scope-message')).toContainText('reading scope items');
  await expect(page.locator('#scope-fetch')).toBeDisabled();
  await expect(page.locator('[data-scope-item]')).toHaveCount(4);
  await expect(page.locator('.scope-page-heading th:first-child')).toHaveText(['A1 - Floor plan','A2 - Details','No source page assigned']);
  await page.locator('#scope-search').fill('A2 - Details');
  await expect(page.locator('[data-scope-item]')).toHaveCount(1);
  await page.locator('#scope-search').fill('');
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Add note for Concrete slab',exact:true}).click();
  await page.getByRole('textbox',{name:'Notes for Concrete slab',exact:true}).fill('Night shift only');
  await page.getByRole('button',{name:'Hide note for Concrete slab',exact:true}).click();
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab',exact:true})).toBeHidden();
  await page.getByRole('button',{name:'Show note for Concrete slab',exact:true}).click();
  await page.getByRole('combobox',{name:'Estimate page for Concrete slab',exact:true}).selectOption('sn');
  const allAi=page.getByRole('checkbox',{name:'Show all Scope items to AI',exact:true});
  await expect(allAi).toBeChecked();
  await page.getByRole('checkbox',{name:'Show Concrete slab to AI',exact:true}).uncheck();
  expect(await allAi.evaluate(el=>el.indeterminate)).toBe(true);
  await page.locator('#scope-search').fill('Concrete slab');
  await page.getByRole('checkbox',{name:'Show page group A1 - Floor plan to AI',exact:true}).check();
  await page.getByRole('checkbox',{name:'Show page group A1 - Floor plan to AI',exact:true}).uncheck();
  await page.locator('#scope-search').fill('');
  await expect(page.getByRole('checkbox',{name:'Show Sawcut perimeter to AI',exact:true})).not.toBeChecked();
  await allAi.check();
  await page.getByRole('checkbox',{name:'Show Concrete slab to AI',exact:true}).uncheck();
  await page.getByRole('button',{name:'Exclude Concrete slab',exact:true}).click();
  await page.getByRole('button',{name:'Ignore Reference note',exact:true}).click();
  await page.getByRole('button',{name:'Duplicate Extra slab',exact:true}).click();
  await expect(page.locator('#scope-count')).toHaveText('1 included / 4 source items');
  await page.locator('#scope-filter').selectOption('excluded');
  await expect(page.locator('[data-scope-item]')).toHaveCount(1);
  await page.locator('#scope-filter').selectOption('all');
  await page.screenshot({path:'test-results/scope-review.png',fullPage:true});
  revision++;
  await page.locator('#scope-fetch').click();
  await expect(page.locator('[data-scope-item="a"]')).toContainText('180 SF');
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab revised',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab revised',exact:true})).toHaveValue('Night shift only');
  await expect(page.getByRole('combobox',{name:'Estimate page for Concrete slab revised',exact:true})).toHaveValue('sn');
  await expect(page.getByRole('checkbox',{name:'Show Concrete slab revised to AI',exact:true})).not.toBeChecked();
  await expect(page.locator('[data-scope-item="a"]')).toHaveAttribute('data-status','excluded');
  await expect(page.locator('[data-scope-item="c"]')).toHaveAttribute('data-status','duplicate');
  await expect(page.locator('[data-scope-item="d"]')).toHaveCount(0);
  await expect(page.locator('.scope-page-heading th:first-child')).toHaveText(['A1 - Floor plan','A2 - Details']);
  await expect(page.locator('#scope-count')).toHaveText('1 included / 3 source items');
  await page.getByRole('button',{name:'Exclude Concrete slab revised',exact:true}).click();
  await expect(page.locator('[data-scope-item="a"]')).toHaveAttribute('data-status','included');
  failed=true;await page.locator('#scope-fetch').click();
  await expect(page.locator('#scope-message')).toContainText('timed out while reading scope items');
  await expect(page.locator('[data-scope-item]')).toHaveCount(3);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab revised',exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Notes for Concrete slab revised',exact:true})).toHaveValue('Night shift only');
  await expect(page.locator('#scopeCard')).toBeVisible();
  await expect(page.locator('[data-scope-item="c"]')).toHaveAttribute('data-status','duplicate');
  await expect(page.locator('[data-scope-item="d"]')).toHaveCount(0);
  await expect(page.locator('#scope-ai-access')).not.toBeChecked();
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.getShared().lists[0].companies[0].projects.find(p=>p.id==='north').takeoffs[0].sheets))).toBe(original);
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'scope'}));
  await expect(page.locator('[data-scope-item]')).toHaveCount(0);
  await expect(page.locator('#scope-source')).toHaveValue('');
  await expect(page.locator('#scope-ai-access')).toBeChecked();
});

test('summary shows customer, job address maps and the active takeoff', async ({page}) => {
  const data=workbook(), company=data.lists[0].companies[0];
  company.address='12 Office Road'; company.phone='555-0100'; company.email='office@example.com';
  company.projects[0].address='100 Main St, Suite #4 & Yard';
  company.projects[0].zztakeoffLink='zztakeoff.com/project/north';
  company.projects[0].contacts='Site supervisor';
  company.projects[0].takeoffs[0].note='Sawcut and removal';
  data.sumProjOpen=false; data.sumTkOpen=false;
  await openWorkbook(page,data);
  const pageMap=page.locator('#workspace-map');
  const zzTakeoff=page.locator('#workspace-zztakeoff');
  for (const view of ['sheet','summary','scope','load','wage']) {
    await page.evaluate(view=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view}),view);
    await expect(page.locator('#server-bar #workspace-map')).toHaveCount(0);
    await expect(page.locator(`#${view}Card .eyebrow-row #workspace-map`)).toBeInViewport();
    await expect(page.locator(`#${view}Card #workspace-map + #workspace-zztakeoff`)).toBeInViewport();
    await expect(zzTakeoff).toHaveAttribute('href','https://zztakeoff.com/project/north');
    await expect(zzTakeoff).toHaveAttribute('target','_blank');
    await expect(zzTakeoff).toHaveAttribute('rel','noopener noreferrer');
    if (view === 'sheet') await expect(page.locator('#workspace-toggle-notes ~ #workspace-map')).toBeVisible();
    await expect(pageMap).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.projects[0].address));
  }
  await page.locator('#rail .tab-summary').click();
  const details=page.locator('#sumBlocks');
  const headerMap=pageMap;
  await expect(page.locator('#summaryMap, #summaryMapHint, .summary-map-actions')).toHaveCount(0);
  await expect(page.locator('#summaryProjectName')).toHaveText('North job');
  const context=page.locator('#summaryContext');
  await expect(context).toBeVisible();
  for (const value of ['Freedom Customer','North takeoff','Open',company.projects[0].address]) await expect(context).toContainText(value);
  await expect(headerMap).toBeVisible();
  await expect(headerMap).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.projects[0].address));
  await expect(headerMap).toHaveAttribute('target','_blank');
  await expect(page.locator('#summaryMapHint')).toHaveCount(0);
  await expect(details.locator('.customer')).toContainText('Freedom Customer');
  await expect(details.locator('.customer')).toContainText('555-0100');
  await expect(details.locator('.customer')).toContainText('office@example.com');
  await expect(details.locator('.summary-project')).toBeInViewport();
  await expect(details.locator('.summary-project')).toContainText('North job');
  await expect(details.locator('.summary-project')).toContainText('Site supervisor');
  await expect(details.locator('.tk')).toContainText('North takeoff');
  await expect(details.locator('.tk')).toContainText('Sawcut and removal');
  const map=details.locator('.summary-project .summary-map-link');
  await expect(map).toBeInViewport();
  await expect(map).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.projects[0].address));
  await expect(map).toHaveAttribute('target','_blank');
  await expect(map).toHaveAttribute('rel','noopener noreferrer');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'summary'}));
  await expect(details.locator('.summary-project')).toContainText('South job');
  await expect(page.locator('#summaryProjectName')).toHaveText('South job');
  await expect(zzTakeoff).toHaveAttribute('aria-disabled','true');
  await expect(zzTakeoff).not.toHaveAttribute('href',/.+/);
  await expect(context).toContainText('South takeoff');
  await expect(context).toContainText('Completed');
  await expect(context).toContainText(company.address);
  await expect(context).not.toContainText('100 Main St');
  await expect(details.locator('.tk')).toContainText('South takeoff');
  await expect(details.locator('.summary-project')).toContainText('Customer address');
  await expect(map).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address));
  await expect(headerMap).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address));
  await expect(page.locator('#workspace-map')).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address));
  await expect(details).not.toContainText('100 Main St');
  await openWorkbook(page,workbook());
  await page.locator('#rail .tab-summary').click();
  await expect(details.locator('.summary-map-link')).toHaveCount(0);
  await expect(headerMap).toBeVisible();
  await expect(headerMap).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('#workspace-map')).toBeVisible();
  await expect(page.locator('#workspace-map')).toHaveAttribute('aria-disabled','true');
  await expect(page.locator('#workspace-map')).not.toHaveAttribute('href',/.+/);
  await expect(headerMap).not.toHaveAttribute('href',/.+/);
  await expect(page.locator('#summaryMapHint')).toHaveCount(0);
  await expect(context).not.toContainText('12 Office Road');
  await expect(details.locator('.customer')).toContainText('Freedom Customer');
});

test('collapse and expand all detail applies across every page of the current takeoff',async({page})=>{
  const data=workbook(),takeoff=data.lists[0].companies[0].projects[0].takeoffs[0];
  takeoff.sheets.push(sheet('second','Second scope'),{id:'blank',title:'Blank scope',rows:[],fees:[],units:[]});
  takeoff.sheets[0].note='First scope detail';
  takeoff.sheets[1].note='Second scope detail';
  takeoff.sheets[1].rows.unshift({id:'detail-section',type:'section',name:'Section',note:'Section detail'});
  takeoff.sheets[1].rows.push({id:'detail-end',type:'sectionEnd',sid:'detail-section'});
  await openWorkbook(page,data);
  const shared=await page.evaluate(()=>window.estimator.getShared().lists);
  const visit=async(sheetId)=>{
    await page.locator(`#rail .tab[data-sheet="${sheetId}"]`).click();
  };
  await page.locator('#workspace-toggle-notes').click();
  for(const id of ['sn','second']){
    await visit(id);
    await expect(page.locator('#sheetCard .item-note:visible')).toHaveCount(0);
    await expect(page.locator('#workspace-toggle-notes')).toHaveText('Expand all detail');
  }
  // A page with no detail can still expand the other pages.
  await visit('blank');
  await expect(page.locator('#workspace-toggle-notes')).toBeVisible();
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#toggleNotes')).toHaveText('Expand all detail');
  await page.locator('#toggleNotes').click();
  await page.locator('#workspace-view > summary').press('Escape');
  for(const [id,count] of [['sn',2],['second',3]]){
    await visit(id);
    await expect(page.locator('#sheetCard .item-note:visible')).toHaveCount(count);
    await expect(page.locator('#workspace-toggle-notes')).toHaveText('Collapse all detail');
  }
  await page.locator('#workspace-toggle-notes').click();
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'sheet'}));
  await expect(page.locator('#body .item-note').first()).toBeVisible();
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'second',view:'sheet'}));
  await expect(page.locator('#sheetCard .item-note:visible')).toHaveCount(0);
  expect(await page.evaluate(()=>window.estimator.getShared().lists)).toEqual(shared);
});

test('menus preserve rounding, display, downloads, printing and keyboard access', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openWorkbook(page);
  const detailButton=await page.locator('#titleNote').boundingBox();
  expect(detailButton.height).toBeGreaterThanOrEqual(32);expect(detailButton.width).toBeGreaterThanOrEqual(80);
  await page.locator('#titleNote').click();
  await page.locator('#sheetCard > .head .item-note').fill('Scope detail');
  await page.locator('#workspace-toggle-notes').click();
  await expect(page.locator('#sheetCard > .head .item-note')).not.toBeVisible();
  await expect(page.locator('#body .item-note').first()).not.toBeVisible();
  await expect(page.locator('#workspace-toggle-notes')).toHaveText('Expand all detail');
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#toggleNotes')).toHaveText('Expand all detail');
  await page.locator('#toggleNotes').click();
  await expect(page.locator('#sheetCard > .head .item-note')).toBeVisible();
  await expect(page.locator('#workspace-toggle-notes')).toHaveText('Collapse all detail');
  await page.locator('#workspace-view > summary').press('Escape');
  await expect(page.locator('#sheetCard > .bar')).toHaveCount(0);
  await expect(page.locator('#sheetTable th.c-item #add')).toBeVisible();
  await expect(page.locator('#roundTotal')).not.toBeVisible();
  await page.locator('#workspace-estimate > summary').click(); await page.locator('#roundTotal').selectOption('100');
  await expect(page.locator('#tGrandLipMoney .v')).toHaveText('100.00');
  await page.locator('#workspace-estimate > summary').press('Escape');
  await expect(page.locator('#workspace-estimate > summary')).toBeFocused();
  await page.locator('#workspace-view > summary').click();await page.locator('#lightMode').click();
  await expect(page.locator('body')).not.toHaveClass(/medieval/);
  await page.locator('#zoomPick').selectOption('1.15');
  await expect(page.locator('body')).toHaveCSS('zoom','1.15');
  await expect.poll(async()=>page.evaluate(()=>Math.abs(document.getElementById('tGrandLip').getBoundingClientRect().top - document.getElementById('tdGrandTotal').getBoundingClientRect().bottom))).toBeLessThan(5);
  await page.locator('#toggleNotes').click();
  await page.locator('#zoomPick').selectOption('1');
  await page.screenshot({path:'test-results/workspace-view-menu.png',fullPage:true});
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#workspace-file > summary').click();
  const downloaded=page.waitForEvent('download'); await page.locator('#workspace-excel button').click();
  expect((await downloaded).suggestedFilename()).toMatch(/\.xlsx$/);
  await page.evaluate(()=>{window.print=()=>{window.printCapture={text:document.getElementById('printAll').textContent,view:document.body.dataset.workspaceView};};});
  await page.locator('#workspace-file > summary').click();await page.locator('#workspace-print').click();
  expect(await page.evaluate(()=>window.printCapture.text)).toContain('North scope');
  await page.locator('#rail .tab-summary').click();
  await expect(page.locator('#workspace-estimate')).not.toBeVisible();
  await page.locator('#workspace-view > summary').click();await expect(page.locator('#sumDetail')).toBeVisible();
  await expect(page.locator('#showPics')).not.toBeVisible();await page.locator('#sumDetail').click();
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#rail .tab-calc').filter({hasText:'Load calc'}).click();
  await page.locator('#workspace-view > summary').click();await expect(page.locator('#loadFoldAll')).toBeVisible();
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#workspace-file > summary').click();await page.locator('#workspace-print').click();
  expect(await page.evaluate(()=>window.printCapture.view)).toBe('load');
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.screenshot({path:'test-results/organized-workspace.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('workspace menus fit a small screen and appearance survives reopening',async({page})=>{
  await page.setViewportSize({width:600,height:850});await openWorkbook(page);
  await page.locator('#workspace-view > summary').click();await page.locator('#darkMode').click();
  const rect=await page.locator('#workspace-view .workspace-menu-content').boundingBox();
  expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(600);
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#server-projects').click();await page.locator('#server-tab-workbooks').click();await page.locator('#server-open').click();
  await expect(page.locator('#server-list')).toBeVisible();await page.locator('#server-back').click();
  await expect(page.locator('#server-hierarchy')).toBeVisible();
  const name=await page.locator('#server-title').textContent();
  await page.locator('#server-tab-workbooks').click();
  await page.locator('#server-workbook-actions > summary').click();await page.locator('#server-close').click();
  await page.locator('#server-list .server-project').filter({hasText:name}).click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await expect(page.locator('body')).toHaveClass(/dark/);await expect(page.locator('body')).not.toHaveClass(/medieval/);
  await page.screenshot({path:'test-results/workspace-small-screen.png',fullPage:true});
});

test('nested sections retain totals, collapse state, duplication and library drops', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const data=workbook();
  const rows=[
    {id:'parent',type:'section',name:'Parent'},
    {id:'outer-item',kind:'labor',name:'Outer work',count:1,time:1,days:1,cost:100},
    {id:'child',type:'section',name:'Child'},
    {id:'grandchild',type:'section',name:'Grandchild'},
    {id:'inner-item',kind:'labor',name:'Inner work',count:1,time:1,days:1,cost:50},
    {id:'grandchild-end',type:'sectionEnd',sid:'grandchild'},
    {id:'child-end',type:'sectionEnd',sid:'child'},
    {id:'parent-end',type:'sectionEnd',sid:'parent'}
  ];
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=rows;
  await openWorkbook(page,data);
  const row=id=>page.locator('#sheetTable tr[data-id="'+id+'"]');
  await expect(row('child')).toHaveAttribute('data-depth','1');
  await expect(row('grandchild')).toHaveAttribute('data-depth','2');
  await expect(row('parent-end').locator('.sub .v')).toHaveText('150.00');
  await expect(row('child-end').locator('.sub .v')).toHaveText('50.00');
  await expect(page.locator('#tSub .v')).toHaveText('150.00');
  await row('child').locator('.caret').click();
  await row('parent').locator('.caret').click();
  await expect(row('child')).not.toBeVisible();
  await row('parent').locator('.caret').click();
  await expect(row('child')).toBeVisible();
  await expect(row('grandchild')).not.toBeVisible();
  await row('child').locator('.caret').click();
  await row('parent').getByRole('button',{name:'+ Subsection',exact:true}).click();
  await expect(page.locator('#sheetTable tr.section-head')).toHaveCount(4);
  const newSection=page.locator('#sheetTable tr.section-head').last();
  await expect(newSection).toHaveAttribute('data-depth','1');
  await newSection.locator('.name-in').fill('New child');
  await row('parent').getByRole('button',{name:'Duplicate this section and everything in it',exact:true}).click();
  await expect(page.locator('#sheetTable tr.section-head')).toHaveCount(8);
  await expect(page.locator('#tSub .v')).toHaveText('300.00');
  const snapshot=await page.evaluate(()=>window.estimator.exportBook());
  const sh=snapshot.sheets.find(s=>s.rows.some(r=>r.id==='parent'));
  const stack=[];
  for(const r of sh.rows){if(r.type==='section')stack.push(r.id);if(r.type==='sectionEnd')expect(r.sid).toBe(stack.pop());}
  expect(stack).toEqual([]);
  await page.locator('#libToggle').click();
  await page.locator('.lib-save-existing > summary').click();
  await page.locator('#libCaptureType').selectOption('section');
  await page.locator('#libCapture .tpl').filter({hasText:'Parent'}).first().locator('button').click();
  const template=page.locator('#libAll .tpl').filter({hasText:'Parent'}).first();
  await expect(template).toBeVisible();
  const source=await template.boundingBox();
  const target=await row('child').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(target.x+target.width/2,target.y+target.height*0.8,{steps:15});
  // A full-height preview moves following rows; aim at the header's displayed position.
  const displayedTarget=await row('child').boundingBox();
  await page.mouse.move(displayedTarget.x+displayedTarget.width/2,displayedTarget.y+displayedTarget.height*0.8);
  await page.mouse.up();
  await expect(page.locator('#sheetTable tr.section-head')).toHaveCount(12);
  await expect(page.locator('#tSub .v')).toHaveText('450.00');
  await expect(row('child-end').locator('.sub .v')).toHaveText('200.00');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#sheetTable tr.section-head')).toHaveCount(12);
  await expect(page.locator('#tSub .v')).toHaveText('450.00');
  expect(errors).toEqual([]);
});

test('items and nested sections move between option tabs and Escape cancels', async ({page}) => {
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  const data=workbook();
  const sheets=data.lists[0].companies[0].projects[0].takeoffs[0].sheets;
  sheets[0].units=[{id:'source-unit',label:'SF',qty:100}];
  sheets[0].rows=[
    {id:'loose',kind:'labor',name:'Loose item',count:1,time:1,days:1,cost:25,note:'Keep me'},
    {id:'parent',type:'section',name:'Parent',collapsed:true,units:{'source-unit':{qty:20}}},
    {id:'child',type:'section',name:'Child'},
    {id:'nested',kind:'labor',name:'Nested item',count:1,time:1,days:1,cost:50},
    {id:'child-end',type:'sectionEnd',sid:'child'},
    {id:'parent-end',type:'sectionEnd',sid:'parent'}
  ];
  sheets.push(sheet('destination','Destination'));
  await openWorkbook(page,data);
  const beginMove = async (rowId,tabId) => {
    const grip=page.locator('#body tr[data-id="'+rowId+'"] .grip').first();
    await grip.scrollIntoViewIfNeeded();
    const source=await grip.boundingBox();
    const tab=page.locator('#rail [data-sheet="'+tabId+'"]');
    const target=await tab.boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
    await page.mouse.down();
    await page.mouse.move(target.x+target.width/2,target.y+target.height/2,{steps:15});
    await expect(tab).toHaveClass(/row-drop-target/);
  };
  await beginMove('loose','destination');
  await page.mouse.up();
  await expect(page.locator('#title')).toHaveValue('Destination');
  await expect(page.locator('#body tr[data-id="loose"]')).toBeVisible();
  await page.locator('#rail [data-sheet="sn"]').click();
  await expect(page.locator('#body tr[data-id="loose"]')).toHaveCount(0);
  await beginMove('parent','destination');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#title')).toHaveValue('North scope');
  await expect(page.locator('#body tr[data-id="parent"]')).toBeVisible();
  await expect(page.locator('#rail .row-drop-target')).toHaveCount(0);
  await beginMove('parent','destination');
  await page.mouse.up();
  await expect(page.locator('#title')).toHaveValue('Destination');
  const moved=await page.evaluate(()=>window.estimator.exportBook().sheets);
  expect(moved[0].rows).toEqual([]);
  expect(moved[1].rows.map(r=>r.id)).toEqual(['row-destination','loose','parent','child','nested','child-end','parent-end']);
  expect(moved[1].rows.find(r=>r.id==='child-end').sid).toBe('child');
  expect(moved[1].rows.find(r=>r.id==='parent-end').sid).toBe('parent');
  expect(moved[1].rows.find(r=>r.id==='parent').units[moved[1].units[0].id]).toEqual({qty:20});
  expect(moved[1].rows.find(r=>r.id==='loose').note).toBe('Keep me');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#title')).toHaveValue('North scope');
  const undone=await page.evaluate(()=>window.estimator.exportBook().sheets);
  expect(undone[0].rows.map(r=>r.id)).toEqual(['parent','child','nested','child-end','parent-end']);
  expect(undone[1].rows.map(r=>r.id)).toEqual(['row-destination','loose']);
  await page.keyboard.press('Control+y');
  await expect(page.locator('#title')).toHaveValue('Destination');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#title')).toHaveValue('Destination');
  const saved=await page.evaluate(()=>window.estimator.exportBook().sheets);
  expect(saved[0].rows).toEqual([]);
  expect(saved[1].rows.map(r=>r.id)).toEqual(moved[1].rows.map(r=>r.id));
  expect(errors).toEqual([]);
});

test('editing names and prices after moving a nested section preserves its saved order', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  const data=workbook();
  const item=(id,name,cost)=>({id,kind:'labor',name,cost,count:1,time:1,days:1,markup:0});
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=[
    item('loose1','Loose 1',10),item('loose2','Loose 2',20),
    {id:'parent',type:'section',name:'Parent'},
    {id:'child',type:'section',name:'Subsection'},
    item('work','Nested work',30),
    {id:'child-end',type:'sectionEnd',sid:'child'},
    {id:'parent-end',type:'sectionEnd',sid:'parent'}
  ];
  await openWorkbook(page,data);
  const row=id=>page.locator('#body tr[data-id="'+id+'"]');
  await row('parent').locator('.grip').press('Alt+ArrowUp');
  await row('parent').locator('.grip').press('Alt+ArrowUp');
  const expected=['parent','child','work','child-end','parent-end','loose1','loose2'];
  const order=()=>page.locator('#body > tr').evaluateAll(rows=>rows.map(row=>row.dataset.id));
  expect(await order()).toEqual(expected);
  await row('work').getByRole('textbox',{name:'Item name',exact:true}).fill('Updated nested item');
  await row('work').getByRole('textbox',{name:'cost',exact:true}).focus();
  await row('work').getByRole('textbox',{name:'cost',exact:true}).fill('95');
  await row('work').getByRole('textbox',{name:'Item name',exact:true}).fill('Saved nested item');
  expect(await order()).toEqual(expected);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  expect(await order()).toEqual(expected);
  await expect(row('work')).toHaveAttribute('data-depth','2');
  await expect(row('work').getByRole('textbox',{name:'Item name',exact:true})).toHaveValue('Saved nested item');
  await expect(row('work').getByRole('textbox',{name:'cost',exact:true})).toHaveValue('95.00');
  await expect(page.locator('#tSub .v')).toHaveText('125.00');
  await row('work').getByRole('textbox',{name:'Item name',exact:true}).fill('Another edit');
  await page.keyboard.press('Control+z');
  expect(await order()).toEqual(expected);
  await expect(row('work').getByRole('textbox',{name:'Item name',exact:true})).toHaveValue('Saved nested item');
  expect(errors).toEqual([]);
});

test('moving a section nests its whole subtree and removing the parent keeps children', async ({page}) => {
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=[
    {id:'a',type:'section',name:'Destination',collapsed:true},
    {id:'ae',type:'sectionEnd',sid:'a'},
    {id:'b',type:'section',name:'Moving parent'},
    {id:'c',type:'section',name:'Moving child'},
    {id:'work',kind:'labor',name:'Work',count:1,time:1,days:1,cost:25},
    {id:'ce',type:'sectionEnd',sid:'c'},
    {id:'be',type:'sectionEnd',sid:'b'}
  ];
  await openWorkbook(page,data);
  const row=id=>page.locator('#sheetTable tr[data-id="'+id+'"]');
  const source=await row('b').locator('.grip').boundingBox();
  const dest=await row('a').boundingBox();
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(dest.x+80,dest.y+dest.height*0.8,{steps:10});
  await expect(page.locator('#sheetTable .drop-preview.section-head').first()).toHaveAttribute('data-depth','1');
  const unchanged=await page.evaluate(()=>window.estimator.exportBook().sheets[0].rows.map(r=>r.id));
  expect(unchanged).toEqual(['a','ae','b','c','work','ce','be']);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('#sheetTable .drop-preview')).toHaveCount(0);
  await expect(row('b')).toHaveAttribute('data-depth','0');
  await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
  await page.mouse.down();
  await page.mouse.move(dest.x+80,dest.y+dest.height*0.8);
  await page.mouse.up();
  await expect(row('b')).toHaveAttribute('data-depth','1');
  await expect(row('c')).toHaveAttribute('data-depth','2');
  await expect(row('work')).toBeVisible();
  await expect(row('ae').locator('.sub .v')).toHaveText('25.00');
  await row('a').locator('.del').click();
  await page.getByRole('dialog',{name:'Delete section',exact:true}).getByRole('button',{name:'Keep items',exact:true}).click();
  await expect(row('a')).toHaveCount(0);
  await expect(row('ae')).toHaveCount(0);
  await expect(row('b')).toBeVisible();
  await expect(row('b')).toHaveAttribute('data-depth','0');
  await expect(row('c')).toHaveAttribute('data-depth','1');
  await expect(row('work')).toBeVisible();
  await expect(page.locator('#tSub .v')).toHaveText('25.00');
  await page.screenshot({path:'test-results/nested-sections.png',fullPage:true});
});

test('section drop ghost matches committed rows after subtotals and cancels without changes', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=[
    {id:'outer',type:'section',name:'Outer'},
    {id:'inner',type:'section',name:'Inner'},
    {id:'line',kind:'labor',name:'Work',count:1,time:1,days:1,cost:50},
    {id:'inner-end',type:'sectionEnd',sid:'inner'},
    {id:'outer-end',type:'sectionEnd',sid:'outer'}
  ];
  await openWorkbook(page,data);
  await page.locator('#libToggle').click();
  await page.locator('.lib-save-existing > summary').click();
  await page.locator('#libCaptureType').selectOption('section');
  await page.locator('#libCapture .tpl').filter({hasText:'Inner'}).locator('button').click();
  const template=page.locator('#libAll .tpl').filter({hasText:'Inner'}).first();
  const original=await page.evaluate(()=>JSON.stringify(window.estimator.exportBook().sheets));
  const begin=async(id)=>{
    const source=await template.boundingBox();
    const target=await page.locator('#sheetTable tr[data-id="'+id+'"]').boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);
    await page.mouse.down();
    await page.mouse.move(target.x+target.width/2,target.y+target.height*0.8);
    await expect(page.locator('#sheetTable .drop-preview')).toHaveCount(3);
  };
  const geometry=el=>({id:el.dataset.id,depth:el.dataset.depth,top:el.getBoundingClientRect().top,height:el.getBoundingClientRect().height,
    cells:[...el.cells].map(c=>({width:c.getBoundingClientRect().width,text:c.textContent,values:[...c.querySelectorAll('input')].map(i=>i.value)}))});
  await begin('inner-end');
  await expect(page.locator('#sheetTable .drop-preview.section-head')).toHaveAttribute('data-depth','1');
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.exportBook().sheets))).toBe(original);
  await page.keyboard.press('Escape');await page.mouse.up();
  await expect(page.locator('#sheetTable .drop-preview')).toHaveCount(0);
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.exportBook().sheets))).toBe(original);
  await expect(page.locator('#tSub .v')).toHaveText('50.00');

  await begin('outer-end');
  const preview=page.locator('#sheetTable .drop-preview');
  await expect(preview.first()).toHaveAttribute('data-depth','0');
  const before=await Promise.all((await preview.all()).map(row=>row.evaluate(geometry)));
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.exportBook().sheets))).toBe(original);
  await page.screenshot({path:'test-results/section-drop-ghost.png',fullPage:true});
  await page.mouse.up();
  await expect(page.locator('#sheetTable .drop-preview')).toHaveCount(0);
  for(const expected of before){
    const actual=await page.locator('#sheetTable tr[data-id="'+expected.id+'"]').evaluate(geometry);
    expect(actual.depth).toBe(expected.depth);
    expect(actual.height).toBeCloseTo(expected.height,0);
    expect(actual.top).toBeCloseTo(expected.top,0);
    expect(actual.cells).toEqual(expected.cells);
  }
  await expect(page.locator('#tSub .v')).toHaveText('100.00');
  expect(errors).toEqual([]);
});


test('row Tab navigation skips actions and selects cost for replacement',async({page})=>{
  const data=workbook(), sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.rows.push({...sh.rows[0],id:'second',name:'Second row'});
  await openWorkbook(page,data);
  const row=page.locator('#body tr[data-id="row-sn"]');
  await row.locator('.name-in').focus();
  for(const field of ['count','time','days','cost']){await page.keyboard.press('Tab');await expect(row.locator('input[aria-label="'+field+'"]')).toBeFocused();}
  expect(await row.locator('[aria-label="cost"]').evaluate(el=>el.value.slice(el.selectionStart,el.selectionEnd))).toBe('125');
  await page.keyboard.type('250');
  await page.keyboard.press('Tab');await expect(row.locator('[aria-label="Markup percent"]')).toBeFocused();
  await page.keyboard.press('Tab');await expect(page.locator('#body tr[data-id="second"] .name-in')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(row.locator('[aria-label="Markup percent"]')).toBeFocused();
  await page.keyboard.press('Shift+Tab');await expect(row.locator('[aria-label="cost"]')).toBeFocused();
  expect(await row.locator('[aria-label="cost"]').inputValue()).toBe('250');
});

test('optional flat add applies once after markup and persists with its toggle',async({page})=>{
  const data=workbook(), sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  Object.assign(sh.rows[0],{count:2,time:3,days:2,cost:100,markup:10});
  await openWorkbook(page,data);
  const column=page.locator('th[data-w="flatAdd"]');
  await expect(column).toBeHidden();await expect(page.locator('#tSub .v')).toHaveText('1,320.00');
  const toggle=async enabled=>{await page.locator('#workspace-estimate > summary').click();await page.locator('#workspace-flat-add').setChecked(enabled);await page.locator('#workspace-estimate > summary').press('Escape');};
  await toggle(true);await expect(column).toBeVisible();
  await page.locator('#body [aria-label="flatAdd"]').fill('400');
  await expect(page.locator('#tSub .v')).toHaveText('1,720.00');
  await expect(page.locator('#tMk .v')).toHaveText('120.00');
  await expect(page.locator('#tGrand .v')).toHaveText('1,771.60');
  await page.locator('#rail .tab-summary').click();await expect(page.locator('#sumTable')).toContainText('1,720.00');
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.evaluate(()=>{window.print=()=>{window.printCapture={text:document.getElementById('printAll').textContent};};});
  await page.locator('#workspace-file > summary').click();await page.locator('#workspace-print').click();
  expect(await page.evaluate(()=>window.printCapture.text)).toContain('Flat add $');
  expect(await page.evaluate(()=>window.printCapture.text)).toContain('400.00');
  await page.locator('#workspace-file > summary').click();
  const downloaded=page.waitForEvent('download');await page.locator('#workspace-excel button').click();
  const stream=await (await downloaded).createReadStream(), chunks=[];
  for await(const chunk of stream)chunks.push(chunk);
  const xlsx=Buffer.concat(chunks).toString('utf8');
  expect(xlsx).toContain('Flat add $');expect(xlsx).toContain('B2*C2*D2*E2*(1+F2/100)+G2');
  expect(xlsx).toContain('<c r="G2" s="4"><v>400</v>');

  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await expect(column).toBeVisible();await expect(page.locator('#body [aria-label="flatAdd"]')).toHaveValue('400.00');
  await toggle(false);await expect(column).toBeHidden();await expect(page.locator('#tSub .v')).toHaveText('1,320.00');
  await toggle(true);await expect(page.locator('#body [aria-label="flatAdd"]')).toHaveValue('400.00');
});

test('summary sections collapse descendants independently and preserve totals and nesting', async ({page}) => {
  const data=workbook(),sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  const section=(id,name)=>({id,type:'section',name,note:name+' notes'});
  const end=id=>({id:id+'-end',type:'sectionEnd',sid:id});
  sh.rows=[section('parent','Site work'),section('child','Concrete'),section('grandchild','Sidewalk'),...sh.rows,end('grandchild'),end('child'),section('sibling','Demolition'),end('sibling'),end('parent'),section('other','Other work'),end('other')];
  await openWorkbook(page,data);
  const originalRows=await page.evaluate(()=>window.estimator.getShared().lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows);
  await page.locator('#rail .tab-summary').click();
  const row=id=>page.locator('#sumTable [data-section="'+id+'"]');
  const toggle=id=>row(id).locator('.sum-section-caret');
  const pageToggle=page.locator('#sumTable .sum-caret');
  await pageToggle.click();
  await expect(page.locator('#sumTable .s-subn')).toHaveText(['1.1','1.1.1','1.1.1.1','1.1.2','1.2']);
  await expect(row('grandchild').locator('.s-tree-guide')).toHaveCount(2);
  await expect(row('other').locator('.sum-section-caret')).toHaveCount(0);
  const totals=await page.locator('#sumTable tfoot').innerText();
  const parentTotal=await row('parent').locator('.s-grand').innerText();
  await page.screenshot({path:'test-results/summary-section-tree.png',fullPage:true});
  await toggle('child').focus();await page.keyboard.press('Enter');
  await expect(toggle('child')).toHaveAttribute('aria-expanded','false');
  await expect(toggle('child')).toBeFocused();
  await expect(row('grandchild')).toHaveCount(0);await expect(row('sibling')).toBeVisible();
  await toggle('parent').click();
  await expect(row('child')).toHaveCount(0);await expect(row('sibling')).toHaveCount(0);await expect(row('other')).toBeVisible();
  expect(await row('parent').locator('.s-grand').innerText()).toBe(parentTotal);
  expect(await page.locator('#sumTable tfoot').innerText()).toBe(totals);
  await pageToggle.click();await pageToggle.click();
  await expect(toggle('parent')).toHaveAttribute('aria-expanded','false');
  await toggle('parent').click();
  await expect(toggle('child')).toHaveAttribute('aria-expanded','false');await expect(row('grandchild')).toHaveCount(0);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.locator('#rail .tab-summary').click();
  await expect(toggle('child')).toHaveAttribute('aria-expanded','false');
  await expect(row('sibling').locator('.s-subn')).toHaveText('1.1.2');
  await page.evaluate(()=>{window.print=()=>{window.printCapture=document.getElementById('printAll').innerHTML;};window.estimator.print(false);});
  const printed=await page.evaluate(()=>window.printCapture);
  expect(printed).toContain('Concrete');expect(printed).not.toContain('Sidewalk');
  await toggle('child').click();await expect(row('grandchild')).toBeVisible();
  await toggle('parent').click();
  await page.locator('#workspace-view > summary').click();await page.locator('#sumSections').click();
  await page.locator('#sumSections').click();
  await expect(row('grandchild')).toHaveCount(0);
  await page.locator('#sumSubsections').click();await page.locator('#sumSubsections').click();
  await page.locator('#workspace-view > summary').press('Escape');
  await expect(row('grandchild')).toBeVisible();
  const saved=await page.evaluate(()=>window.estimator.getShared());
  expect(saved.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows).toEqual(originalRows);
});

test('summary and printing include rounding and summary details', async ({page}) => {
  const data=workbook(), tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  data.summaryNotes='Summary note';
  const sh=tk.sheets[0]; sh.roundTotal=100; sh.roundStep=10;
  sh.note='Option detail'; sh.title='North scope\nSecond scope line';
  sh.rows.unshift({id:'sec',type:'section',name:'Site preparation'});
  sh.rows.push({id:'end',type:'sectionEnd'});
  tk.sheets.push({...sheet('other','Other option'),hiddenCols:['round']});
  await openWorkbook(page,data);
  await expect(page.locator('#thRound')).toBeHidden();
  await expect(page.locator('#tSub .v')).toHaveText('125.00');
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#hiddenCols').getByRole('button',{name:'+ Round',exact:true}).click();
  await page.locator('#workspace-estimate > summary').press('Escape');
  await expect(page.locator('#thRound')).toBeVisible();
  await expect(page.locator('#tSub .v')).toHaveText('125.00');
  await page.locator('#rail .tab-summary').click();
  const row=page.locator('#sumTable .s-row').first();
  await expect(row.locator('.s-grand > .money .v')).toHaveText('128.75');
  await expect(row.locator('.rounded-total .v')).toHaveText('100.00');
  await expect(page.locator('#sumTable tfoot .rounded-total .v')).toHaveText('228.75');
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#roundTotal').selectOption('10');
  await page.locator('#workspace-estimate > summary').press('Escape');
  await page.locator('#rail .tab-summary').click();
  await expect(row.locator('.rounded-total .v')).toHaveText('130.00');
  await row.locator('.sum-caret').click();
  await page.locator('#workspace-view > summary').click();
  await page.locator('#sumDetail').click();
  await page.locator('#workspace-view > summary').press('Escape');
  await page.evaluate(()=>{window.print=()=>{window.printCapture=document.getElementById('printAll').innerHTML;};});
  await page.emulateMedia({media:'print'});
  await page.evaluate(()=>window.estimator.print(false));
  const summary=await page.evaluate(()=>window.printCapture);
  for(const text of ['Freedom Customer','North job','North takeoff','Site preparation','Second scope line','Option detail','Summary note','Rounded total','130.00','258.75']) expect(summary).toContain(text);
  await expect(page.locator('#printAll')).toBeVisible();
  await page.emulateMedia({media:'screen'});
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.evaluate(()=>window.estimator.print(true));
  const all=await page.evaluate(()=>window.printCapture);
  expect(all).toContain('<th>Round</th>');
  expect(all).toContain('Rounded total');
  expect(all).toContain('Site preparation');
  await page.locator('#thRound [data-hide="round"]').click();
  await expect(page.locator('#thRound')).toBeHidden();
  await page.evaluate(()=>window.estimator.print(true));
  expect(await page.evaluate(()=>window.printCapture)).not.toContain('<th>Round</th>');
  await page.locator('#rail .tab-summary').click();
  await page.locator('#rail .tab[data-sheet]').first().click();
  await page.locator('#workspace-estimate > summary').click();
  await page.locator('#roundTotal').selectOption('0');
  await page.locator('#workspace-estimate > summary').press('Escape');
  await page.locator('#rail .tab-summary').click();
  await expect(page.locator('#sumTable .rounded-total')).toHaveCount(0);
});

test('new takeoffs and option pages start without sample content', async ({page}) => {
  await openWorkbook(page);
  await page.locator('#server-projects').click();
  await page.locator('[data-company="co"] > .p-head > .p-name').click();
  await page.locator('[data-project="north"] > .p-head button[title="Add a takeoff"]').click();
  await page.locator('#editor').getByLabel('Takeoff name',{exact:true}).fill('Blank takeoff');
  await page.locator('#edSave').click();
  const createdTakeoff=page.locator('.p-head[data-takeoff]').filter({hasText:'Blank takeoff'});
  if(!await createdTakeoff.count()) await page.locator('[data-project="north"] > .p-head > .p-name').click();
  await createdTakeoff.click();
  await expect(page.locator('#summaryCard')).toBeVisible();
  await page.locator('#rail .tab[data-sheet]').first().click();
  await expect(page.locator('#title')).toHaveValue('');
  await expect(page.locator('#body .name-in')).toHaveCount(1);
  await expect(page.locator('#body .name-in')).toHaveValue('');
  await page.locator('#rail .tab-add').click();
  await expect(page.locator('#title')).toHaveValue('');
  const check=async()=>{
    const data=await page.evaluate(()=>window.estimator.getShared());
    const takeoffs=data.lists[0].companies[0].projects[0].takeoffs;
    const created=takeoffs.find(t=>t.name==='Blank takeoff');
    expect(created.sheets).toHaveLength(2);
    for(const sh of created.sheets){
      expect(sh.title).toBe('');expect(sh.units.every(u=>!u.qty)).toBe(true);
      expect(sh.rows).toHaveLength(1);expect(sh.rows[0].name).toBe('');expect(sh.rows[0].cost).toBe('');
    }
    expect(takeoffs.find(t=>t.name==='North takeoff').sheets[0].title).toBe('North scope');
  };
  await check();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await check();
});

test('service costs edit inline and preserve add-ons after reload',async({page})=>{
  const data=workbook();
  const rows=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows;
  rows[0]={id:'service-flat',kind:'service',name:'Delivery',count:1,time:1,days:1,cost:350,markup:0};
  rows.push({id:'service-parts',kind:'service',name:'Mixer package',count:1,time:1,days:1,cost:250,markup:0,parts:[{id:'fuel',kind:'part',name:'Fuel',count:1,time:1,days:1,cost:35}]});
  await openWorkbook(page,data);
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'sheet'}));
  const costs=page.locator('#sheetTable tbody input[aria-label="cost"]');
  await expect(costs.nth(0)).toHaveValue('350.00');
  await expect(costs.nth(1)).toHaveValue('285.00');
  await costs.nth(0).fill('400');await costs.nth(0).press('Tab');
  await costs.nth(1).fill('300');await costs.nth(1).press('Tab');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(costs.nth(0)).toHaveValue('400.00');
  await expect(costs.nth(1)).toHaveValue('300.00');
  const saved=await page.evaluate(()=>window.estimator.getShared().lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows);
  expect(saved[0].cost).toBe(400);
  expect(saved[1].cost).toBe(265);
  expect(saved[1].parts[0].cost).toBe(35);
});

test('summary cost breakdown reconciles categories, fees and pie',async({page})=>{
  const data=workbook();
  const sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.rows[0].cost=100;sh.rows[0].markup=10;sh.rows[0].flatAdd=20;sh.flatAddEnabled=true;
  sh.rows.push({id:'mat',kind:'material',name:'Concrete',count:2,time:1,days:1,cost:50,markup:0});
  await openWorkbook(page,data);
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'summary'}));
  const breakdown=page.locator('#sumCostBreakdown');
  await expect(breakdown).toContainText('Labor');await expect(breakdown).toContainText('Materials');
  await expect(breakdown).toContainText('$236.90');
  await expect(breakdown.locator('.cost-category').filter({hasText:'Fees'})).toContainText('$6.90');
  const markup=breakdown.locator('.cost-category').filter({hasText:'Markup'});
  const flat=breakdown.locator('.cost-category').filter({hasText:'Flat adds'});
  await expect(markup).toContainText('$10.00');
  await expect(flat).toContainText('$20.00');
  expect(await flat.locator('i').evaluate(el=>getComputedStyle(el).backgroundColor)).not.toBe(await markup.locator('i').evaluate(el=>getComputedStyle(el).backgroundColor));
  await expect(breakdown.locator('svg path')).toHaveCount(5);
  await expect(breakdown.locator('svg path').filter({hasText:'Flat adds: $20.00'})).toHaveAttribute('fill','#dc2626');
});

test('refresh displays cached estimate before live sync and preserves early edits',async({page})=>{
  await openWorkbook(page);
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'sheet'}));
  const input=page.locator('#sheetTable tbody input[aria-label="cost"]').first();
  await input.fill('143');await input.press('Tab');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  let release;let released=false;
  await page.routeWebSocket('**/live/**',ws=>{
    const server=ws.connectToServer();const queued=[];
    server.onMessage(message=>{if(released)ws.send(message);else queued.push(message);});
    release=()=>{released=true;for(const message of queued)ws.send(message);};
  });
  await page.reload();
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('143.00');
  await expect(page.locator('#server-status')).not.toHaveText('All changes saved');
  await input.fill('151');await input.press('Tab');
  await expect.poll(()=>typeof release).toBe('function');release();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await expect(input).toHaveValue('151.00');
  await page.reload();await expect(input).toHaveValue('151.00');
});

test('joining a collaborator on another estimate preserves their rows even with delayed updates',async({browser})=>{
 const a=await browser.newContext(),b=await browser.newContext();const alice=await a.newPage(),bob=await b.newPage();
 let hold=false;const pending=[];let forward;
 await alice.routeWebSocket('**/live/**',ws=>{const server=ws.connectToServer();forward=()=>{hold=false;for(const m of pending.splice(0))ws.send(m);};server.onMessage(m=>{if(hold&&JSON.parse(m).type==='update')pending.push(m);else ws.send(m);});});
 try{
  await openWorkbook(alice,workbook(),'Switch observer '+Date.now());
  const name=await alice.locator('#server-title').innerText();
  await bob.goto('/');await bob.locator('#server-login-name').fill('Switch editor '+Date.now());await bob.locator('#server-login-password').fill('1313');await bob.locator('#server-login-form button').click();
  await expect(bob.locator('#server-status')).toHaveText(/^(All changes saved|No project open)$/);
  await bob.locator('#server-open').click();await bob.getByRole('button').filter({has:bob.getByText(name,{exact:true})}).click();
  await expect(bob.locator('#server-status')).toHaveText('All changes saved');
  await alice.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',sheet:'sn',view:'sheet'}));
  await bob.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'sheet'}));
  hold=true;
  await bob.locator('#title').fill('Friend current scope');await bob.locator('#body input[aria-label="cost"]').first().fill('987');await bob.locator('#add').click();
  await expect(bob.locator('#server-status')).toHaveText('All changes saved');
  const before=await bob.evaluate(()=>window.estimator.getShared());
  for(const t of before.lists[0].companies[0].projects[1].takeoffs)for(const s of t.sheets)for(const r of s.rows)r.type ||= 'item';
  await alice.locator('#body input[aria-label="cost"]').first().fill('222');
  await expect(alice.locator('#server-status')).toHaveText('All changes saved');
  const friend=alice.getByRole('button',{name:/Go to Switch editor.*South job/});await expect(friend).toBeEnabled();await friend.click();
  await expect(bob.locator('#title')).toHaveValue('Friend current scope');
  expect((await bob.evaluate(()=>window.estimator.getShared())).lists[0].companies[0].projects[1]).toEqual(before.lists[0].companies[0].projects[1]);
  forward();await expect(alice.locator('#title')).toHaveValue('Friend current scope');await expect(alice.locator('#body input[aria-label="cost"]').first()).toHaveValue('987.00');
  await alice.reload();await expect(alice.locator('#title')).toHaveValue('Friend current scope');
  expect((await alice.evaluate(()=>window.estimator.getShared())).lists[0].companies[0].projects[1]).toEqual(before.lists[0].companies[0].projects[1]);
 }finally{await a.close();await b.close();}
});

test('AI Information remains escapable during a stalled load and ignores a late response',async({page})=>{
  await openWorkbook(page);
  let release,requested=false,first=true;
  const held=new Promise(resolve=>{release=resolve;});
  await page.route('**/api/ai-information',async route=>{
    if(first){first=false;requested=true;await held;await route.fulfill({json:{items:[{id:'stale',parent:'',kind:'entry',title:'Stale response',text:''}],revision:'old'}}).catch(()=>{});}
    else await route.fulfill({json:{items:[],revision:'current'}});
  });
  await page.locator('#ai-information-open').click();
  await expect.poll(()=>requested).toBe(true);
  await expect(page.locator('#ai-information-page')).toHaveAttribute('aria-busy','true');
  await page.getByRole('button',{name:'Back to estimating',exact:true}).click();
  await expect(page.locator('#ai-information-page')).toBeHidden();
  expect(await page.locator('#sheetCard').evaluate(el=>!!el.closest('[inert]'))).toBe(false);
  await page.locator('#ai-information-open').click();
  await expect(page.locator('#ai-info-status')).toHaveText('Library loaded.');
  release();
  await expect(page.locator('#ai-info-tree')).toContainText('No folders yet');
  await page.getByRole('button',{name:'+ Text entry',exact:true}).click();
  await expect(page.locator('#ai-info-title')).toBeEnabled();
  page.once('dialog',dialog=>dialog.accept());
  await page.getByRole('button',{name:'Back to estimating',exact:true}).click();
});

test('AI Information times out stalled requests and enables retry without a new tab',async({page})=>{
  await openWorkbook(page);
  await page.clock.install();
  let requested=false;
  await page.route('**/api/ai-information',()=>{requested=true;});
  await page.locator('#ai-information-open').click();
  await expect.poll(()=>requested).toBe(true);
  await page.clock.fastForward(21000);
  await expect(page.locator('#ai-info-status')).toContainText('request timed out');
  await expect(page.getByRole('button',{name:'Reload library',exact:true})).toBeEnabled();
  await page.unroute('**/api/ai-information');
  await page.getByRole('button',{name:'Reload library',exact:true}).click();
  await expect(page.locator('#ai-info-status')).toHaveText('Library loaded.');
});

test('main library icon folders accept dragged items and allow moving them back out',async({page})=>{
  const data=workbook();data.templates={items:[{id:'crew',name:'Test crew',kind:'labor',cost:25}],sections:[],scopes:[]};
  await openWorkbook(page,data);await page.locator('#libToggle').click();
  await page.locator('#library').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));
  const dock=page.locator('#libMainFolders');
  await expect(dock.getByRole('button')).toHaveCount(5);
  for(const name of ['Labor','Disposal','Blades','Concrete Pour','Equipment'])await expect(dock.getByRole('button',{name:name+' folder',exact:true})).toBeVisible();
  const drag=async(target)=>{
    const source=await page.locator('#libAll .tpl-name').filter({hasText:'Test crew'}).boundingBox(),dest=await target.boundingBox();
    await page.mouse.move(source.x+source.width/2,source.y+source.height/2);await page.mouse.down();
    await page.mouse.move(dest.x+dest.width/2,dest.y+dest.height/2,{steps:16});await page.mouse.up();
  };
  const folder=()=>page.evaluate(()=>window.estimator.exportBook().templates.items.find(t=>t.id==='crew').folder||'');
  for(const name of ['Labor','Disposal','Blades','Concrete Pour','Equipment']){
    await drag(dock.getByRole('button',{name:name+' folder',exact:true}));
    await expect.poll(folder).toBe(name);
    await dock.getByRole('button',{name:name+' folder',exact:true}).click();
    await expect(page.locator('#libAll .tpl-name').filter({hasText:'Test crew'})).toBeVisible();
  }
  await page.screenshot({path:'test-results/library-main-folders.png',fullPage:true});
  await drag(page.locator('#libAll .crumb').filter({hasText:/^Library$/}));
  await expect.poll(folder).toBe('');
  await page.locator('#libAll .crumb').filter({hasText:/^Library$/}).click();
  await expect(page.locator('#libAll .tpl-name').filter({hasText:'Test crew'})).toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();await page.locator('#libToggle').click();
  await expect(page.locator('#libMainFolders button')).toHaveCount(5);
  await expect.poll(folder).toBe('');
});

test('save from this page searches items and subsections and saves into the selected folder',async({page})=>{
  const data=workbook();data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0].rows=[
    {id:'outer',type:'section',name:'Concrete'},
    {id:'inner',type:'section',name:'Ramp'},
    {id:'crew',kind:'labor',name:'Ramp crew',note:'Night work',cost:25,count:2,time:3,days:1,flatAdd:40},
    {id:'end-inner',type:'sectionEnd',sid:'inner'},
    {id:'end-outer',type:'sectionEnd',sid:'outer'}
  ];
  await openWorkbook(page,data);await page.locator('#libToggle').click();
  await page.getByRole('button',{name:'Labor folder',exact:true}).click();
  await page.getByText('Save from this page',{exact:true}).click();
  await expect(page.locator('#libCapture')).toBeEmpty();
  await page.locator('#libCaptureType').selectOption('section');
  await page.locator('#libCaptureSearch').fill('Ramp');
  await expect(page.locator('#libCapture .tpl')).toHaveCount(1);
  await expect(page.locator('#libCapture')).toContainText('Subsection - Concrete');
  await page.getByRole('button',{name:'Save Ramp to library',exact:true}).click();
  const section=await page.evaluate(()=>window.estimator.exportBook().templates.sections.find(t=>t.name==='Ramp'));
  expect(section.folder).toBe('Labor');expect(section.items[0].name).toBe('Ramp crew');
  await page.locator('#libCaptureType').selectOption('item');
  await page.locator('#libCaptureSearch').fill('Night work');
  await page.getByRole('button',{name:'Save Ramp crew to library',exact:true}).click();
  const item=await page.evaluate(()=>window.estimator.exportBook().templates.items.find(t=>t.name==='Ramp crew'));
  expect(item.folder).toBe('Labor');expect(item.flatAdd).toBe(40);expect(item.count).toBe(2);
  await page.locator('#libCaptureSearch').fill('no such item');await expect(page.locator('#libCapture')).toHaveText('No matches on this page.');
  await page.locator('#libCaptureType').selectOption('page');await page.getByRole('button',{name:'Save entire page',exact:true}).click();
  expect(await page.evaluate(()=>window.estimator.exportBook().templates.scopes.at(-1).folder)).toBe('Labor');
  await expect(page.locator('#body .card-btn')).toHaveCount(0);
});


test('Scope assigns measured items to colored pages and replaces the old Scopes tab',async({page})=>{
  const data=workbook(),takeoff=data.lists[0].companies[0].projects[0].takeoffs[0];
  takeoff.scopeData={source:'zz',items:[{id:'measured',name:'Measured cutting',status:'included',measurements:'100 LF'}]};
  takeoff.sheets.push({...sheet('extra','Pourback'),color:'plum'});
  await openWorkbook(page,data);
  await expect(page.locator('#rail .tab-opts-btn,#scopesCard')).toHaveCount(0);
  await page.locator('#rail .tab-scope').click();
  const choice=page.getByRole('combobox',{name:'Estimate page for Measured cutting'});
  await choice.selectOption('extra');
  const row=page.locator('[data-scope-item="measured"]');
  await expect(row).toHaveClass(/scope-coloured/);
  expect(await row.evaluate(el=>el.style.getPropertyValue('--scope-item-colour'))).toBe('#7A4A70');
  await page.getByRole('button',{name:'Change colour for Pourback',exact:true}).click();
  await page.locator('#tabPalette').getByRole('button',{name:'teal',exact:true}).click();
  expect(await row.evaluate(el=>el.style.getPropertyValue('--scope-item-colour'))).toBe('#2E7D74');
  expect(await page.locator('#rail [data-sheet="extra"]').evaluate(el=>el.style.color)).toBe('rgb(46, 125, 116)');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(choice).toHaveValue('extra');
  expect(await row.evaluate(el=>el.style.getPropertyValue('--scope-item-colour'))).toBe('#2E7D74');
  await page.getByRole('button',{name:'Change colour for Pourback',exact:true}).click();
  await page.locator('#tabPalette').getByRole('button',{name:'No colour',exact:true}).click();
  await expect(row).not.toHaveClass(/scope-coloured/);
  await choice.selectOption('');
  await expect(choice).toHaveValue('');
  // API saves update assignments and colors in the open browser.
  const projects=await (await page.request.get('/api/projects')).json();
  const projectList=Array.isArray(projects)?projects:projects.projects;
  const currentName=await page.locator('#server-title').textContent();
  const current=projectList.find(project=>project.name===currentName);
  const access=await (await page.request.post('/api/projects/'+current.id+'/ai-access',{data:{list:'list',takeoff:'tn'}})).json();
  const headers={Authorization:'Bearer '+access.key};
  const read=await (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  read.takeoff.sheets.find(sheet=>sheet.id==='extra').color='amber';
  read.takeoff.scopeAssignments={measured:'extra'};
  const saved=await page.request.post('/api/ai/v1/save',{headers,data:{revision:read.revision,takeoff:read.takeoff,requestId:'scope-browser'}});
  expect(saved.ok()).toBe(true);
  await expect(choice).toHaveValue('extra');
  await expect.poll(()=>row.evaluate(el=>el.style.getPropertyValue('--scope-item-colour'))).toBe('#D98B00');
  await page.screenshot({path:'.tools/scope-colours.png',fullPage:true});
  await page.locator('#rail .option-close').nth(1).click();
  await page.locator('.confirm-pop').getByRole('button',{name:'Delete',exact:true}).click();
  await expect(choice).toHaveValue('');
  await expect(row).not.toHaveClass(/scope-coloured/);
  // Old saved navigation safely opens the new Scope page.
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'tn',view:'scopes'}));
  await expect(page.locator('#scopeCard')).toBeVisible();
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts'}));
  await expect(page.locator('#summaryCard')).toBeVisible();
});


test('AI saves section and subsection UP quantities and labels with live calculated rates',async({page})=>{
  const data=workbook(),sh=data.lists[0].companies[0].projects[0].takeoffs[0].sheets[0];
  sh.fees=[];sh.units=[{id:'up',label:'SF',qty:1000}];
  sh.rows=[{id:'parent',type:'section',name:'Cutting'},
    {id:'child',type:'section',name:'Openings'},
    {id:'work',kind:'labor',name:'Crew',cost:300,count:1,time:1,days:1},
    {id:'child-end',type:'sectionEnd',sid:'child'},
    {id:'parent-end',type:'sectionEnd',sid:'parent'}];
  await openWorkbook(page,data);
  await page.locator('#takeoff-ai-access').click();
  await page.locator('#ai-access-generate').click();
  await expect(page.locator('#ai-access-connection')).toHaveValue(/Authorization: Bearer/);
  const connection=await page.locator('#ai-access-connection').inputValue();
  const headers={Authorization:'Bearer '+/Authorization: Bearer ([a-f0-9]+)/.exec(connection)[1]};
  await page.locator('#ai-access-close').click();
  const read=async()=> (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  const save=async(snapshot,requestId)=>{
    const payload={revision:snapshot.revision,takeoff:snapshot.takeoff,requestId};
    expect((await page.request.post('/api/ai/v1/validate',{headers,data:payload})).ok()).toBe(true);
    expect((await page.request.post('/api/ai/v1/save',{headers,data:payload})).ok()).toBe(true);
  };
  const original=await read();
  original.takeoff.sheets[0].rows[0].units={up:{qty:120,label:'LF'}};
  original.takeoff.sheets[0].rows[1].units={up:{qty:3,label:'EA'}};
  await save(original,'set-section-up');
  const section=id=>page.locator('#body tr[data-id="'+id+'"]');
  await expect(section('parent').getByLabel('Section quantity for this unit')).toHaveValue('120');
  await expect(section('parent').getByLabel('Section unit label')).toHaveValue('LF');
  await expect(section('parent').locator('.unit-tag')).toHaveText('/120 LF');
  await expect(section('parent').locator('.sec-unit').locator('..').locator('.v')).toHaveText('2.50');
  await expect(section('child').getByLabel('Section quantity for this unit')).toHaveValue('3');
  await expect(section('child').getByLabel('Section unit label')).toHaveValue('EA');
  await expect(section('child').locator('.sec-unit').locator('..').locator('.v')).toHaveText('100.00');
  const updated=await read();
  updated.takeoff.sheets[0].rows[1].units.up={qty:30,label:'LF'};
  await save(updated,'change-subsection-unit');
  await expect(section('child').getByLabel('Section unit label')).toHaveValue('LF');
  await expect(section('child').locator('.sec-unit').locator('..').locator('.v')).toHaveText('10.00');
  await page.reload();
  await expect(section('child').getByLabel('Section quantity for this unit')).toHaveValue('30');
  const reset=await read();reset.takeoff.sheets[0].rows[1].units.up={qty:'',label:''};
  await save(reset,'inherit-page-up');
  await expect(section('child').getByLabel('Section quantity for this unit')).toHaveValue('1000');
  await expect(section('child').getByLabel('Section unit label')).toHaveValue('SF');
  await expect(section('child').locator('.sec-unit').locator('..').locator('.v')).toHaveText('0.30');
  await expect(section('parent').getByLabel('Section unit label')).toHaveValue('LF');
  await expect(page.locator('#tGrand .v')).toHaveText('300.00');
});


test('summary bulk section and subsection controls stay independent across pages',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  tk.sheets=['a','b'].map(id=>({...sheet(id,id),rows:[
    {id:id+'-parent',type:'section',name:'Parent '+id},
    {id:id+'-child',type:'section',name:'Child '+id},
    {id:id+'-nested',type:'section',name:'Nested '+id},
    ...sheet(id,id).rows,
    {id:id+'-nested-end',type:'sectionEnd',sid:id+'-nested'},
    {id:id+'-child-end',type:'sectionEnd',sid:id+'-child'},
    {id:id+'-parent-end',type:'sectionEnd',sid:id+'-parent'}
  ]}));
  await openWorkbook(page,data);
  await page.locator('#rail .tab-summary').click();
  const rows=page.locator('#sumTable .s-sec'),nested=page.locator('#sumTable .s-nested');
  const sections=page.locator('#sumSections'),subsections=page.locator('#sumSubsections');
  const total=await page.locator('#sumTable tfoot').innerText();
  await page.locator('#workspace-view > summary').click();
  await expect(sections).toHaveText('Expand all sections');
  await sections.click();await expect(rows).toHaveCount(6);
  await subsections.click();await expect(subsections).toHaveText('Expand all subsections');
  await expect(rows).toHaveCount(2);await expect(nested).toHaveCount(0);
  await sections.click();await expect(rows).toHaveCount(0);
  await sections.click();await expect(rows).toHaveCount(2);
  await subsections.click();await expect(rows).toHaveCount(6);
  // The subsection control does not reopen closed pages.
  await sections.click();await subsections.click();await subsections.click();
  await expect(rows).toHaveCount(0);
  await sections.click();await expect(rows).toHaveCount(6);
  expect(await page.locator('#sumTable tfoot').innerText()).toBe(total);
  await page.locator('#workspace-view > summary').press('Escape');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',view:'summary'}));
  await page.locator('#workspace-view > summary').click();
  await expect(subsections).toBeDisabled();
});


test('Summary section links reveal the exact nested section and briefly spotlight it',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  const item=id=>({id,kind:'labor',name:id,cost:10,count:1,time:1,days:1});
  tk.sheets.push({...sheet('target-page','Second page'),rows:[
    ...Array.from({length:35},(_,i)=>item('before-'+i)),
    {id:'parent-target',type:'section',name:'Target parent'},
    {id:'child-target',type:'section',name:'Target child'},item('target-item'),
    {id:'child-end',type:'sectionEnd',sid:'child-target'},
    {id:'parent-end',type:'sectionEnd',sid:'parent-target'},
    ...Array.from({length:15},(_,i)=>item('after-'+i))
  ]});
  await openWorkbook(page,data);
  await page.locator('#rail [data-sheet="target-page"]').click();
  await page.locator('#body [data-id="child-target"] .caret').click();
  await page.locator('#body [data-id="parent-target"] .caret').click();
  await page.locator('#rail .tab-summary').click();
  await page.locator('#sumTable .sum-caret[data-open="target-page"]').click();
  // Fold buttons retain their behavior without navigating.
  const summaryParent=page.locator('#sumTable [data-section="parent-target"]');
  await summaryParent.locator('.sum-section-caret').click();
  await expect(page.locator('#summaryCard')).toBeVisible();
  await summaryParent.locator('.sum-section-caret').click();
  const link=page.locator('#sumTable [data-section="child-target"] .sum-section-link');
  await link.focus();await page.keyboard.press('Enter');
  const target=page.locator('#body [data-id="child-target"]');
  await expect(page.locator('#rail [data-sheet="target-page"]')).toHaveAttribute('aria-selected','true');
  await expect(target).toBeInViewport();await expect(target).toBeFocused();
  await expect(target).toHaveClass(/section-target/);
  await expect(page.locator('#body [data-id="target-item"]')).toBeVisible();
  await expect(page.locator('#body [data-id="parent-target"] .caret')).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('#body [data-id="before-0"]').evaluate(el=>getComputedStyle(el).opacity)).toBe('0.45');
  await page.screenshot({path:'.tools/summary-section-spotlight.png'});
  await expect(target).not.toHaveClass(/section-target/,{timeout:4000});
  await expect(page.locator('#sheetCard')).not.toHaveClass(/section-locate/);
  // Clicking the row's amount also navigates, and switching views clears the effect.
  await page.locator('#rail .tab-summary').click();
  await summaryParent.locator('.s-grand').click();
  await expect(page.locator('#body [data-id="parent-target"]')).toHaveClass(/section-target/);
  await page.locator('#rail .tab-summary').click();
  await expect(page.locator('#sheetCard')).not.toHaveClass(/section-locate/);
});


test('Summary colors are editable and stay shared with Scope, tabs and AI saves',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0],sh=tk.sheets[0];
  sh.color='plum';sh.rows=[{id:'sec',type:'section',name:'Section'},{id:'sub',type:'section',name:'Subsection'},...sh.rows,{id:'sub-end',type:'sectionEnd',sid:'sub'},{id:'sec-end',type:'sectionEnd',sid:'sec'}];
  tk.scopeData={source:'zz',items:[{id:'source',name:'Measured work',status:'included'}]};tk.scopeAssignments={source:'sn'};
  await openWorkbook(page,data);
  await page.locator('#rail .tab-summary').click();
  await page.locator('#sumTable .sum-caret').click();
  const summary=page.locator('#sumTable tr.s-row[data-sheet="sn"]');
  const color=()=>summary.evaluate(el=>el.style.getPropertyValue('--summary-color'));
  expect(await color()).toBe('#7A4A70');
  await summary.getByRole('button',{name:'Change colour for North scope',exact:true}).click();
  await page.locator('#tabPalette').getByRole('button',{name:'teal',exact:true}).click();
  await expect(page.locator('#summaryCard')).toBeVisible();
  await expect(page.locator('#sumTable .summary-coloured')).toHaveCount(3);
  expect(await color()).toBe('#2E7D74');
  await expect(page.locator('#sumTable [data-section="sub"]')).toHaveCSS('--summary-color','#2E7D74');
  await page.locator('#rail .tab-scope').click();
  await expect(page.locator('[data-scope-item="source"]')).toHaveCSS('--scope-item-colour','#2E7D74');
  await page.locator('#rail .tab-summary').click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();expect(await color()).toBe('#2E7D74');
  await page.locator('#takeoff-ai-access').click();await page.locator('#ai-access-generate').click();
  await expect(page.locator('#ai-access-connection')).toHaveValue(/Authorization: Bearer/);
  const connection=await page.locator('#ai-access-connection').inputValue();
  const headers={Authorization:'Bearer '+/Authorization: Bearer ([a-f0-9]+)/.exec(connection)[1]};
  await page.locator('#ai-access-close').click();
  const read=await (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  read.takeoff.sheets[0].color='rust';
  expect((await page.request.post('/api/ai/v1/save',{headers,data:{revision:read.revision,takeoff:read.takeoff,requestId:'summary-color'}})).ok()).toBe(true);
  await expect.poll(color).toBe('#A8552F');
  await summary.getByRole('button',{name:'Change colour for North scope',exact:true}).click();
  await page.locator('#tabPalette').getByRole('button',{name:'No colour',exact:true}).click();
  await expect(page.locator('#sumTable .summary-coloured')).toHaveCount(0);
  await expect(page.locator('#summaryCard')).toBeVisible();
});


test('Summary column headings stick flush to the scroll area without a gap',async({page})=>{
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets=Array.from({length:35},(_,i)=>sheet('page-'+i,'Scope '+i));
  await openWorkbook(page,data);
  await page.locator('#rail .tab-summary').click();
  for(const theme of ['light','dark','medieval']){
    await page.evaluate(theme=>window.estimator.setTheme(theme),theme);
    const scroll=page.locator('#summaryCard>.scroll');
    await scroll.evaluate(el=>{el.scrollTop=500;});
    await expect.poll(()=>page.locator('#sumTable thead th').first().evaluate(th=>{
      const scroll=document.querySelector('#summaryCard>.scroll');
      const bounds=scroll.getBoundingClientRect(),scale=bounds.width/scroll.offsetWidth;
      return Math.abs(th.getBoundingClientRect().top-(bounds.top+scroll.clientTop*scale));
    })).toBeLessThanOrEqual(2);
    await expect(page.locator('#sumTable thead th').first()).toBeInViewport();
  }
  await page.screenshot({path:'.tools/summary-sticky-header.png'});
});

test('Timeline derives 8-hour days, saves adjustments, supports AI and opens source work',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  const labor=(id,name,count,time,days)=>({id,name,kind:'labor',count,time,days,cost:100});
  tk.sheets[0].color='teal';
  tk.sheets[0].rows=[{id:'demo',type:'section',name:'Interior demolition'},labor('crew','Demo crew',2,8,2),{id:'sub',type:'section',name:'Trench preparation'},labor('prep','Prep crew',1,4,1),{id:'sub-end',type:'sectionEnd',sid:'sub'},{id:'demo-end',type:'sectionEnd',sid:'demo'}];
  tk.sheets.push({...sheet('pour','Concrete'),color:'rust',rows:[labor('finish','Concrete finish',3,8,1)]});
  await openWorkbook(page,data);
  const original=await page.evaluate(()=>JSON.stringify(window.estimator.getTimelineTakeoff().sheets));
  await page.locator('#rail .tab-timeline').click();
  await expect(page.locator('#timelineCard')).toBeVisible();
  await expect(page.locator('#timeline-hours')).toHaveValue('8');
  await expect(page.locator('#timeline-stats')).toContainText('60 person-hours');
  await expect(page.locator('#timeline-stats')).toContainText('3.5 workdays');
  await expect(page.locator('.timeline-bar')).toHaveCount(3);
  await expect(page.locator('[data-timeline-task="demo"] .timeline-bar')).toHaveCSS('background-color','rgb(46, 125, 116)');
  const tabs=await page.locator('#rail .tab-calc').allTextContents();
  expect(tabs.map(t=>t.trim())).toEqual(['Timeline','Load calc','Wage calc']);
  const positions=await page.locator('#rail .tab-timeline, #rail .tab-add').evaluateAll(nodes=>nodes.map(n=>({name:n.className,x:n.getBoundingClientRect().x})));
  expect(positions.find(n=>n.name.includes('tab-timeline')).x).toBeGreaterThan(positions.find(n=>n.name.includes('tab-add')).x);
  for(const theme of ['light','dark','medieval']){
    await page.evaluate(theme=>window.estimator.setTheme(theme),theme);
    await page.screenshot({path:'.tools/timeline-'+theme+'.png'});
  }
  await page.evaluate(()=>window.estimator.setTheme('light'));
  await page.locator('#timeline-date').fill('2026-10-09');await page.locator('#timeline-date').blur();
  await expect(page.locator('.timeline-grid-head')).toContainText('2026-10-12');
  await expect(page.locator('#timeline-stats')).toContainText('2026-10-14');
  await page.getByRole('spinbutton',{name:'People for Interior demolition',exact:true}).fill('4');
  await page.getByRole('spinbutton',{name:'People for Interior demolition',exact:true}).blur();
  await expect(page.locator('[data-timeline-task="demo"] .timeline-bar')).toContainText('8h');
  await page.locator('#timeline-mode').selectOption('parallel-pages');
  await expect(page.locator('#timeline-stats')).toContainText('7 people');
  await expect(page.locator('#timeline-stats')).toContainText('1.5 workdays');
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.getTimelineTakeoff().sheets))).toBe(original);
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#timelineCard')).toBeVisible();
  await expect(page.getByRole('spinbutton',{name:'People for Interior demolition',exact:true})).toHaveValue('4');
  await expect(page.locator('#timeline-mode')).toHaveValue('parallel-pages');
  await page.locator('#takeoff-ai-access').click();await page.locator('#ai-access-generate').click();
  await expect(page.locator('#ai-access-connection')).toHaveValue(/Authorization: Bearer/);
  const connection=await page.locator('#ai-access-connection').inputValue();
  const headers={Authorization:'Bearer '+/Authorization: Bearer ([a-f0-9]+)/.exec(connection)[1]};
  await page.locator('#ai-access-close').click();
  const draft=await (await page.request.get('/api/ai/v1/timeline',{headers})).json();
  expect(draft.tasks.map(t=>t.id)).toEqual(['demo','sub','finish']);expect(draft.peakCrew).toBe(7);
  const read=await (await page.request.get('/api/ai/v1/takeoff',{headers})).json();
  read.takeoff.timeline.tasks.push({id:'sub',startHour:16,durationHours:8,crew:2});
  expect((await page.request.post('/api/ai/v1/save',{headers,data:{revision:read.revision,takeoff:read.takeoff,requestId:'timeline-plan'}})).ok()).toBe(true);
  await expect(page.getByRole('spinbutton',{name:'Start day for Trench preparation',exact:true})).toHaveValue('3');
  await expect(page.locator('[data-timeline-task="sub"] .timeline-bar')).toContainText('8h');
  await page.locator('[data-timeline-task="sub"] button').click();
  await expect(page.locator('#sheetCard')).toBeVisible();
  await expect(page.locator('#body tr[data-id="sub"]')).toBeInViewport();
  await page.locator('#rail .tab-timeline').click();
  await page.getByRole('button',{name:'Reset Trench preparation',exact:true}).click();
  await expect(page.locator('[data-timeline-task="sub"] .timeline-bar')).toContainText('4h');
  await page.getByRole('checkbox',{name:'Include Concrete finish',exact:true}).uncheck();
  await expect(page.locator('[data-timeline-edit="finish"]')).toContainText('Excluded');
  await expect(page.locator('#timeline-stats')).toContainText('4 people');
});

test('Timeline leaves unknown durations for review and makes long schedules navigable',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  tk.sheets[0].rows.unshift({id:'mobilize',name:'Mobilization',kind:'equip',count:1,time:8,days:1,cost:100});
  tk.sheets[0].rows[1].time=8;tk.sheets[0].rows[1].days=20;
  await openWorkbook(page,data);await page.locator('#rail .tab-timeline').click();
  await expect(page.locator('[data-timeline-task="mobilize"]')).toContainText('Needs duration');
  await expect(page.locator('[data-timeline-task="row-sn"]')).toContainText('Waiting for prior duration');
  await expect(page.locator('.timeline-bar')).toHaveCount(0);
  await page.getByRole('spinbutton',{name:'Duration hours for Mobilization',exact:true}).fill('8');
  await page.getByRole('spinbutton',{name:'Duration hours for Mobilization',exact:true}).blur();
  await expect(page.locator('.timeline-bar')).toHaveCount(2);
  await page.locator('#timeline-next').click();
  await expect(page.locator('#timeline-window')).toContainText('8');
  await expect(page.locator('[data-timeline-task="mobilize"]')).toHaveCount(0);
  await expect(page.locator('[data-timeline-task="row-sn"] .timeline-bar')).toContainText('160h');
  await page.locator('#timeline-hours').fill('0');await page.locator('#timeline-hours').blur();
  await expect(page.locator('#timeline-error')).toContainText('1 to 24');
  expect(await page.evaluate(()=>window.estimator.getTimelineTakeoff().timeline.hoursPerDay)).toBeUndefined();
  await page.locator('#timeline-hours').fill('8');await page.locator('#timeline-hours').blur();
  await page.setViewportSize({width:390,height:844});
  await expect(page.locator('#timelineCard')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({path:'.tools/timeline-phone.png'});
});

test('Timeline groups repeated Labor subsections into readable scope lanes without changing saved work',async({page})=>{
  const data=workbook(),tk=data.lists[0].companies[0].projects[0].takeoffs[0];
  const names=['Remove existing light fixtures','Remove partition walls','Remove suspended ceiling','Saw cut slab','Remove plumbing fixtures','Remove existing flooring','Load out demolition debris','Clean and prepare work area'];
  tk.sheets[0].title='A001 - Interior Demolition';tk.sheets[0].color='rust';tk.sheets[0].rows=[];
  names.forEach((name,i)=>tk.sheets[0].rows.push(
    {id:'work-'+i,type:'section',name},
    {id:'labor-'+i,type:'section',name:'Labor'},
    {id:'crew-'+i,kind:'labor',name:'Labor',count:i===7?1:3,time:i===7?1:8,days:1,cost:100},
    {id:'labor-end-'+i,type:'sectionEnd',sid:'labor-'+i},{id:'work-end-'+i,type:'sectionEnd',sid:'work-'+i}
  ));
  const starts=[32,24,56,48,28,16,40,24];
  tk.timeline={hoursPerDay:8,tasks:starts.map((startHour,i)=>({id:'labor-'+i,startHour}))};
  await openWorkbook(page,data);await page.locator('#rail .tab-timeline').click();
  const before=await page.evaluate(()=>JSON.stringify(window.estimator.getTimelineTakeoff()));
  await expect(page.locator('[data-timeline-scope]')).toHaveCount(1);
  await expect(page.locator('.timeline-scope-row>.timeline-label strong')).toHaveText('A001 - Interior Demolition');
  await expect(page.locator('.timeline-work-key strong')).toHaveText([names[5],names[7],names[1],names[4],names[0],names[6],names[3]]);
  await expect(page.locator('[data-timeline-key="labor-7"]')).toContainText('1 person');
  await expect(page.locator('[data-timeline-task="labor-7"] .timeline-bar')).toHaveText('2');
  expect(await page.locator('#timeline-chart').evaluate(el=>el.scrollHeight<=el.clientHeight+1)).toBe(true);
  for(const theme of ['light','dark','medieval']){
    await page.evaluate(theme=>window.estimator.setTheme(theme),theme);
    await page.locator('#timelineCard>.scroll').evaluate(el=>{el.scrollTop=240;});
    await page.screenshot({path:'.tools/timeline-scope-lanes-'+theme+'.png'});
  }
  await page.locator('#timeline-scale').selectOption('14');
  await expect(page.locator('.timeline-work-key strong')).toHaveCount(8);
  await page.locator('#timeline-scale').selectOption('1');
  await expect(page.locator('#timeline-chart')).toContainText('No scheduled work in these days');
  await page.locator('#timeline-next').click();await page.locator('#timeline-next').click();
  await expect(page.locator('[data-timeline-key="labor-5"]')).toContainText(names[5]);
  expect(await page.evaluate(()=>JSON.stringify(window.estimator.getTimelineTakeoff()))).toBe(before);
  await page.locator('[data-timeline-key="labor-5"]').click();
  await expect(page.locator('#body tr[data-id="labor-5"]')).toBeInViewport();
});
