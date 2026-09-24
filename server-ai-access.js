import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { readBook, writeBook, validateBook } from './shared/model.js';
import { locateTakeoff, findTakeoff, revision, validateTakeoff, differences, takeoffSchema, changeSchema } from './shared/ai-takeoff.js';

const instructions=readFileSync(new URL('./docs/ai-takeoff.md',import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function mountAiAccess({app,db,session,project,rooms,snapshot,authChanged}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_grants (
    id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, workbook TEXT NOT NULL REFERENCES projects(id), scope TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER, request_id TEXT, request_hash TEXT, receipt TEXT);
    CREATE TABLE IF NOT EXISTS ai_changes (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, workbook TEXT NOT NULL, scope TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, before_json TEXT NOT NULL, after_revision TEXT NOT NULL, summary TEXT NOT NULL, undone_at INTEGER);`);
  if(authChanged)db.prepare('UPDATE ai_grants SET revoked=1 WHERE revoked=0 AND used_at IS NULL').run();
  const route=fn=>(req,res)=>{try{fn(req,res);}catch(error){res.status(error.status||422).json({error:error.message});}};
  function signed(req){const user=session(req);if(!user)fail(401,'Please sign in.');return user;}
  function source(workbook){
    const row=project(workbook);if(!row)fail(404,'Workbook no longer exists.');
    const live=rooms.get(workbook)?.doc;
    if(live)return {book:readBook(live),encoded:Y.encodeStateAsUpdate(live)};
    const doc=new Y.Doc();try{Y.applyUpdate(doc,row.state);return {book:readBook(doc),encoded:row.state};}finally{doc.destroy();}
  }
  function target(grant){const data=source(grant.workbook),scope=JSON.parse(grant.scope),takeoff=findTakeoff(data.book,scope);if(!takeoff)fail(404,'The authorized takeoff no longer exists.');return {...data,scope,takeoff};}
  function grantFor(req){
    const key=/^Bearer ([a-f0-9]{64})$/i.exec(req.headers.authorization||'')?.[1];
    const grant=key&&db.prepare('SELECT * FROM ai_grants WHERE key_hash=?').get(hash(key));
    if(!grant)fail(401,'A valid takeoff access key is required.');
    if(grant.revoked)fail(403,'Takeoff access was revoked.');
    if(Date.now()>=grant.expires_at)fail(410,'Takeoff access expired.');
    return grant;
  }
  function unused(grant){if(grant.used_at)fail(410,'The one permitted save has already been used.');}
  function prepare(grant,payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(422,'Send revision and takeoff.');
    if(Object.keys(payload).some(key=>!['revision','takeoff','requestId'].includes(key)))fail(422,'Only revision, takeoff, and requestId are accepted.');
    const data=target(grant);
    if(payload.revision!==revision(data.takeoff))fail(409,'This takeoff changed. Read it again before saving.');
    if(Buffer.byteLength(JSON.stringify(payload.takeoff||{}))>2*1024*1024)fail(413,'Takeoff exceeds the 2 MB AI editing limit.');
    validateTakeoff(payload.takeoff,data.takeoff);
    const next=structuredClone(data.book),current=findTakeoff(next,data.scope);
    Object.keys(current).forEach(key=>delete current[key]);Object.assign(current,payload.takeoff);
    validateBook(next);
    return {...data,next,summary:differences(data.takeoff,payload.takeoff)};
  }
  function commit(workbook,data,actor,transaction){
    const doc=new Y.Doc();
    try{
      Y.applyUpdate(doc,data.encoded);const vector=Y.encodeStateVector(doc);
      writeBook(doc,data.book,data.next,'ai');
      const applied=findTakeoff(readBook(doc),data.scope),expected=findTakeoff(data.next,data.scope);
      if(revision(applied)!==revision(expected))fail(422,'The supplied JSON contains a structure that cannot be saved.');
      const update=Y.encodeStateAsUpdate(doc,vector),state=Buffer.from(Y.encodeStateAsUpdate(doc));
      if(state.length>25*1024*1024)fail(413,'Workbook exceeds the storage limit.');
      db.exec('BEGIN IMMEDIATE');
      try{transaction();db.prepare('UPDATE projects SET state=?,modified_at=?,modified_by=? WHERE id=?').run(state,new Date().toISOString(),actor,workbook);db.exec('COMMIT');}
      catch(error){db.exec('ROLLBACK');throw error;}
      const room=rooms.get(workbook);
      if(room){Y.applyUpdate(room.doc,update,'ai');for(const ws of room.clients)if(ws.readyState===1)ws.send(JSON.stringify({type:'update',update:Buffer.from(update).toString('base64')}));}
      try{snapshot(workbook);}catch{console.error('AI edit saved; filesystem snapshot could not be written.');}
    }finally{doc.destroy();}
  }
  function execute(grant,name,payload={}){
    if(name==='get_instructions'){unused(grant);return {instructions,schema:takeoffSchema,changeSchema};}
    if(name==='read_takeoff'){unused(grant);const {takeoff}=target(grant);return {takeoff,revision:revision(takeoff),expiresAt:new Date(grant.expires_at).toISOString()};}
    if(!['validate_changes','save_takeoff'].includes(name))fail(404,'Unknown takeoff operation.');
    if(name==='save_takeoff' && grant.used_at && payload.requestId===grant.request_id && hash(JSON.stringify(payload))===grant.request_hash)return JSON.parse(grant.receipt);
    unused(grant);const data=prepare(grant,payload);
    if(name==='validate_changes')return {valid:true,revision:payload.revision,changes:data.summary,previewLimit:200};
    if(typeof payload.requestId!=='string'||!payload.requestId.length||payload.requestId.length>100)fail(422,'Provide a unique requestId, up to 100 characters.');
    if(!data.summary.length)fail(422,'No changes to save. Access remains available.');
    const id=randomUUID(),time=Date.now(),after=revision(payload.takeoff);
    const receipt={saved:true,changeId:id,revision:after,changes:data.summary,accessConsumed:true};
    commit(grant.workbook,data,'AI via '+grant.created_by,()=>{
      const result=db.prepare('UPDATE ai_grants SET used_at=?,request_id=?,request_hash=?,receipt=? WHERE id=? AND used_at IS NULL AND revoked=0 AND expires_at>?').run(time,payload.requestId,hash(JSON.stringify(payload)),JSON.stringify(receipt),grant.id,time);
      if(result.changes!==1)fail(409,'Access was consumed or revoked.');
      db.prepare('INSERT INTO ai_changes VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(id,grant.id,grant.workbook,grant.scope,grant.created_by,time,JSON.stringify(data.takeoff),after,JSON.stringify(data.summary));
    });return receipt;
  }
  const base='/api/ai/v1';
  app.use(base,(req,res,next)=>{res.set('Cache-Control','no-store');if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Cross-origin request refused.'});}catch{return res.status(403).json({error:'Invalid origin.'});}}next();});
  for(const [method,path,name]of [['get','instructions','get_instructions'],['get','takeoff','read_takeoff'],['post','validate','validate_changes'],['post','save','save_takeoff']])app[method](base+'/'+path,route((req,res)=>res.json(execute(grantFor(req),name,req.body))));
  const tools=[['get_instructions','Read JSON editing instructions and schema.',false],['read_takeoff','Read only the authorized takeoff and its revision.',false],['validate_changes','Validate proposed takeoff JSON and preview changes without saving.',false],['save_takeoff','Apply one takeoff edit, consuming this key. Requires the revision you read and a unique requestId.',true]].map(([name,description,write])=>({name,description,inputSchema:name==='save_takeoff'?{...changeSchema,required:['revision','takeoff','requestId']}:name==='validate_changes'?changeSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false}}));
  // Stateless Streamable HTTP, compatible with the 2025-11-25 MCP handshake.
  app.get(base+'/mcp',route((req,res)=>{grantFor(req);res.set('Allow','POST').sendStatus(405);}));
  app.post(base+'/mcp',route((req,res)=>{
    const grant=grantFor(req),msg=req.body;
    const versions=['2025-03-26','2025-06-18','2025-11-25'];
    if(req.headers['mcp-protocol-version']&&!versions.includes(req.headers['mcp-protocol-version']))return res.status(400).json({error:'Unsupported MCP version. Negotiate a supported version using initialize.'});
    if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}});
    if(msg.id===undefined)return res.sendStatus(202);
    const respond=result=>res.json({jsonrpc:'2.0',id:msg.id,result});
    if(msg.method==='initialize')return respond({protocolVersion:versions.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'freedom-takeoff',version:'1.0.0'},instructions:'Read get_instructions before editing. Access is limited to one takeoff and one save.'});
    if(msg.method==='ping')return respond({});
    if(msg.method==='tools/list')return respond({tools});
    if(msg.method!=='tools/call')return res.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found.'}});
    try{return respond({content:[{type:'text',text:JSON.stringify(execute(grant,msg.params?.name,msg.params?.arguments))}]});}
    catch(error){return respond({isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,status:error.status||422})}]});}
  }));
  app.get(base+'/openapi.json',(req,res)=>{
    const paths={};
    for(const [path,method,name] of [['/instructions','get','get_instructions'],['/takeoff','get','read_takeoff'],['/validate','post','validate_changes'],['/save','post','save_takeoff']]) {
      const tool=tools.find(t=>t.name===name);
      paths[path]={[method]:{operationId:name,summary:tool.description,
        ...(method==='post'?{requestBody:{required:true,content:{'application/json':{schema:tool.inputSchema}}}}:{}),
        responses:{200:{description:'Operation result',content:{'application/json':{schema:{type:'object'}}}}}}};
    }
    res.json({openapi:'3.1.0',info:{title:'Freedom one-takeoff editing',version:'1.0.0'},servers:[{url:req.protocol+'://'+req.get('host')+base}],security:[{takeoffKey:[]}],components:{securitySchemes:{takeoffKey:{type:'http',scheme:'bearer'}}},paths});
  });
  const admin='/api/projects/:id/ai-access';
  app.post(admin,route((req,res)=>{
    const user=signed(req),data=source(req.params.id),scope=locateTakeoff(data.book,req.body?.list,req.body?.takeoff);
    if(!scope)fail(404,'Takeoff not found.');
    const key=randomBytes(32).toString('hex'),id=randomUUID(),time=Date.now(),expires=time+30*60*1000,scopeText=JSON.stringify(scope);
    db.prepare('INSERT INTO ai_grants(id,key_hash,workbook,scope,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,?)').run(id,hash(key),req.params.id,scopeText,user.name,time,expires);
    res.status(201).json({id,key,expiresAt:new Date(expires).toISOString(),takeoffName:findTakeoff(data.book,scope).name,endpoint:base,mcp:base+'/mcp',instructions:base+'/instructions',openapi:base+'/openapi.json'});
  }));
  app.get(admin,route((req,res)=>{
    signed(req);const data=source(req.params.id),scope=locateTakeoff(data.book,req.query.list,req.query.takeoff);if(!scope)fail(404,'Takeoff not found.');
    const scopeText=JSON.stringify(scope);
    const grants=db.prepare('SELECT id,created_by,created_at,expires_at,revoked,used_at FROM ai_grants WHERE workbook=? AND scope=? ORDER BY created_at DESC LIMIT 30').all(req.params.id,scopeText);
    const current=revision(findTakeoff(data.book,scope));
    const changes=db.prepare('SELECT id,created_by,created_at,summary,after_revision,undone_at FROM ai_changes WHERE workbook=? AND scope=? ORDER BY created_at DESC LIMIT 30').all(req.params.id,scopeText).map(c=>({...c,summary:JSON.parse(c.summary),canUndo:!c.undone_at&&current===c.after_revision}));
    res.json({grants,changes});
  }));
  app.delete(admin+'/:grant',route((req,res)=>{signed(req);const result=db.prepare('UPDATE ai_grants SET revoked=1 WHERE id=? AND workbook=?').run(req.params.grant,req.params.id);if(!result.changes)fail(404,'Access not found.');res.json({revoked:true});}));
  app.post(admin+'/changes/:change/undo',route((req,res)=>{
    const user=signed(req),change=db.prepare('SELECT * FROM ai_changes WHERE id=? AND workbook=?').get(req.params.change,req.params.id);if(!change)fail(404,'Change not found.');
    const data=target(change);if(change.undone_at||revision(data.takeoff)!==change.after_revision)fail(409,'Cannot undo: this takeoff has changed since that AI save.');
    data.next=structuredClone(data.book);const current=findTakeoff(data.next,data.scope);Object.keys(current).forEach(key=>delete current[key]);Object.assign(current,JSON.parse(change.before_json));
    commit(change.workbook,data,user.name+' (AI undo)',()=>db.prepare('UPDATE ai_changes SET undone_at=? WHERE id=?').run(Date.now(),change.id));res.json({undone:true});
  }));
}
