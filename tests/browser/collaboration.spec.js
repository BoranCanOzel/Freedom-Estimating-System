import { test, expect } from '@playwright/test';

test('two estimators share edits, cursors, reconnects and projects', async ({ browser, baseURL }) => {
  const a = await browser.newContext({baseURL}), b = await browser.newContext({baseURL});
  const alice = await a.newPage(), bob = await b.newPage(), errors=[];
  for(const page of [alice,bob])page.on('pageerror',e=>errors.push(e.message));
  async function login(page,name){await page.goto('/');await page.locator('#server-login-name').fill(name);await page.locator('#server-login-form button').click();await expect(page.locator('#server-login')).not.toBeVisible();}
  try {
    await login(alice,'Alice '+Date.now()); await login(bob,'Bob '+Date.now());
    const name='Browser test '+Date.now();
    await alice.locator('#server-new').click();await alice.locator('#server-name-input').fill(name);await alice.locator('#server-name-form button[type=submit]').click();
    await expect(alice.locator('#server-status')).toHaveText('All changes saved');
    await bob.locator('#server-open').click(); await bob.getByRole('button').filter({has: bob.getByText(name,{exact:true})}).click();
    await expect(bob.locator('#server-status')).toHaveText('All changes saved');
    await alice.locator('#body input[aria-label="Item name"]').first().fill('Shared saw');
    await expect(bob.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Shared saw');
    await bob.locator('#title').fill('Bob scope');
    await expect(alice.locator('#title')).toHaveValue('Bob scope');
    // A remote update must preserve a focused input and its DOM binding.
    const field=alice.locator('#body input[aria-label="Item name"]').first(); await field.focus();
    await bob.locator('#title').fill('Updated scope'); await expect(alice.locator('#title')).toHaveValue('Updated scope');
    await expect(field).toBeFocused(); await field.press('End');await field.pressSequentially(' plus');
    await expect(bob.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Shared saw plus');
    await alice.locator('#body input[aria-label="Item name"]').first().hover();
    await expect(bob.locator('.server-cursor')).toContainText('Alice');
    await expect(bob.locator('.server-field')).toHaveCount(1);
    // Scrolling must reuse collaborator nodes rather than rebuilding the header.
    const retained = await bob.evaluate(async () => {
      const badge = document.querySelector('.server-person'), cursor = document.querySelector('.server-cursor');
      const scroller = document.querySelector('#sheetCard .scroll');
      for(let i=0;i<30;i++) scroller.dispatchEvent(new Event('scroll'));
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      return {badge:badge===document.querySelector('.server-person'),cursor:cursor===document.querySelector('.server-cursor')};
    });
    expect(retained).toEqual({badge:true,cursor:true});
    // Selecting another view must remain personal.
    await alice.locator('#rail .tab-summary').click();
    await expect(alice.locator('#summaryCard')).toBeVisible();await expect(bob.locator('#sheetCard')).toBeVisible();
    // Edits made during a network outage merge with the other user's work.
    await a.setOffline(true);
    await alice.locator('#rail .tab[data-sheet]').first().click();
    await alice.locator('#body input[aria-label="Item name"]').first().fill('Offline saw');
    await bob.locator('#title').fill('Online scope');
    await a.setOffline(false);
    await expect(alice.locator('#server-status')).toHaveText('All changes saved',{timeout:20000});
    await expect(bob.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Offline saw');
    await expect(alice.locator('#title')).toHaveValue('Online scope');
    // A detail-editor draft must not overwrite an unrelated incoming field.
    await alice.locator('#body .card-btn').first().click();
    await alice.locator('#editor .ed-name, #editor .gc-name').first().fill('Draft name');
    await expect(bob.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Offline saw');
    await bob.locator('#body input[aria-label="cost"]').first().fill('88');
    await expect(alice.locator('#body input[aria-label="cost"]').first()).toHaveValue('88.00');
    await expect(alice.locator('#editor .ed-name, #editor .gc-name').first()).toHaveValue('Draft name');
    await alice.locator('#edSave').click();
    await expect(bob.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Draft name');
    await expect(bob.locator('#body input[aria-label="cost"]').first()).toHaveValue(/^88(?:\.00)?$/);
    await alice.locator('#server-projects').click();
    await alice.locator('#server-tab-workbooks').click();
    await alice.locator('#server-workbook-actions > summary').click();
    await alice.locator('#server-close').click();
    await alice.getByRole('button').filter({has:alice.getByText(name,{exact:true})}).click();
    await expect(alice.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Draft name');
    await expect(alice.locator('#title')).toHaveValue('Online scope');
    expect(errors).toEqual([]);
    await alice.screenshot({path:'test-results/collaboration.png',fullPage:true});
  } finally { await a.close();await b.close(); }
});

test('imports legacy JSON and server snapshots without losing hierarchy or libraries', async ({page}) => {
  await page.goto('/');await page.locator('#server-login-name').fill('Importer');await page.locator('#server-login-form button').click();
  const book={sheets:[{id:'s1',title:'Original scope',rows:[{id:'r1',kind:'labor',name:'Legacy item',cost:50,count:1,time:1,days:1}]}],
    companies:[{id:'co1',name:'Customer',projects:[{id:'pr1',name:'Job',takeoffs:[{id:'tk1',name:'Takeoff',sheets:[{id:'s1',title:'Original scope',rows:[{id:'r1',kind:'labor',name:'Legacy item',cost:50,count:1,time:1,days:1}]}]}]}]}],
    templates:{items:[{id:'tpl1',name:'Library item',kind:'labor',cost:25}],sections:[],scopes:[]}};
  await page.locator('#server-import-file').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(book))});
  await expect(page.locator('#title')).toHaveValue('Original scope');
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const canonical=await page.evaluate(()=>window.estimator.getShared());
  expect(canonical.lists[0].companies[0].name).toBe('Customer');
  expect(canonical.libs[0].templates.items[0].name).toBe('Library item');
  await page.locator('#server-import-file').setInputFiles({name:'snapshot.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({_app:'project-breakdown',_v:3,...canonical}))});
  await expect(page.locator('#server-title')).toHaveText('snapshot');
  await expect(page.locator('#body input[aria-label="Item name"]').first()).toHaveValue('Legacy item');
  await page.locator('#server-projects').click();
  await page.screenshot({path:'test-results/project-browser.png',fullPage:true});
});
