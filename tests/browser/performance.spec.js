import {test,expect} from '@playwright/test';

test.setTimeout(180000);
test.afterEach(async({page})=>{await page.close({runBeforeUnload:false}).catch(()=>{});});

function page(id,rows){
  return {id,title:'Scope '+id,fees:[{id:'fee-'+id,label:'Fee',pct:3}],units:[{id:'unit-'+id,label:'SF',qty:250}],
    rows:Array.from({length:rows},(_,i)=>({id:id+'-row-'+i,kind:'labor',name:'Work item '+i,count:1,time:1,days:1,cost:125,markup:0,note:''}))};
}

function stressBook(){
  const takeoffs=[];
  const primary={id:'speed-takeoff',name:'Large performance takeoff',folders:[
    {id:'speed-folder-a',name:'Building A'},{id:'speed-folder-b',name:'Building B'},{id:'speed-folder-c',name:'Building C'}],
    sheets:Array.from({length:18},(_,i)=>({...page('speed-page-'+i,100),folderId:'speed-folder-'+String.fromCharCode(97+Math.floor(i/6))})),
    active:'speed-page-0',activeFolder:'speed-folder-a'};
  takeoffs.push(primary);
  for(let t=1;t<=8;t++)takeoffs.push({id:'speed-extra-'+t,name:'Additional takeoff '+t,sheets:Array.from({length:4},(_,i)=>page('speed-extra-'+t+'-page-'+i,35))});
  return {activeList:'speed-list',activeTakeoff:primary.id,active:primary.active,view:'sheet',
    lists:[{id:'speed-list',name:'Performance test',companies:[{id:'speed-company',name:'Performance Customer',projects:[{id:'speed-project',name:'Large project',status:'Open',takeoffs}]}]}]};
}

async function installProbe(page){
  await page.evaluate(()=>{
    window.__speedProbe={mutations:0,longTasks:[]};
    new MutationObserver(records=>window.__speedProbe.mutations+=records.length).observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true});
    new PerformanceObserver(list=>window.__speedProbe.longTasks.push(...list.getEntries().map(entry=>entry.duration))).observe({type:'longtask',buffered:true});
  });
}

