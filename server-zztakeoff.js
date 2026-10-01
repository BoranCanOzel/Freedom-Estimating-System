import { randomBytes, createHash } from 'node:crypto';
import { publicUrl } from './client/public-url.js';

const origin='https://www.zztakeoff.com', endpoint=origin+'/mcp';
const fail=(message,status=502)=>Object.assign(new Error(message),{status});

export function zzTransportError(error,stage){
  if(error.status)return error;
  const codes=[];
  const collect=value=>{if(!value)return;if(value.code)codes.push(value.code);if(value.name==='TimeoutError'||value.name==='AbortError')codes.push('REQUEST_TIMEOUT');if(value.cause)collect(value.cause);for(const child of value.errors||[])collect(child);};
  collect(error);
  let reason;
  if(codes.some(code=>['ENOTFOUND','EAI_AGAIN'].includes(code)))reason='The estimating server could not resolve ZZTakeoff\'s address (DNS).';
  else if(codes.some(code=>/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)))reason='The estimating server could not verify ZZTakeoff\'s secure connection (TLS).';
  else if(codes.some(code=>['ECONNREFUSED','ENETUNREACH','EHOSTUNREACH','UND_ERR_CONNECT_TIMEOUT','ETIMEDOUT'].includes(code)))reason='The estimating server could not establish a connection to ZZTakeoff. Check its outbound HTTPS access.';
  else if(codes.some(code=>['REQUEST_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)))reason='ZZTakeoff timed out'+(stage==='reading scope items'?' while waiting for the scope. Keep the linked project open in ZZTakeoff and respond to any connection or read-access prompt.':'.');
  else if(codes.some(code=>['ECONNRESET','UND_ERR_SOCKET','EPIPE'].includes(code)))reason='The connection to ZZTakeoff was interrupted.';
  else reason='The estimating server could not communicate with ZZTakeoff.';
  return fail(`${reason} Failed while ${stage}. Your saved scope is unchanged.`,codes.includes('REQUEST_TIMEOUT')?504:502);
}

async function readMcpResponse(response,id){
  const reader=response.body?.getReader();
  if(!reader)throw fail('ZZTakeoff returned an empty response.');
  const decoder=new TextDecoder(),stream=response.headers.get('content-type')?.includes('text/event-stream');
  let buffer='',size=0;
  try{
    while(true){
      const part=await reader.read();
      buffer+=decoder.decode(part.value||new Uint8Array(),{stream:!part.done});
      size+=part.value?.length||0;
      if(size>12*1024*1024)throw fail('ZZTakeoff response is too large. Your saved scope is unchanged.');
      if(stream){
        buffer=buffer.replace(/\r\n/g,'\n');
        let end;
        while((end=buffer.indexOf('\n\n'))>=0){
          const block=buffer.slice(0,end);buffer=buffer.slice(end+2);
          const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
          if(data){const message=JSON.parse(data);if(message.id===id)return message;}
        }
      }
      if(part.done)break;
    }
    if(!stream){const message=JSON.parse(buffer);if(message.id===id)return message;}
    throw fail('ZZTakeoff closed the response before completing the request. Your saved scope is unchanged.');
  }catch(error){
    if(error instanceof SyntaxError)throw fail('ZZTakeoff returned an unreadable response. Your saved scope is unchanged.');
    throw error;
  }finally{await reader.cancel().catch(()=>{});}
}

export function zzProject(link){
  let url;
  try{url=new URL(/^https?:\/\//i.test(link)?link:'https://'+link);}catch{throw fail('Enter a valid ZZTakeoff project link.',422);}
  if(!['www.zztakeoff.com','zztakeoff.com'].includes(url.hostname)||url.protocol!=='https:'||url.username||url.password||url.port)throw fail('Use the project link from the live ZZTakeoff site.',422);
  const id=url.searchParams.get('projectId')||url.searchParams.get('project');
  if(!id||!/^[a-zA-Z0-9_-]{1,100}$/.test(id))throw fail('Copy the full ZZTakeoff project URL, including its projectId.',422);
  return id;
}

// Use only IDs and evaluated measurement properties; never recalculate geometry or pricing.
export function zzScope(records,projectId){
  const items=[];
  const property=value=>value && typeof value==='object' ? value.formatted ?? value.result ?? value.value : value;
  const measurementKey=/^(quantity|qty|area|length|count|volume|perimeter|wallarea|surfacearea|totalarea|totallength|totalvolume)$/i;
  if(records.some(record=>!record||typeof record!=='object'))throw fail('ZZTakeoff returned an invalid scope item.');
  const byId=new Map(records.map(record=>[record._id,record]));
  const names=new Map(records.map(record=>[record._id,String(property(record.properties?.name)||record.name||'')]));
  for(const record of records){
    if(record.kind==='folder'||record.type==='folder')continue;
    if(typeof record._id!=='string')throw fail('ZZTakeoff returned an item without a source ID. No scope was changed.');
    const properties=record.properties||{}, measurements=[];
    for(const [key,value] of Object.entries(properties)){
      if(!measurementKey.test(key))continue;
      const result=property(value);
      if(result!=null&&typeof result!=='object')measurements.push(`${value?.label||key}: ${result}`);
    }
    const parents=[],seen=new Set([record._id]);let parent=record.parentId;
    while(parent&&!seen.has(parent)){
      seen.add(parent);if(names.get(parent))parents.unshift(names.get(parent));
      parent=byId.get(parent)?.parentId;
    }
    items.push({id:record._id,name:String(property(properties.name)||record.name||'Unnamed item'),measurements:measurements.join('\n'),group:parents.join(' / ')});
  }
  return {source:projectId,fetchedAt:new Date().toISOString(),items};
}

export function scopeScript(projectId){
  // Fixed read-only script. The link cannot inject script or select another user's tab.
  // ZZTakeoff scripts are synchronous; only UI components use await. An IIFE
  // returns the payload as the script's completion value without a top-level return.
  return `(function () {
// getContext() contains drawing state only. Projects.getCurrent() identifies the open project.
const project = Projects.getCurrent();
const projectId = project && project._id;
if (typeof projectId !== 'string' || !projectId) {
  throw new Error('ZZ_SCOPE_CONTEXT: No project is open in the connected ZZTakeoff tab. Open the linked project there, then fetch again.');
}
if (projectId !== ${JSON.stringify(projectId)}) throw new Error('ZZ_SCOPE_PROJECT: The connected ZZTakeoff tab is on project ' + projectId + ', but the saved link is for project ' + ${JSON.stringify(projectId)} + '. Select the matching ZZTakeoff tab or update the saved link.');
const records = []; let skip = 0;
for (let page = 0; page < 100; page++) {
  const result = Takeoffs.list({}, {limit:100, skip});
  if (!Array.isArray(result.records)) throw new Error('ZZTakeoff returned an unsupported takeoff list.');
  records.push(...result.records);
  if (!result.pagination || !result.pagination.more) return {projectId, records};
  if (!(result.pagination.skip > skip)) throw new Error('ZZTakeoff pagination did not advance.');
  skip = result.pagination.skip;
}
throw new Error('This project exceeds the 10,000-item fetch limit. No partial scope was imported.');
})()`;
}

export function scriptTool(tools){
  return tools.map(tool=>{
    const properties=tool.inputSchema?.properties||{};
    const field=['code','script','javascript'].find(name=>properties[name]?.type==='string');
    const required=tool.inputSchema?.required||[];
    return field && /run|execute/i.test(tool.name) && /script|javascript/i.test(tool.name+' '+tool.description) && required.every(name=>name===field)
      ? {name:tool.name,field} : null;
  }).find(Boolean);
}

export function zzScopeError(text){
  // Only expose our own narrow diagnostics, not arbitrary upstream logs or context.
  const message=String(text||'').match(/ZZ_SCOPE_(?:CONTEXT|PROJECT):[^\r\n]{1,1200}/)?.[0];
  return message ? message.replace(/^ZZ_SCOPE_(?:CONTEXT|PROJECT):\s*/, '').replace(/[\u0000-\u001f]/g,' ') : '';
}

export function mountZZTakeoff({app,db,session,fetchImpl=fetch}){
  db.exec(`CREATE TABLE IF NOT EXISTS zztakeoff_connections (
    session_token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE, tokens TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS zztakeoff_clients (origin TEXT PRIMARY KEY, client_id TEXT NOT NULL);`);
  const pending=new Map(),refreshing=new Map(),jobs=new Map();
  const authenticated=(req,res,next)=>{req.zzUser=session(req);return req.zzUser?next():res.status(401).json({error:'Please sign in.'});};
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||502).json({error:error.message});}};
  async function request(url,options={},stage='connecting to ZZTakeoff',timeout=30000){
    const signal=AbortSignal.timeout(timeout);
    try{
      for(let redirects=0;redirects<3;redirects++){
        const response=await fetchImpl(url,{...options,redirect:'manual',signal});
        if(![301,302,303,307,308].includes(response.status))return response;
        const target=new URL(response.headers.get('location')||'',url);
        await response.body?.cancel();
        if(![307,308].includes(response.status)||target.origin!==origin||target.username||target.password||!response.headers.get('location'))throw fail(`ZZTakeoff redirected the request while ${stage}. Its connection endpoint needs checking; your saved scope is unchanged.`);
        url=target.href;
      }
      throw fail('ZZTakeoff redirected the request too many times. Your saved scope is unchanged.');
    }catch(error){throw zzTransportError(error,stage);}
  }
  async function json(url,options){
    const stage=url.endsWith('/oauth/register')?'registering the connection':'authorizing the connection';
    const response=await request(url,options,stage);
    if(!response.ok)throw fail(`ZZTakeoff refused the request while ${stage} (HTTP ${response.status}).`+(response.status===400||response.status===401?' Reconnect ZZTakeoff to continue.':' Try again later; your saved scope is unchanged.'));
    try{return await response.json();}catch(error){if(error instanceof SyntaxError)throw fail('ZZTakeoff returned an unexpected response.');throw zzTransportError(error,stage);}
  }
  function stored(token){const row=db.prepare('SELECT tokens FROM zztakeoff_connections WHERE session_token=?').get(token);return row?JSON.parse(row.tokens):null;}
  function store(token,data){db.prepare('INSERT INTO zztakeoff_connections VALUES (?,?) ON CONFLICT(session_token) DO UPDATE SET tokens=excluded.tokens').run(token,JSON.stringify(data));}
  async function access(token){
    const saved=stored(token);
    if(!saved)throw fail('Connect ZZTakeoff first, then click Fetch from ZZTakeoff.',409);
    if(!saved.expiresAt||saved.expiresAt>Date.now()+60000)return saved.access_token;
    if(!saved.refresh_token)throw fail('Your ZZTakeoff connection expired. Reconnect to continue.',409);
    if(!refreshing.has(token))refreshing.set(token,(async()=>{
      const next=await json(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:saved.refresh_token,client_id:saved.client_id,resource:endpoint})});
      if(!next.access_token)throw fail('Reconnect ZZTakeoff to continue.',409);
      store(token,{...saved,...next,expiresAt:next.expires_in?Date.now()+next.expires_in*1000:null});return next.access_token;
    })().finally(()=>refreshing.delete(token)));
    return refreshing.get(token);
  }
  app.get('/api/zztakeoff/status',authenticated,(req,res)=>res.json({connected:!!stored(req.zzUser.token)}));
  app.post('/api/zztakeoff/connect',authenticated,wrap(async(req,res)=>{
    for(const [state,value] of pending)if(value.expires<Date.now())pending.delete(state);
    if(pending.size>=200)throw fail('Too many pending connections. Try again shortly.',429);
    const localOrigin=new URL(publicUrl('/',req.protocol+'://'+req.get('host'))).origin,redirect=localOrigin+'/api/zztakeoff/callback';
    let clientId=db.prepare('SELECT client_id FROM zztakeoff_clients WHERE origin=?').get(localOrigin)?.client_id;
    if(!clientId){
      const client=await json(origin+'/oauth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_name:'Freedom Estimating',redirect_uris:[redirect],grant_types:['authorization_code','refresh_token'],response_types:['code'],token_endpoint_auth_method:'none'})});
      if(typeof client.client_id!=='string')throw fail('ZZTakeoff did not register the connection.');
      clientId=client.client_id;db.prepare('INSERT OR REPLACE INTO zztakeoff_clients VALUES (?,?)').run(localOrigin,clientId);
    }
    const state=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
    pending.set(state,{session:req.zzUser.token,verifier,redirect,clientId,expires:Date.now()+10*60000});
    const url=new URL(origin+'/oauth/authorize');url.search=new URLSearchParams({response_type:'code',client_id:clientId,redirect_uri:redirect,scope:'mcp',resource:endpoint,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    res.json({url:url.href});
  }));
  app.get('/api/zztakeoff/callback',authenticated,async(req,res)=>{
    let error='';
    try{
      const value=pending.get(req.query.state);
      if(!value||value.expires<Date.now()||value.session!==req.zzUser.token)throw fail('This connection request expired. Return to Scope and reconnect.');
      pending.delete(req.query.state);
      if(req.query.error||typeof req.query.code!=='string')throw fail('ZZTakeoff sign-in was cancelled.');
      const tokens=await json(origin+'/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code:req.query.code,code_verifier:value.verifier,redirect_uri:value.redirect,client_id:value.clientId,resource:endpoint})});
      if(!tokens.access_token)throw fail('ZZTakeoff did not provide a connection token.');
      store(req.zzUser.token,{...tokens,client_id:value.clientId,expiresAt:tokens.expires_in?Date.now()+tokens.expires_in*1000:null});
    }catch(caught){error=caught.message;}
    const data=JSON.stringify({type:'zztakeoff-connected',error}).replace(/</g,'\\u003c');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>ZZTakeoff connection</title><style>body{font:16px/1.6 system-ui;max-width:540px;margin:80px auto;padding:24px;color:#24313c}a{color:#705421}</style><h1>ZZTakeoff connection</h1><p id="message"></p><a href="/">Return to Freedom Estimating</a><script>const result=${data};document.getElementById('message').textContent=result.error||'Connected. Return to the Scope page and click Fetch from ZZTakeoff.';if(window.opener){window.opener.postMessage(result,location.origin);if(!result.error)window.close();}</script>`);
  });
  app.post('/api/zztakeoff/disconnect',authenticated,(req,res)=>{db.prepare('DELETE FROM zztakeoff_connections WHERE session_token=?').run(req.zzUser.token);res.json({connected:false});});

  async function mcp(token,onProgress=()=>{}){
    const bearer=await access(token);let sequence=0,sessionId='',protocol='2025-03-26';
    async function call(method,params,notification=false){
      const id=++sequence;
      const stage=({initialize:'starting the ZZTakeoff session','notifications/initialized':'finishing the ZZTakeoff connection','tools/list':'listing ZZTakeoff capabilities','tools/call':'reading scope items'})[method]||'contacting ZZTakeoff';
      onProgress(stage);
      const response=await request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',Accept:'application/json, text/event-stream','MCP-Protocol-Version':protocol,...(sessionId?{'Mcp-Session-Id':sessionId}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})},stage,notification?30000:120000);
      if(response.status===401)throw fail('Reconnect ZZTakeoff to continue.',409);
      if(!response.ok)throw fail(`ZZTakeoff refused the request while ${stage} (HTTP ${response.status}). `+(response.status===403?'Check that MCP access is enabled for your ZZTakeoff account and workspace.':response.status===429?'ZZTakeoff is limiting requests. Wait a moment before trying again.':'Try again; your saved scope is unchanged.'));
      sessionId=response.headers.get('mcp-session-id')||sessionId;
      if(notification){await response.body?.cancel();return;}
      let result;
      try{result=await readMcpResponse(response,id);}catch(error){throw zzTransportError(error,stage);}
      if(!result||result.error)throw fail(zzScopeError(result?.error?.message)||'ZZTakeoff could not run the read request. Check the connected project and your permissions.');
      return result.result;
    }
    const init=await call('initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'Freedom Estimating',version:'1.0'}});
    protocol=init.protocolVersion||protocol;await call('notifications/initialized',{},true);
    return call;
  }
  async function fetchScope(token,link,onProgress){
    const projectId=zzProject(link),call=await mcp(token,onProgress);
    const tools=[];let cursor;
    for(let page=0;page<20;page++){const result=await call('tools/list',cursor?{cursor}:{});tools.push(...(result.tools||[]));cursor=result.nextCursor;if(!cursor)break;}
    const runner=scriptTool(tools);
    if(!runner)throw fail('ZZTakeoff is connected, but its available tools need an integration update before scope can be fetched. Your saved scope is unchanged.',409);
    const result=await call('tools/call',{name:runner.name,arguments:{[runner.field]:scopeScript(projectId)}});
    if(result.isError)throw fail(zzScopeError((result.content||[]).filter(block=>block.type==='text').map(block=>block.text).join('\n'))||'ZZTakeoff could not read the linked project. Open it in your connected ZZTakeoff tab and allow read access, then try again.');
    let data=result.structuredContent;
    if(!data?.records)for(const content of result.content||[])if(content.type==='text'){try{const parsed=JSON.parse(content.text);if(parsed.records){data=parsed;break;}}catch{}}
    if(data?.projectId!==projectId||!Array.isArray(data.records)||data.records.length>10000)throw fail('ZZTakeoff returned an unsupported scope response. No saved items were changed.');
    return zzScope(data.records,projectId);
  }
  app.post('/api/zztakeoff/scope',authenticated,wrap(async(req,res)=>res.json(await fetchScope(req.zzUser.token,String(req.body?.link||'')))));

  const pruneJobs=()=>{for(const [id,job] of jobs)if(job.expires<Date.now())jobs.delete(id);};
  // Return immediately; polling keeps proxy timeouts independent of ZZTakeoff's browser prompts.
  app.post('/api/zztakeoff/scope/jobs',authenticated,wrap(async(req,res)=>{
    pruneJobs();
    const link=String(req.body?.link||'');zzProject(link);
    if(!stored(req.zzUser.token))throw fail('Connect ZZTakeoff first, then click Fetch from ZZTakeoff.',409);
    for(const [id,job] of jobs)if(job.session===req.zzUser.token&&job.state==='pending'){
      if(job.link!==link)throw fail('A ZZTakeoff fetch is already in progress. Wait for it to finish before fetching another project.',409);
      return res.status(202).json({id,state:job.state,stage:job.stage});
    }
    if(jobs.size>=200)throw fail('Too many ZZTakeoff fetches are pending. Try again shortly.',429);
    const id=randomBytes(24).toString('hex'),job={session:req.zzUser.token,link,state:'pending',stage:'connecting to ZZTakeoff',expires:Date.now()+10*60000};
    jobs.set(id,job);
    res.status(202).json({id,state:job.state,stage:job.stage});
    fetchScope(job.session,link,stage=>{job.stage=stage;}).then(result=>{job.result=result;job.state='complete';},error=>{job.error=error.message;job.state='failed';});
  }));
  app.get('/api/zztakeoff/scope/jobs/:id',authenticated,(req,res)=>{
    pruneJobs();const job=jobs.get(req.params.id);
    if(!job||job.session!==req.zzUser.token)return res.status(404).json({error:'This fetch expired or the estimating server restarted. Fetch again; your saved scope is unchanged.'});
    res.json({state:job.state,stage:job.stage,...(job.state==='complete'?{result:job.result}:job.state==='failed'?{error:job.error}:{})});
  });
}
