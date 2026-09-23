import { test, expect } from '@playwright/test';
import { scryptSync } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createApp } from '../../server.js';

for (const shipped of [false,true]) test(`${shipped ? 'Shipped' : 'Custom'} website password hides the estimator until sign-in and after sign-out`,async({page})=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-browser-auth-'));
  const salt='0123456789abcdef0123456789abcdef', password=shipped ? '1313' : 'browser-test-password';
  const sitePasswordHash='scrypt:'+salt+':'+scryptSync(password,salt,32).toString('hex');
  const app=createApp({dataDir,...(shipped ? {} : {sitePasswordHash}),users:{},production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try {
    await page.goto(base);
    await expect(page.locator('#sheetCard')).toHaveCount(0);
    await expect(page.locator('#server-login-password')).toBeVisible();
    await page.locator('#server-login-name').fill('Password tester');
    await page.locator('#server-login-password').fill('wrong');
    await page.locator('#server-login-form button').click();
    await expect(page.locator('#server-login-error')).toContainText('Incorrect');
    await expect(page.locator('#sheetCard')).toHaveCount(0);
    expect((await page.request.get(base+'/api/projects')).status()).toBe(401);
    expect((await page.request.get(base+'/assets/app.js')).status()).toBe(401);
    await page.locator('#server-login-password').fill(password);
    await page.locator('#server-login-form button').click();
    await expect(page.locator('#server-login')).not.toBeVisible();
    await expect(page.locator('#server-signout')).toBeVisible();
    expect((await page.request.get(base+'/api/projects')).status()).toBe(200);
    await page.locator('#server-signout').click();
    await expect(page.locator('#server-login-password')).toBeVisible();
    await expect(page.locator('#sheetCard')).toHaveCount(0);
    expect((await page.request.get(base+'/api/projects')).status()).toBe(401);
  } finally {await app.close();await rm(dataDir,{recursive:true,force:true});}
});
