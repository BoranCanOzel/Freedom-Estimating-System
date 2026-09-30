import { test, expect } from '@playwright/test';
import { fireShot } from '../../shared/tank-game.js';

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
    const challenge = alice.getByRole('button',{name:/Challenge Tank Bob/});
    await challenge.click();
    await expect(alice.locator('#duel-notice')).toContainText('One of you already has a duel or invitation open.');
    await expect(alice.locator('#server-message')).not.toContainText('duel or invitation');
    await expect(alice.locator('#duel-notice')).toBeHidden({timeout:8000});
    await challenge.click();
    await expect(alice.locator('#duel-notice')).toBeVisible();
    await alice.getByRole('button',{name:'Dismiss duel message'}).click();
    await expect(alice.locator('#duel-notice')).toBeHidden();
    await challenge.click();
    await expect(alice.locator('#duel-notice')).toBeVisible();
    await bob.locator('#duel-accept').click();
    await expect(alice.locator('#duel-notice')).toBeHidden();
    for(const page of [alice,bob])await expect(page.locator('#duel-game')).toBeVisible();
    const overlay = await alice.locator('#tank-duel').evaluate(el=>{
      const rect=el.getBoundingClientRect(),canvas=el.querySelector('canvas'),bounds=canvas.getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom,width:innerWidth,height:innerHeight,
        transparent:canvas.getContext('2d').getImageData(500,40,1,1).data[3]===0,
        clickThrough:!el.contains(document.elementFromPoint(bounds.left+bounds.width/2,bounds.top+20))};
    });
    expect(overlay.left).toBeCloseTo(0);expect(overlay.right).toBeCloseTo(overlay.width);expect(overlay.bottom).toBeCloseTo(overlay.height);
    expect(overlay.top).toBeCloseTo(0);
    expect(overlay.transparent).toBe(true);expect(overlay.clickThrough).toBe(true);
    for (const width of [1920,1100]) {
      await alice.setViewportSize({width,height:1000});
      await expect.poll(()=>alice.locator('#tank-duel canvas').evaluate(canvas=>Math.abs(canvas.width-canvas.getBoundingClientRect().width*devicePixelRatio))).toBeLessThan(1);
    }
    await alice.setViewportSize({width:1440,height:1000});
    await expect(alice.locator('#duel-status')).toHaveText(/turn/);
    const first=await alice.locator('#duel-fire').isEnabled()?alice:bob,second=first===alice?bob:alice;
    await expect(second.locator('#duel-fire')).toBeDisabled();
    await expect(second.locator('#duel-right')).toBeDisabled();
    await expect(second.locator('#duel-shield')).toBeDisabled();
    await first.locator('#duel-shield').click();
    await expect(first.locator('#duel-shield')).toHaveText('Shield active');
    await expect(first.locator('#duel-shield')).toBeDisabled();
    await first.locator('#duel-right').click();
    for(const page of [first,second])await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 54/60');
    await first.locator('#duel-right').focus();await first.keyboard.press('a');
    for(const page of [first,second])await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 48/60');
    const beforeAim=await second.locator('#tank-duel canvas').evaluate(canvas=>canvas.toDataURL());
    await first.locator('#duel-angle').fill('90');
    await expect.poll(()=>second.locator('#tank-duel canvas').evaluate(canvas=>canvas.toDataURL())).not.toBe(beforeAim);
    const uprightAim=await second.locator('#tank-duel canvas').evaluate(canvas=>canvas.toDataURL());
    await first.locator('#duel-angle').fill('70');
    await expect.poll(()=>second.locator('#tank-duel canvas').evaluate(canvas=>canvas.toDataURL())).not.toBe(uprightAim);
    await expect(first.locator('#duel-fire')).toBeEnabled();
    await expect(second.locator('#duel-fire')).toBeDisabled();
    await first.locator('#duel-angle').fill(first===alice?'5':'175');await first.locator('#duel-power').fill('10');
    await first.locator('#duel-fire').click();
    await expect(second.locator('#duel-fire')).toBeEnabled();
    await expect(second.locator('#duel-fuel')).toHaveText('Turn fuel: 60/60');
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

