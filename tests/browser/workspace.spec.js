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
    await page.locator('#server-login-form button').click(); await expect(page.locator('#server-login')).not.toBeVisible();
    if (name === 'Workspace tester') workspaceCookies = await page.context().cookies();
  }
  await expect(page.locator('#server-status')).toHaveText(/^(All changes saved|No project open)$/,{timeout:20000});
  await page.locator('#workspace-file > summary').click();
  const chooser = page.waitForEvent('filechooser'); await page.locator('#server-import').click();
  const workbookName='Organized '+Date.now();
  const refreshed=page.waitForResponse(r=>r.url().endsWith('/api/projects') && r.request().method()==='GET');
  await (await chooser).setFiles({name:workbookName+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))});
  await refreshed;
  await expect(page.locator('#server-title')).toHaveText(workbookName);
  await expect(page.locator('#server-status')).toHaveText('All changes saved', {timeout:20000});
}

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
    await fresh.locator('#server-login-name').fill(name);await fresh.locator('#server-login-form button').click();
    await expect(fresh.locator('#server-status')).toHaveText('All changes saved');
    await expect(fresh.locator('#server-title')).toHaveText(selected);
    await expect(fresh.locator('#title')).toHaveValue('Remember this tab');
    await expect(fresh.locator('#sheetCard')).toBeVisible();
  } finally {await context.close();}
});

test('cursor style persists on the account while text and resize cursors remain usable', async ({page}) => {
  await openWorkbook(page,workbook(),'Cursor tester '+Date.now());
  await page.locator('#workspace-view > summary').click();
  const saved = page.waitForResponse(r=>r.url().endsWith('/api/preferences') && r.request().method()==='PUT');
  await page.locator('#workspace-cursor').selectOption('large-dark');
  expect((await saved).ok()).toBe(true);
  await expect(page.locator('body')).toHaveAttribute('data-cursor','large-dark');
  expect(await page.locator('#add').evaluate(el=>getComputedStyle(el).cursor)).toContain('data:image/svg+xml');
  await expect(page.locator('#title')).toHaveCSS('cursor','text');
  await expect(page.locator('#sheetTable .col-resizer').first()).toHaveCSS('cursor','col-resize');
  await page.reload();
  await page.locator('#workspace-view > summary').click();
  await expect(page.locator('#workspace-cursor')).toHaveValue('large-dark');
  const savedCrosshair = page.waitForResponse(r=>r.url().endsWith('/api/preferences') && r.request().method()==='PUT');
  await page.locator('#workspace-cursor').selectOption('crosshair');
  expect((await savedCrosshair).ok()).toBe(true);
  await expect(page.locator('body')).toHaveCSS('cursor','crosshair');
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

test('new pictured items follow Hide and Show without forcing existing rows open', async ({page}) => {
  const data = workbook();
  data.templates = {items:[{id:'pictured',name:'Pictured item',kind:'labor',cost:25,
    img:'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}],sections:[],scopes:[]};
  await openWorkbook(page, data);
  await page.locator('#workspace-view > summary').click();
  await page.locator('#hidePics').click();
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#libToggle').click();
  const add = page.locator('.tpl').filter({hasText:'Pictured item'}).getByTitle('Add to the end of this option');
  await add.click();
  const rows = page.locator('#body tr[data-type="item"]').filter({has:page.locator('.pic-strip img')});
  await expect(rows).toHaveCount(1);
  await expect(rows.first().locator('.pic-strip')).not.toHaveClass(/open/);
  await page.locator('#libToggle').click();
  await rows.first().locator('.card-btn').click();
  await page.locator('#edSave').click();
  await expect(rows.first().locator('.pic-strip')).not.toHaveClass(/open/);
  await page.locator('#workspace-view > summary').click();
  await page.locator('#showPics').click();
  await page.locator('#workspace-view > summary').press('Escape');
  await page.locator('#libToggle').click();
  await add.click();
  await expect(rows).toHaveCount(2);
  await expect(rows.last().locator('.pic-strip')).toHaveClass(/open/);
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
  await page.locator('[data-takeoff="ts"]').click(); await expect(page.locator('#title')).toHaveValue('South scope');
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
  const downloaded = page.waitForEvent('download'); await page.locator('#server-export').click();
  const download = await downloaded;
  const stream = await download.createReadStream(); let text=''; for await(const chunk of stream) text += chunk.toString();
  const saved = JSON.parse(text), projects = saved.lists[0].companies[0].projects;
  expect(projects[0].custom.Area).toBe('North'); expect(projects[1].custom.Area).toBe('South');
  expect(projects[0].status).toBe('Bidding'); expect(saved.filterFields).toContain('Area');
  await page.locator('#projOptions').click();
  await page.screenshot({path:'test-results/project-settings.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('project presence, tab highlights, collapse and recent views work for two users',async({page,browser,baseURL})=>{
  const data=workbook();
  data.lists[0].companies[0].projects[0].takeoffs[0].sheets.push(sheet('sn2','Second scope'));
  const name='Navigator '+Date.now(), other='Viewer '+Date.now();
  await openWorkbook(page,data,name);
  const context=await browser.newContext({baseURL}), peer=await context.newPage();
  try {
    await peer.goto('/');await peer.locator('#server-login-name').fill(other);await peer.locator('#server-login-form button').click();
    const workbookName=await page.locator('#server-title').textContent();
    await peer.locator('#server-list .server-project').filter({hasText:workbookName}).click();
    await expect(peer.locator('#server-status')).toHaveText('All changes saved');
    await peer.locator('#rail [data-sheet="sn2"]').click();
    await expect(page.locator('#rail [data-sheet="sn2"] .tab-presence')).toContainText(other);
    await expect(page.locator('#server-people .server-person')).toHaveAttribute('title',/Freedom Customer → North job → North takeoff → Tab 2/);
    await page.locator('#server-projects').click();
    await page.locator('[data-company="co"] > .p-head > .p-name').click();
    await expect(page.locator('[data-project="north"] > .p-head.lvl2 .project-presence')).toContainText(other);
    await page.locator('#projCollapse').click();
    await expect(page.locator('#projBody [data-project]')).toHaveCount(0);
    await expect(page.locator('[data-company="co"] > .p-head .project-presence')).toContainText(other);
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

test('menus preserve rounding, display, downloads, printing and keyboard access', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openWorkbook(page);
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
  await page.locator('#showPics').click(); await expect(page.locator('#showPics')).toHaveClass(/on/);
  await page.locator('#hidePics').click(); await expect(page.locator('#hidePics')).toHaveClass(/on/);
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
