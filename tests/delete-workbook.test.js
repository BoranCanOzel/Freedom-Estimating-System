import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {WebSocket} from 'ws';
import {createApp} from '../server.js';

test('deletion requires exact confirmation, disconnects clients and prevents reopening',async()=>{
 const dataDir=await mkdtemp(join(tmpdir(),'delete-workbook-'));
 const app=createApp({dataDir,users:{},production:false});
 app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
 const base='http://127.0.0.1:'+app.server.address().port;
 let socket;
 try{
  const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Deletion test',password:'1313'})});
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const req=(path,method='GET',body)=>fetch(base+path,{method,headers:{cookie,'Content-Type':'application/json'},body:body&&JSON.stringify(body)});
  const created=await (await req('/api/projects','POST',{name:'Delete me',book:{sheets:[]}})).json();
  await req('/api/projects/'+created.id+'/open','POST');
  for(const confirmation of ['', 'delete',' DELETE','DELETE '])assert.equal((await req('/api/projects/'+created.id,'DELETE',{confirmation})).status,400);
  assert.equal((await req('/api/projects/'+created.id+'/export')).status,200);
  socket=new WebSocket(base.replace('http','ws')+'/live/'+created.id,{headers:{cookie}});await once(socket,'open');
  const closed=once(socket,'close');
  assert.equal((await req('/api/projects/'+created.id,'DELETE',{confirmation:'DELETE'})).status,200);
  assert.equal((await closed)[0],4004);
  assert.equal((await req('/api/projects/'+created.id+'/open','POST')).status,404);
  assert.equal((await req('/api/projects/'+created.id+'/export')).status,404);
  assert.equal((await (await req('/api/projects')).json()).length,0);
 }finally{socket?.terminate();await app.close();await rm(dataDir,{recursive:true,force:true});}
});
