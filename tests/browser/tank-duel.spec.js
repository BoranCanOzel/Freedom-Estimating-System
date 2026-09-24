import { test, expect } from '@playwright/test';

test('online players accept a tank duel, trade shots and leave without changing the estimate', async ({browser,baseURL})=>{
  const a=await browser.newContext({baseURL}),b=await browser.newContext({baseURL});
  const alice=await a.newPage(),bob=await b.newPage(),errors=[];
  for(const page of [alice,bob])page.on('pageerror',e=>errors.push(e.message));
  async function login(page,name){await page.goto('/');await page.locator('#server-login-name').fill(name);await page.locator('#server-login-password').fill('1313');await page.locator('#server-login-form button').click();await expect(page.locator('#server-login')).not.toBeVisible();}
  try {
    const stamp=Date.now();await login(alice,'Tank Alice '+stamp);await login(bob,'Tank Bob '+stamp);
    const name='Tank test '+stamp;
    await alice.locator('#server-new').click();await alice.locator('#server-name-input').fill(name);await alice.locator('#server-name-form button[type=submit]').click();
    await expect(alice.locator('#server-status')).toHaveText('All changes saved');
    await bob.locator('#server-open').click();await bob.getByRole('button').filter({has:bob.getByText(name,{exact:true})}).click();
    await expect(bob.locator('#server-status')).toHaveText('All changes saved');
    const before=await alice.evaluate(()=>window.estimator.getShared());
    await alice.getByRole('button',{name:/Challenge Tank Bob/}).click();
    await expect(bob.locator('#duel-accept')).toBeVisible();
    await expect(alice.locator('#duel-status')).toHaveText('Challenge sent');
    await bob.locator('#duel-accept').click();
    for(const page of [alice,bob])await expect(page.locator('#duel-game')).toBeVisible();
    const overlay = await alice.locator('#tank-duel').evaluate(el=>{
      const rect=el.getBoundingClientRect(),canvas=el.querySelector('canvas'),bounds=canvas.getBoundingClientRect();
      return {left:rect.left,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,
        transparent:canvas.getContext('2d').getImageData(500,40,1,1).data[3]===0,
        clickThrough:!el.contains(document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+20))};
    });
    expect(overlay.left).toBeCloseTo(0);expect(overlay.right).toBeCloseTo(overlay.width);expect(overlay.bottom).toBeCloseTo(overlay.height);
    expect(overlay.transparent).toBe(true);expect(overlay.clickThrough).toBe(true);
    await expect(alice.locator('#duel-status')).toHaveText(/turn/);
    const first=await alice.locator('#duel-fire').isEnabled()?alice:bob,second=first===alice?bob:alice;
    await expect(second.locator('#duel-fire')).toBeDisabled();
    await first.locator('#duel-angle').fill(first===alice?'5':'175');await first.locator('#duel-power').fill('10');
    await first.locator('#duel-fire').click();
    await expect(second.locator('#duel-fire')).toBeEnabled();
    await expect(first.locator('#duel-fire')).toBeDisabled();
    await second.locator('#duel-angle').fill(second===alice?'5':'175');await second.locator('#duel-power').fill('10');
    await second.locator('#duel-fire').click();await expect(first.locator('#duel-fire')).toBeEnabled();
    await alice.screenshot({path:'test-results/tank-duel.png',fullPage:true});
    expect(await alice.evaluate(()=>window.estimator.getShared())).toEqual(before);
    await bob.locator('#duel-close').click();
    await expect(alice.locator('#duel-status')).toContainText('left the duel');
    await bob.getByRole('button',{name:/Challenge Tank Alice/}).click();
    await alice.locator('#duel-decline').click();
    await expect(bob.locator('#duel-status')).toContainText('declined');
    expect(errors).toEqual([]);
  }finally{await a.close();await b.close();}
});
