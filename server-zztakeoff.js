import { randomBytes, createHash } from 'node:crypto';
import { publicUrl } from './client/public-url.js';

const origin='https://www.zztakeoff.com', endpoint=origin+'/mcp';
const fail=(message,status=502)=>Object.assign(new Error(message),{status});

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
  return `const context = await getContext();
const projectId = context.projectId || (context.project && (context.project._id || context.project.id));
if (projectId !== ${JSON.stringify(projectId)}) throw new Error('Open the linked project in your connected ZZTakeoff tab, then fetch again.');
const records = []; let skip = 0;
for (let page = 0; page < 100; page++) {
  const result = await Takeoffs.list({}, {limit:100, skip});
  if (!Array.isArray(result.records)) throw new Error('ZZTakeoff returned an unsupported takeoff list.');
  records.push(...result.records);
  if (!result.pagination || !result.pagination.more) return {projectId, records};
  if (!(result.pagination.skip > skip)) throw new Error('ZZTakeoff pagination did not advance.');
  skip = result.pagination.skip;
}
throw new Error('This project exceeds the 10,000-item fetch limit. No partial scope was imported.');`;
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

export function mountZZTakeoff({app,db,session,fetchImpl=fetch}){
  db.exec(`CREATE TABLE IF NOT EXISTS zztakeoff_connections (
    session_token TEXT PRIMARY KEY REFERENCES sessions(token) ON DELETE CASCADE, tokens TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS zztakeoff_clients (origin TEXT PRIMARY KEY, client_id TEXT NOT NULL);`);
  const pending=new Map(),refreshing=new Map();
  const authenticated=(req,res,next)=>{req.zzUser=session(req);return req.zzUser?next():res.status(401).json({error:'Please sign in.'});};
  const wrap=fn=>async(req,res)=>{try{await fn(req,res);}catch(error){res.status(error.status||502).json({error:error.message});}};
  async function request(url,options={}){
    try{return await fetchImpl(url,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});}
    catch{throw fail('ZZTakeoff could not be reached. Try again; your saved scope is unchanged.');}
  }
  async function json(url,options){
    const response=await request(url,options);
    if(!response.ok)throw fail('ZZTakeoff could not complete the connection. Reconnect and try again.');
    try{return await response.json();}catch{throw fail('ZZTakeoff returned an unexpected response.');}
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

  async function mcp(token){
    const bearer=await access(token);let sequence=0,sessionId='',protocol='2025-03-26';
    async function call(method,params,notification=false){
      const id=++sequence;
      const response=await request(endpoint,{method:'POST',headers:{Authorization:'Bearer '+bearer,'Content-Type':'application/json',Accept:'application/json, text/event-stream',...(sessionId?{'Mcp-Session-Id':sessionId,'MCP-Protocol-Version':protocol}:{})},body:JSON.stringify({jsonrpc:'2.0',...(notification?{}:{id}),method,params})});
      if(response.status===401)throw fail('Reconnect ZZTakeoff to continue.',409);
      if(!response.ok)throw fail('ZZTakeoff could not fetch the scope. Check that its project is open and MCP access is enabled.');
      sessionId=response.headers.get('mcp-session-id')||sessionId;
      if(notification){await response.body?.cancel();return;}
      let result;
      if(response.headers.get('content-type')?.includes('text/event-stream')){
        const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',size=0;
        try{while(!result){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>12*1024*1024)throw fail('ZZTakeoff response is too large.');buffer+=decoder.decode(part.value,{stream:true}).replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){const block=buffer.slice(0,end);buffer=buffer.slice(end+2);const data=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trim()).join('\n');if(data){const message=JSON.parse(data);if(message.id===id)result=message;}}}}finally{await reader.cancel();}
      }else result=await response.json();
      if(!result||result.error)throw fail('ZZTakeoff could not run the read request. Check the connected project and your permissions.');
      return result.result;
    }
    const init=await call('initialize',{protocolVersion:protocol,capabilities:{},clientInfo:{name:'Freedom Estimating',version:'1.0'}});
    protocol=init.protocolVersion||protocol;await call('notifications/initialized',{},true);
    return call;
  }
  app.post('/api/zztakeoff/scope',authenticated,wrap(async(req,res)=>{
    const projectId=zzProject(String(req.body?.link||'')),call=await mcp(req.zzUser.token);
    const tools=[];let cursor;
    for(let page=0;page<20;page++){const result=await call('tools/list',cursor?{cursor}:{});tools.push(...(result.tools||[]));cursor=result.nextCursor;if(!cursor)break;}
    const runner=scriptTool(tools);
    if(!runner)throw fail('ZZTakeoff is connected, but its available tools need an integration update before scope can be fetched. Your saved scope is unchanged.',409);
    const result=await call('tools/call',{name:runner.name,arguments:{[runner.field]:scopeScript(projectId)}});
    if(result.isError)throw fail('ZZTakeoff could not read the linked project. Open it in your connected ZZTakeoff tab and allow read access, then try again.');
    let data=result.structuredContent;
    if(!data?.records)for(const content of result.content||[])if(content.type==='text'){try{const parsed=JSON.parse(content.text);if(parsed.records){data=parsed;break;}}catch{}}
    if(data?.projectId!==projectId||!Array.isArray(data.records)||data.records.length>10000)throw fail('ZZTakeoff returned an unsupported scope response. No saved items were changed.');
    res.json(zzScope(data.records,projectId));
  }));
}