async function openStressBook(page,data=stressBook()){
  page.on('dialog',dialog=>dialog.accept());
  await page.goto('/');
  const username='Performance '+Date.now();
  await page.locator('#server-login-name').fill(username);
  await page.locator('#server-login-password').fill('1313');
  await page.locator('#server-login-form button').click();
  await expect(page.locator('#server-login')).not.toBeVisible();
  await expect(page.locator('#server-status')).toHaveText(/^(All changes saved|No project open)$/,{timeout:30000});
  await page.locator('#workspace-file > summary').click();
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#server-import').click();
  const imported=page.waitForResponse(response=>response.url().endsWith('/api/projects')&&response.request().method()==='GET');
  await (await chooser).setFiles({name:'Performance workload.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await page.locator('#import-preview button[type=submit]').click();
  await imported;
  await expect(page.locator('#server-title')).toHaveText('Performance workload');
  await expect(page.locator('#server-status')).toHaveText('All changes saved',{timeout:60000});
  await expect(page.locator('#body tr[data-type="item"]')).toHaveCount(100);
}

async function measureClick(page,session,label,locator){
  const before=(await session.send('Performance.getMetrics')).metrics;
  await session.send('Profiler.start');
  const result=await locator.evaluate(async element=>{
    const probe=window.__speedProbe;
    probe.mutations=0;probe.longTasks.length=0;
    const start=performance.now();element.click();const syncMs=performance.now()-start;
    await new Promise(requestAnimationFrame);
    void document.body.offsetHeight;
    await new Promise(requestAnimationFrame);
    return {syncMs,frameMs:performance.now()-start,mutations:probe.mutations,longTasks:[...probe.longTasks]};
  });
  const {profile}=await session.send('Profiler.stop');
  const after=(await session.send('Performance.getMetrics')).metrics;
  const delta=name=>1000*(after.find(metric=>metric.name===name).value-before.find(metric=>metric.name===name).value);
  const hotspots=profile.nodes.filter(node=>node.hitCount).sort((a,b)=>b.hitCount-a.hitCount).slice(0,8).map(node=>({name:node.callFrame.functionName||'(anonymous)',hits:node.hitCount}));
  return {action:label,...result,scriptMs:delta('ScriptDuration'),layoutMs:delta('LayoutDuration'),styleMs:delta('RecalcStyleDuration'),taskMs:delta('TaskDuration'),hotspots};
}

test('large-workbook action latency profile covers everyday navigation and edits',async({page})=>{
  await openStressBook(page);
  const session=await page.context().newCDPSession(page);
  await session.send('Performance.enable');await session.send('Profiler.enable');
  await installProbe(page);

  const profile=[];
  profile.push(await measureClick(page,session,'Open summary',page.locator('#rail .tab-summary')));
  profile.push(await measureClick(page,session,'Collapse folder',page.locator('#sumTable .summary-folder-toggle').first()));
  profile.push(await measureClick(page,session,'Expand folder',page.locator('#sumTable .summary-folder-toggle').first()));
  profile.push(await measureClick(page,session,'Open page',page.locator('#rail [data-sheet="speed-page-1"]')));
  profile.push(await measureClick(page,session,'Add page',page.locator('#rail .tab-add')));
  await expect(page.locator('#rail .option-tab')).toHaveCount(7);
  profile.push(await measureClick(page,session,'Delete new page',page.locator('#rail .option-close').last()));
  await expect(page.locator('#rail .option-tab')).toHaveCount(6);
  profile.push(await measureClick(page,session,'Add line item',page.locator('#add')));
  profile.push(await measureClick(page,session,'Delete line item',page.locator('#body .del').last()));
  await expect(page.locator('#server-status')).toHaveText('All changes saved',{timeout:10000});
  profile.push(await measureClick(page,session,'Open project panel',page.locator('#server-projects')));
  const search=page.locator('#projSearch');
  const beforeSearch=(await session.send('Performance.getMetrics')).metrics;
  const searchResult=await search.evaluate(async input=>{
    const probe=window.__speedProbe;probe.mutations=0;probe.longTasks.length=0;
    const start=performance.now();input.value='Large';input.dispatchEvent(new Event('input',{bubbles:true}));const syncMs=performance.now()-start;
    await new Promise(requestAnimationFrame);void document.body.offsetHeight;await new Promise(requestAnimationFrame);
    return {syncMs,frameMs:performance.now()-start,mutations:probe.mutations,longTasks:[...probe.longTasks]};
  });
  const afterSearch=(await session.send('Performance.getMetrics')).metrics;
  const searchDelta=name=>1000*(afterSearch.find(metric=>metric.name===name).value-beforeSearch.find(metric=>metric.name===name).value);
  profile.push({action:'Search projects',...searchResult,scriptMs:searchDelta('ScriptDuration'),layoutMs:searchDelta('LayoutDuration'),styleMs:searchDelta('RecalcStyleDuration'),taskMs:searchDelta('TaskDuration')});

  console.log('Large-workbook interaction profile',JSON.stringify(profile));
  const slowest=[...profile].sort((a,b)=>b.syncMs-a.syncMs)[0];
  expect(slowest.syncMs,JSON.stringify(profile)).toBeLessThan(350);
  expect(Math.max(...profile.map(item=>item.frameMs)),JSON.stringify(profile)).toBeLessThan(650);
  expect(Math.max(...profile.flatMap(item=>item.longTasks)),JSON.stringify(profile)).toBeLessThan(250);
  await session.send('Profiler.disable');await session.send('Performance.disable');
  await session.detach();
});

test('basic navigation and edits stay below the interaction budget',async({page})=>{
  const book=stressBook(),project=book.lists[0].companies[0].projects[0];
  project.takeoffs=[project.takeoffs[0]];project.takeoffs[0].sheets=project.takeoffs[0].sheets.slice(0,3);
  await openStressBook(page,book);
  await installProbe(page);
  const session=await page.context().newCDPSession(page);await session.send('Performance.enable');await session.send('Profiler.enable');
  const profile=[];
  profile.push(await measureClick(page,session,'Switch to summary',page.locator('#rail .tab-summary')));
  profile.push(await measureClick(page,session,'Switch to page',page.locator('#rail [data-sheet="speed-page-1"]')));
  profile.push(await measureClick(page,session,'Switch to Scope',page.locator('#rail .tab-scope')));
  profile.push(await measureClick(page,session,'Switch to Timeline',page.locator('#rail .tab-timeline')));
  profile.push(await measureClick(page,session,'Return to page',page.locator('#rail [data-sheet="speed-page-1"]')));
  profile.push(await measureClick(page,session,'Open detail drawer',page.locator('#libToggle')));
  profile.push(await measureClick(page,session,'Close detail drawer',page.locator('#libToggle')));
  profile.push(await measureClick(page,session,'Add page',page.locator('#rail .tab-add')));
  profile.push(await measureClick(page,session,'Delete page',page.locator('#rail .option-close').last()));
  await expect(page.locator('#server-status')).toHaveText('All changes saved',{timeout:10000});
  console.log('Basic interaction profile',JSON.stringify(profile));
  expect(Math.max(...profile.map(item=>item.syncMs)),JSON.stringify(profile)).toBeLessThan(250);
  expect(Math.max(...profile.map(item=>item.frameMs)),JSON.stringify(profile)).toBeLessThan(400);
  expect(Math.max(...profile.flatMap(item=>item.longTasks)),JSON.stringify(profile)).toBeLessThan(200);
  await session.send('Profiler.disable');await session.send('Performance.disable');
  await session.detach();
});
