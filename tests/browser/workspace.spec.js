import { test, expect } from '@playwright/test';

const sheet = (id, title) => ({ id, title, fees: [{id:'fee-'+id,label:'Fee',pct:3}], units: [],
  rows: [{id:'row-'+id,kind:'labor',name:'Concrete cutting',count:1,time:1,days:1,cost:125,markup:0,note:'Crew detail'}] });
function workbook() {
  return {lists:[{id:'list',name:'Estimating',companies:[{id:'co',name:'Freedom Customer',projects:[
    {id:'north',name:'North job',status:'Open',custom:{Region:'North'},takeoffs:[{id:'tn',name:'North takeoff',sheets:[sheet('sn','North scope')]}]},
    {id:'south',name:'South job',status:'Completed',custom:{Region:'South'},takeoffs:[{id:'ts',name:'South takeoff',sheets:[sheet('ss','South scope')]}]}
  ]}]}],customFields:{company:['Account'],project:['Region'],takeoff:['Estimator']},filterFields:['Region']};
}
async function openWorkbook(page) {
  await page.goto('/'); await page.locator('#server-login-name').fill('Workspace tester');
  await page.locator('#server-login-form button').click(); await expect(page.locator('#server-login')).not.toBeVisible();
  await page.locator('#workspace-file > summary').click();
  const chooser = page.waitForEvent('filechooser'); await page.locator('#server-import').click();
  await (await chooser).setFiles({name:'Organized '+Date.now()+'.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(workbook()))});
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
}

test('one project drawer retains hierarchy, custom details and filters', async ({page}) => {
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await openWorkbook(page); await page.locator('#server-projects').click();
  await expect(page.locator('#projToggle')).not.toBeVisible();
  await expect(page.locator('#server-drawer #projects')).toBeVisible();
  await expect(page.locator('#server-browser')).not.toBeVisible();
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
  await page.locator('#server-projects').click();await page.locator('#server-open').click();
  await expect(page.locator('#server-list')).toBeVisible();await page.locator('#server-back').click();
  await expect(page.locator('#server-hierarchy')).toBeVisible();
  const name=await page.locator('#server-title').textContent();
  await page.locator('#server-workbook-actions > summary').click();await page.locator('#server-close').click();
  await page.locator('#server-list .server-project').filter({hasText:name}).click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  await expect(page.locator('body')).toHaveClass(/dark/);await expect(page.locator('body')).not.toHaveClass(/medieval/);
  await page.screenshot({path:'test-results/workspace-small-screen.png',fullPage:true});
});
