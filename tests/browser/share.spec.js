import {test,expect} from '@playwright/test';
test('guests view all pages, save edits, and see conflicts without a login',async({browser,request})=>{
 await request.post('/api/login',{data:{name:'Share browser',password:'1313'}});
 const sheet=id=>({id,title:'Scope '+id,fees:[{id:'f'+id,label:'Sales',pct:3}],units:[],rows:[{id:'r'+id,kind:'labor',name:'Crew',count:1,time:8,days:1,cost:50,markup:0}]});
 const takeoff={id:'t',name:'Shared estimate',sheets:[sheet('a'),sheet('b')]};
 const created=await(await request.post('/api/projects',{data:{name:'Share test',book:{lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[takeoff]}]}]}]}}})).json();
 const admin='/api/projects/'+created.id+'/share-links';
 const grant=async permission=>(await(await request.post(admin,{data:{list:'l',takeoff:'t',permission}})).json());
 const read=await grant('read'),write=await grant('write');
 const ctx=await browser.newContext(),page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto('http://127.0.0.1:3100'+read.path);await expect(page.locator('#shared-status')).toHaveText('Latest version loaded.');
  await expect(page.locator('#title')).toHaveValue('Scope a');await expect(page.locator('#title')).toHaveAttribute('readonly','');
  await expect(page.locator('#shared-save')).toBeHidden();await page.locator('#shared-page').selectOption('b');await expect(page.locator('#title')).toHaveValue('Scope b');
  await page.goto('http://127.0.0.1:3100'+write.path);await expect(page.locator('#shared-permission')).toHaveText('View and edit');await expect(page.locator('#shared-status')).toHaveText('Latest version loaded.');
  await page.locator('#title').fill('Guest scope');await page.locator('#title').blur();await expect(page.locator('#shared-save')).toBeEnabled();await page.locator('#shared-save').click();await expect(page.locator('#shared-status')).toHaveText('Changes saved.');
  await page.reload();await expect(page.locator('#title')).toHaveValue('Guest scope');
  const headers={Authorization:'Bearer '+write.path.split('#')[1]};const remote=await(await request.get('/api/shared-takeoff',{headers})).json();remote.takeoff.name='Owner updated';await request.put('/api/shared-takeoff',{headers,data:{revision:remote.revision,takeoff:remote.takeoff}});
  await page.locator('#title').fill('Conflicting draft');await page.locator('#title').blur();await page.locator('#shared-save').click();await expect(page.locator('#shared-status')).toContainText('changed since you loaded');await expect(page.locator('#title')).toHaveValue('Conflicting draft');
  await request.delete(admin+'/'+write.id);page.once('dialog',d=>d.accept());await page.locator('#shared-reload').click();await expect(page.locator('#shared-status')).toContainText('revoked');
  expect(errors).toEqual([]);
 }finally{await ctx.close();}
});