test('single player controls both tanks and remembers each aim without changing the estimate', async ({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await page.locator('#server-login-name').fill('Solo tanker '+Date.now());
  await page.locator('#server-login-password').fill('1313');
  await page.locator('#server-login-form button').click();
  await expect(page.locator('#server-login')).not.toBeVisible();
  await page.locator('#server-new').click();
  await page.locator('#server-name-input').fill('Solo tank test '+Date.now());
  await page.locator('#server-name-form button[type=submit]').click();
  await expect(page.locator('#server-status')).toHaveText('All changes saved');
  const before=await page.evaluate(()=>window.estimator.getShared());
  await page.locator('#workspace-view > summary').click();
  await page.getByRole('button',{name:'Tank game: single player'}).click();
  await expect(page.locator('#duel-side')).toHaveText('Single player: You control both tanks');
  await expect(page.locator('#duel-status')).toContainText('Teal tank');
  await page.locator('#duel-shield').click();
  await expect(page.locator('#duel-shield')).toHaveText('Shield active');
  await expect(page.locator('#duel-shield')).toBeDisabled();
  await page.locator('#duel-right').focus();await page.keyboard.press('d');
  await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 54/60');
  await page.evaluate(()=>{
    const ctx=document.querySelector('#tank-duel canvas').getContext('2d'),translate=ctx.translate.bind(ctx);
    window.tankMotionSamples=[];
    ctx.translate=(x,y)=>{window.tankMotionSamples.push(x);translate(x,y);};
  });
  await page.keyboard.down('d');
  await expect.poll(()=>page.locator('#duel-fuel-meter').getAttribute('aria-valuenow').then(Number)).toBeLessThanOrEqual(36);
  await page.keyboard.up('d');
  await expect.poll(()=>page.evaluate(()=>window.tankMotionSamples.some(x=>x>85&&x<145&&!Number.isInteger(x)))).toBe(true);
  const stoppedFuel=await page.locator('#duel-fuel-meter').getAttribute('aria-valuenow');
  await expect(page.locator('#duel-fuel')).toHaveText(`Turn fuel: ${stoppedFuel}/60`);
  await page.waitForTimeout(180);
  await expect(page.locator('#duel-fuel-meter')).toHaveAttribute('aria-valuenow',stoppedFuel);
  await page.locator('#duel-angle').fill('5');await page.locator('#duel-power').fill('10');
  await page.locator('#duel-fire').click();
  await expect(page.locator('#duel-fire')).toBeDisabled();
  await expect(page.locator('#duel-fire')).toBeEnabled();
  await expect(page.locator('#duel-status')).toContainText('Amber tank');
  await expect(page.locator('#duel-shield')).toHaveText('Shield (1 charge)');
  await expect(page.locator('#duel-shield')).toBeEnabled();
  await expect(page.locator('#duel-angle')).toHaveValue('135');
  await expect(page.locator('#duel-power')).toHaveValue('65');
  await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 60/60');
  await page.locator('#duel-left').focus();await page.keyboard.press('a');
  await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 54/60');
  await page.locator('#duel-angle').fill('175');await page.locator('#duel-power').fill('10');
  await page.locator('#duel-fire').click();
  await expect(page.locator('#duel-fire')).toBeEnabled();
  await expect(page.locator('#duel-status')).toContainText('Teal tank');
  await expect(page.locator('#duel-angle')).toHaveValue('5');
  await expect(page.locator('#duel-power')).toHaveValue('10');
  await page.context().setOffline(true);
  await page.locator('#duel-restart').click();
  await expect(page.locator('#duel-shield')).toHaveText('Shield (1 charge)');
  await expect(page.locator('#duel-shield')).toBeEnabled();
  await expect(page.locator('#duel-fire')).toBeEnabled();
  await expect(page.locator('#duel-angle')).toHaveValue('45');
  await expect(page.locator('#duel-power')).toHaveValue('65');
  await expect(page.locator('#duel-fuel')).toHaveText('Turn fuel: 60/60');
  await page.locator('#duel-shield').click();
  await page.screenshot({path:'test-results/tank-shield.png'});
  await page.locator('#duel-angle').fill('90');await page.locator('#duel-power').fill('10');
  await page.locator('#duel-fire').click();
  await expect(page.locator('#duel-status')).toContainText('deflected the hit');
  await expect(page.locator('#duel-fire')).toBeEnabled();
  await expect(page.locator('#duel-result')).not.toBeVisible();
  await page.locator('#duel-angle').fill('175');await page.locator('#duel-power').fill('10');
  await page.locator('#duel-fire').click();
  await expect(page.locator('#duel-fire')).toBeEnabled();
  await expect(page.locator('#duel-shield')).toHaveText('Shield spent');
  await expect(page.locator('#duel-shield')).toBeDisabled();
  await page.locator('#duel-close').click();
  await expect(page.locator('#tank-duel')).toBeHidden();
  expect(await page.evaluate(()=>window.estimator.getShared())).toEqual(before);
  expect(errors).toEqual([]);
});

test('a killing shot shows each online player their result and Okay exits the game',async({browser,baseURL})=>{
  const contexts=await Promise.all([browser.newContext({baseURL}),browser.newContext({baseURL})]);
  const pages=await Promise.all(contexts.map(c=>c.newPage()));
  const stamp=Date.now(),names=['Victor '+stamp,'Rival '+stamp],states=[],errors=[];
  try{
    for(const [i,page] of pages.entries()){
      page.on('pageerror',e=>errors.push(e.message));
      page.on('websocket',socket=>socket.on('framereceived',({payload})=>{
        try{const message=JSON.parse(payload.toString());if(message.type==='duel'&&message.event==='state')states[i]=message;}catch{}
      }));
      await page.goto('/');await page.locator('#server-login-name').fill(names[i]);
      await page.locator('#server-login-password').fill('1313');await page.locator('#server-login-form button').click();
      await expect(page.locator('#server-login')).not.toBeVisible();
    }
    const [alice,bob]=pages,name='Result test '+stamp;
    await alice.locator('#server-new').click();await alice.locator('#server-name-input').fill(name);await alice.locator('#server-name-form button[type=submit]').click();
    await expect(alice.locator('#server-status')).toHaveText('All changes saved');
    await bob.locator('#server-open').click();await bob.getByRole('button').filter({has:bob.getByText(name,{exact:true})}).click();
    await expect(bob.locator('#server-status')).toHaveText('All changes saved');
    const before=await alice.evaluate(()=>window.estimator.getShared());
    await alice.getByRole('button',{name:'Challenge '+names[1]+' to a tank duel'}).click();
    await bob.locator('#duel-accept').click();
    await expect.poll(()=>states.length).toBe(2);
    const state=states[0],winner=state.turn,loser=1-winner;let solution;
    for(let angle=25;angle<=80&&!solution;angle++)for(let power=60;power<=100&&!solution;power++){
      const aim=winner===0?angle:180-angle;
      if(fireShot(state.ground,winner,aim,power,state.positions).hit===loser)solution={angle:aim,power};
    }
    expect(solution).toBeTruthy();
    await pages[winner].locator('#duel-angle').fill(String(solution.angle));
    await pages[winner].locator('#duel-power').fill(String(solution.power));
    await pages[winner].locator('#duel-fire').click();
    await expect(pages[winner].getByRole('dialog',{name:'You win!'})).toBeVisible();
    await expect(pages[loser].getByRole('dialog',{name:'You lose',exact:true})).toBeVisible();
    for(const page of pages){
      await expect(page.locator('#duel-result-okay')).toBeFocused();
      await expect(page.locator('#duel-fire')).toBeDisabled();
    }
    await pages[winner].getByRole('button',{name:'Okay',exact:true}).click();
    await expect(pages[winner].locator('#tank-duel')).toBeHidden();
    await expect(pages[loser].locator('#duel-result')).toBeVisible();
    await pages[loser].getByRole('button',{name:'Okay',exact:true}).click();
    await expect(pages[loser].locator('#tank-duel')).toBeHidden();
    // The completed match releases both players so the other player can invite again.
    await bob.getByRole('button',{name:'Challenge '+names[0]+' to a tank duel'}).click();
    await expect(alice.locator('#duel-accept')).toBeVisible();
    await alice.locator('#duel-accept').click();
    for(const page of pages){
      await expect(page.locator('#duel-game')).toBeVisible();
      await expect(page.locator('#duel-notice')).toBeHidden();
    }
    await bob.locator('#duel-close').click();
    expect(await alice.evaluate(()=>window.estimator.getShared())).toEqual(before);
    expect(errors).toEqual([]);
  }finally{await Promise.all(contexts.map(c=>c.close()));}
});
