import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import {WebSocket} from 'ws';
import * as Y from 'yjs';
import {createApp} from '../server.js';
import {readBook,writeBook} from '../shared/model.js';

test('workbooks above 25 MB import, synchronize and save through shared and AI access',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'freedom-large-workbook-'));
  const app=createApp({dataDir,production:false});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  const doc=new Y.Doc();let socket;
  try{
    const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Large workbook test',password:'1313'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const call=(path,method='GET',body,key)=>fetch(base+path,{method,headers:{'Content-Type':'application/json',...(key?{Authorization:'Bearer '+key}:{cookie})},body:body===undefined?undefined:JSON.stringify(body)});
    // A large attachment exercises actual byte limits without hundreds of
    // thousands of estimate rows or dependence on production customer data.
    const book={attachment:'x'.repeat(27*1024*1024),lists:[{id:'l',companies:[{id:'c',projects:[{id:'p',takeoffs:[{id:'t',name:'Large takeoff',sheets:[{id:'s',title:'Scope',rows:[]}]}]}]}]}]};
    const created=await call('/api/projects','POST',{name:'Large workbook',book});
    assert.equal(created.status,201);const project=await created.json();
    socket=new WebSocket(base.replace('http','ws')+'/live/'+project.id,{headers:{cookie}});
    const initial=JSON.parse((await once(socket,'message'))[0]);
    assert.equal(initial.type,'sync');Y.applyUpdate(doc,Buffer.from(initial.state,'base64'));
    const before=readBook(doc),next=structuredClone(before);
    next.lists[0].companies[0].projects[0].takeoffs[0].name='WebSocket saved';
    writeBook(doc,before,next);
    const upload=JSON.stringify({type:'update',seq:1,update:Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64')});
    assert.ok(Buffer.byteLength(upload)>35*1024*1024,'Exercise the old WebSocket frame limit too');
    const acknowledged=new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(Error('Large workbook save timed out')),20000);
      socket.on('message',bytes=>{const message=JSON.parse(bytes);if(['ack','error'].includes(message.type)){clearTimeout(timer);resolve(message);}});
    });
    socket.send(upload);assert.deepEqual(await acknowledged,{type:'ack',seq:1});
    const closed=once(socket,'close');socket.close();await closed;

    const grant=await (await call('/api/projects/'+project.id+'/share-links','POST',{list:'l',takeoff:'t',permission:'write'})).json();
    const shareKey=grant.path.split('#')[1];
    const shared=await (await call('/api/shared-takeoff','GET',undefined,shareKey)).json();
    assert.equal(shared.takeoff.name,'WebSocket saved');shared.takeoff.name='Shared link saved';
    assert.equal((await call('/api/shared-takeoff','PUT',{takeoff:shared.takeoff,revision:shared.revision},shareKey)).status,200);

    const ai=await (await call('/api/projects/'+project.id+'/ai-access','POST',{list:'l',takeoff:'t'})).json();
    const current=await (await call('/api/ai/v1/takeoff','GET',undefined,ai.key)).json();
    assert.equal(current.takeoff.name,'Shared link saved');current.takeoff.name='AI saved';
    assert.equal((await call('/api/ai/v1/save','POST',{takeoff:current.takeoff,revision:current.revision,requestId:'large-save'},ai.key)).status,200);

    // Check persisted bytes, not just successful HTTP responses.
    const db=new DatabaseSync(join(dataDir,'projects.sqlite'),{readOnly:true});
    const state=db.prepare('SELECT state FROM projects WHERE id=?').get(project.id).state;db.close();
    assert.ok(state.length>25*1024*1024);
    const saved=new Y.Doc();
    try{
      Y.applyUpdate(saved,state);const restored=readBook(saved);
      assert.equal(restored.attachment,book.attachment);
      assert.equal(restored.lists[0].companies[0].projects[0].takeoffs[0].name,'AI saved');
    }finally{saved.destroy();}
  }finally{socket?.terminate();doc.destroy();await app.close();}
});
