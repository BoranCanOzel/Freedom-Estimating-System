import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { Script } from 'node:vm';
import { createApp } from '../server.js';

test('ZZTakeoff OAuth is session bound and fetch only invokes the fixed read script',async()=>{
  let challenge,called=false,hold=false,release,arrived,simulateError=false,stream=false,redirect=false;
  const zzFetch=async(url,options)=>{
    if(url.endsWith('/oauth/register'))return Response.json({client_id:'test-client'});
    if(url.endsWith('/oauth/token')){
      assert.equal(createHash('sha256').update(options.body.get('code_verifier')).digest('base64url'),challenge);
      return Response.json({access_token:'private-test-token',expires_in:3600});
    }
    assert.ok(['https://www.zztakeoff.com/mcp','https://www.zztakeoff.com/mcp/'].includes(url));
    assert.equal(options.headers.Authorization,'Bearer private-test-token');
    const request=JSON.parse(options.body);let result;
    if(simulateError)throw new DOMException('Timed out','TimeoutError');
    if(redirect&&request.method==='initialize'&&url.endsWith('/mcp'))return new Response(null,{status:307,headers:{location:'/mcp/'}});
    if(request.method==='initialize')result={protocolVersion:'2025-03-26'};
    else if(request.method==='notifications/initialized')return new Response(null,{status:202});
    else if(request.method==='tools/list')result={tools:[{name:'run_script',description:'Run a ZZTakeoff script',inputSchema:{properties:{code:{type:'string'}},required:['code']}}]};
    else{
      assert.equal(request.method,'tools/call');assert.equal(request.params.name,'run_script');
      assert.match(request.params.arguments.code,/projectId !== "source"/);assert.doesNotMatch(request.params.arguments.code,/\.update\(/);
      if(hold){arrived?.();await new Promise(resolve=>{release=resolve;});}
      const payload=new Script('(function () {\n'+request.params.arguments.code+'\n})()').runInNewContext({
        Projects:{getCurrent:()=>({_id:'source'})},
        Takeoffs:{list:()=>({records:[{_id:'one',properties:{name:{value:'Slab'},area:{formatted:'160 SF'}}}],pagination:{more:false}})}
      },{timeout:1000});
      called=true;result={isError:false,content:[{type:'text',text:'Script completed successfully.\nResult: '+payload+'\nElapsed: 12ms'}]};
    }
    if(stream){
      const data=': ping\r\n\r\ndata: '+JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\r\n\r\n';
      const encoded=new TextEncoder().encode(data);let index=0;
      return new Response(new ReadableStream({pull(controller){if(index<encoded.length)controller.enqueue(encoded.slice(index,index+=1));else controller.close();}}),{headers:{'content-type':'text/event-stream'}});
    }
    return Response.json({jsonrpc:'2.0',id:request.id,result},{headers:{'mcp-session-id':'test-session'}});
  };
  const app=createApp({dataDir:await mkdtemp(join(tmpdir(),'freedom-zz-')),production:false,zzFetch});
  app.server.listen(0,'127.0.0.1');await once(app.server,'listening');
  const base='http://127.0.0.1:'+app.server.address().port;
  try{
    const login=async name=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,password:'1313'})});return response.headers.get('set-cookie').split(';')[0];};
    const cookie=await login('Scope tester'),other=await login('Other tester');
    const call=(path,body,who=cookie)=>fetch(base+'/api/zztakeoff/'+path,{method:body===undefined?'GET':'POST',headers:{cookie:who,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
    assert.equal((await fetch(base+'/api/zztakeoff/status')).status,401);
    assert.equal((await call('scope',{link:'https://www.zztakeoff.com/app/takeoff?projectId=source'})).status,409);
    const start=await (await call('connect',{})).json(),auth=new URL(start.url);
    challenge=auth.searchParams.get('code_challenge');
    const callback='callback?state='+auth.searchParams.get('state')+'&code=test-code';
    assert.match(await (await call(callback,undefined,other)).text(),/expired/);
    const complete=await (await call(callback)).text();assert.match(complete,/zztakeoff-connected/);assert.doesNotMatch(complete,/private-test-token/);
    assert.deepEqual(await (await call('status')).json(),{connected:true});
    assert.deepEqual(await (await call('status',undefined,other)).json(),{connected:false});
    const scope=await (await call('scope',{link:'https://www.zztakeoff.com/app/takeoff?projectId=source'})).json();
    assert.equal(scope.items[0].measurements,'area: 160 SF');assert.equal(called,true);
    hold=true;stream=true;redirect=true;
    const started=new Promise(resolve=>{arrived=resolve;});
    const pendingResponse=await call('scope/jobs',{link:'https://www.zztakeoff.com/app/takeoff?projectId=source'});
    assert.equal(pendingResponse.status,202);
    const job=await pendingResponse.json();await started;
    assert.equal((await (await call('scope/jobs/'+job.id)).json()).state,'pending');
    assert.equal((await call('scope/jobs/'+job.id,undefined,other)).status,404);
    assert.equal((await call('scope/jobs',{link:'https://www.zztakeoff.com/app/takeoff?projectId=different'})).status,409);
    release();hold=false;
    let result;
    for(let i=0;i<30;i++){result=await (await call('scope/jobs/'+job.id)).json();if(result.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(result.state,'complete');assert.equal(result.result.items[0].measurements,'area: 160 SF');
    simulateError=true;
    const failedJob=await (await call('scope/jobs',{link:'https://www.zztakeoff.com/app/takeoff?projectId=source'})).json();
    for(let i=0;i<30;i++){result=await (await call('scope/jobs/'+failedJob.id)).json();if(result.state!=='pending')break;await new Promise(resolve=>setTimeout(resolve,5));}
    assert.equal(result.state,'failed');assert.match(result.error,/timed out.*starting the ZZTakeoff session/);
    assert.equal(result.result,undefined);
    simulateError=false;
    assert.match(await (await call(callback)).text(),/expired/);
    assert.equal((await call('scope',{link:'https://elsewhere.example/?projectId=source'})).status,422);
    await call('disconnect',{});assert.deepEqual(await (await call('status')).json(),{connected:false});
  }finally{await app.close();}
});
