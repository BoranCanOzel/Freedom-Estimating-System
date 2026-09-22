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
  await page.locator('#body .card-btn').first().click();
  const draftName=page.locator('#editor .ed-name, #editor .gc-name').first();
  await draftName.fill('Draft change');
  await page.keyboard.press('Control+z');
  await expect(draftName).toHaveValue('Concrete cutting');
  await page.keyboard.press('Control+y');
  await expect(draftName).toHaveValue('Draft change');
  await page.locator('#edSave').click();
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
    await peer.locator('#server-login-form button').click();
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
    await page.locator('#body .card-btn').first().click();
    const draft=page.locator('#editor .ed-name, #editor .gc-name').first();
    await draft.fill('My draft');
    await peer.locator('#body input[aria-label="cost"]').first().focus();
    await peer.locator('#body input[aria-label="cost"]').first().fill('99');
    await expect(page.locator('#body input[aria-label="cost"]').first()).toHaveValue('99.00');
    await page.keyboard.press('Control+z');
    await expect(draft).toHaveValue('Concrete cutting');
    await page.keyboard.press('Control+y');
    await expect(draft).toHaveValue('My draft');
    await page.locator('#edSave').click();
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
  await expect(original).toBeVisible();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await page.reload();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const saved = await page.evaluate(() => window.estimator.exportBook().templates.items);
  expect(saved.map(t => t.name)).toEqual(['Saw','Saw (copy 2)']);
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
  const template = page.locator('#libAll .tpl').filter({hasText:'Pictured item'});
  await template.locator('.tpl-name').click();
  await expect(page.locator('#editor')).not.toBeVisible();
  await expect(template.getByTitle('Add to the end of this option')).toHaveCount(0);
  await template.getByRole('button', {name:'Edit', exact:true}).click();
  await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#edSave').click();
  const add = async () => {
    await template.locator('.tpl-name').click();
    const source = await template.locator('.tpl-name').boundingBox();
    const targetRow = page.locator('#body tr[data-type="item"]').first();
    const target = await targetRow.boundingBox();
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + 80, target.y + target.height * 0.8, {steps:15});
    const displayedTarget = await targetRow.boundingBox();
    await page.mouse.move(displayedTarget.x + 80, displayedTarget.y + displayedTarget.height * 0.8);
    await page.mouse.up();
  };
  await add();
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
  await add();
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
    await peer.goto('/');await peer.locator('#server-login-name').fill(other);await peer.locator('#server-login-form button').click();
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

test('summary shows customer, job address maps and the active takeoff', async ({page}) => {
  const data=workbook(), company=data.lists[0].companies[0];
  company.address='12 Office Road'; company.phone='555-0100'; company.email='office@example.com';
  company.projects[0].address='100 Main St, Suite #4 & Yard';
  company.projects[0].contacts='Site supervisor';
  company.projects[0].takeoffs[0].note='Sawcut and removal';
  data.sumProjOpen=false; data.sumTkOpen=false;
  await openWorkbook(page,data);
  await page.locator('#rail .tab-summary').click();
  const details=page.locator('#sumBlocks');
  await expect(details.locator('.customer')).toContainText('Freedom Customer');
  await expect(details.locator('.customer')).toContainText('555-0100');
  await expect(details.locator('.customer')).toContainText('office@example.com');
  await expect(details.locator('.proj')).toContainText('North job');
  await expect(details.locator('.proj')).toContainText('Site supervisor');
  await expect(details.locator('.tk')).toContainText('North takeoff');
  await expect(details.locator('.tk')).toContainText('Sawcut and removal');
  const map=details.locator('.proj .summary-map-link');
  await expect(map).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.projects[0].address));
  await expect(map).toHaveAttribute('target','_blank');
  await expect(map).toHaveAttribute('rel','noopener noreferrer');
  await page.evaluate(()=>window.estimator.openLocation({list:'list',takeoff:'ts',sheet:'ss',view:'summary'}));
  await expect(details.locator('.proj')).toContainText('South job');
  await expect(details.locator('.tk')).toContainText('South takeoff');
  await expect(details.locator('.proj')).toContainText('Customer address');
  await expect(map).toHaveAttribute('href','https://www.google.com/maps/search/?api=1&query='+encodeURIComponent(company.address));
  await expect(details).not.toContainText('100 Main St');
  await openWorkbook(page,workbook());
  await page.locator('#rail .tab-summary').click();
  await expect(details.locator('.summary-map-link')).toHaveCount(0);
  await expect(details.locator('.customer')).toContainText('Freedom Customer');
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
  await row('work').locator('.card-btn').click();
  await page.locator('#editor .ed-name, #editor .gc-name').first().fill('Saved nested item');
  await page.locator('#edSave').click();
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
