import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { readBook, writeBook, validateBook } from './shared/model.js';
import { locateTakeoff, findTakeoff, revision, validateTakeoff, differences, takeoffSchema, changeSchema } from './shared/ai-takeoff.js';

const instructions=readFileSync(new URL('./docs/ai-takeoff.md',import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function mountAiAccess({app,db,session,project,rooms,snapshot,readAiInformation,readAiEstimates}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_grants (
    id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, workbook TEXT NOT NULL REFERENCES projects(id), scope TEXT NOT NULL,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
    used_at INTEGER, request_id TEXT, request_hash TEXT, receipt TEXT);
    CREATE TABLE IF NOT EXISTS ai_changes (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL, workbook TEXT NOT NULL, scope TEXT NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, before_json TEXT NOT NULL, after_revision TEXT NOT NULL, summary TEXT NOT NULL, undone_at INTEGER);
    CREATE TABLE IF NOT EXISTS ai_save_requests (
    grant_id TEXT NOT NULL REFERENCES ai_grants(id) ON DELETE CASCADE, request_id TEXT NOT NULL,
    request_hash TEXT NOT NULL, receipt TEXT NOT NULL, PRIMARY KEY(grant_id,request_id));
    INSERT OR IGNORE INTO ai_save_requests (grant_id,request_id,request_hash,receipt)
    SELECT id,request_id,request_hash,receipt FROM ai_grants
    WHERE request_id IS NOT NULL AND request_hash IS NOT NULL AND receipt IS NOT NULL;
    UPDATE ai_grants SET expires_at=0 WHERE expires_at<>0;`);
  // Zero marks permanent access in the legacy NOT NULL expiry column.
  // Preserve explicit revocations and receipts from older single-save grants.
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
    return grant;
  }
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
  const referenceSchema={type:'object',required:['workbook','list','takeoff'],properties:Object.fromEntries(['workbook','list','takeoff'].map(key=>[key,{type:'string',minLength:1,maxLength:200}])),additionalProperties:false};
  function execute(grant,name,payload={}){
    if(name==='list_ai_data')return readAiEstimates();
    if(name==='read_ai_data'){
      if(!payload||Object.keys(payload).some(key=>!['workbook','list','takeoff'].includes(key))||['workbook','list','takeoff'].some(key=>typeof payload[key]!=='string'||!payload[key].length||payload[key].length>200))fail(422,'Provide workbook, list, and takeoff from list_ai_data.');
      const reference=readAiEstimates(payload);
      if(!reference)fail(404,'AI Data reference not found or no longer enabled.');
      return reference;
    }
    if(name==='get_instructions')return {aiInformation:readAiInformation(),aiData:readAiEstimates(),instructions,schema:takeoffSchema,changeSchema};
    if(name==='read_ai_information')return {guidance:'Read and analyze this reference library before working. Return here whenever you need guidance. Use only entries relevant to the task; ask about missing or conflicting information.',...readAiInformation(),aiData:readAiEstimates()};
    if(name==='read_takeoff'){const {takeoff}=target(grant);return {aiInformation:readAiInformation(),guidance:'Analyze AI Information first. Consult read_ai_information again whenever guidance is needed.',takeoff,revision:revision(takeoff),expiresAt:null};}
    if(!['validate_changes','save_takeoff'].includes(name))fail(404,'Unknown takeoff operation.');
    if(name==='save_takeoff'){
      if(typeof payload?.requestId!=='string'||!payload.requestId.length||payload.requestId.length>100)fail(422,'Provide a unique requestId, up to 100 characters.');
      const previous=db.prepare('SELECT request_hash,receipt FROM ai_save_requests WHERE grant_id=? AND request_id=?').get(grant.id,payload.requestId);
      if(previous){
        if(hash(JSON.stringify(payload))!==previous.request_hash)fail(409,'This requestId was already used for different changes. Use a new requestId.');
        return {...JSON.parse(previous.receipt),accessConsumed:false};
      }
    }
    const data=prepare(grant,payload);
    if(name==='validate_changes')return {valid:true,revision:payload.revision,changes:data.summary,previewLimit:200};
    if(!data.summary.length)fail(422,'No changes to save. Access remains available.');
    const id=randomUUID(),time=Date.now(),after=revision(payload.takeoff);
    const receipt={saved:true,changeId:id,revision:after,changes:data.summary,accessConsumed:false};
    commit(grant.workbook,data,'AI via '+grant.created_by,()=>{
      const result=db.prepare('UPDATE ai_grants SET used_at=? WHERE id=? AND revoked=0').run(time,grant.id);
      if(result.changes!==1)fail(403,'Takeoff access was revoked.');
      db.prepare('INSERT INTO ai_save_requests (grant_id,request_id,request_hash,receipt) VALUES (?,?,?,?)').run(grant.id,payload.requestId,hash(JSON.stringify(payload)),JSON.stringify(receipt));
      db.prepare('INSERT INTO ai_changes VALUES (?,?,?,?,?,?,?,?,?,NULL)').run(id,grant.id,grant.workbook,grant.scope,grant.created_by,time,JSON.stringify(data.takeoff),after,JSON.stringify(data.summary));
    });return receipt;
  }
  const base='/api/ai/v1';
  app.use(base,(req,res,next)=>{res.set('Cache-Control','no-store');if(req.headers.origin){try{if(new URL(req.headers.origin).host!==req.headers.host)return res.status(403).json({error:'Cross-origin request refused.'});}catch{return res.status(403).json({error:'Invalid origin.'});}}next();});
  for(const [method,path,name]of [['get','ai-data','list_ai_data'],['get','ai-data/takeoff','read_ai_data'],['get','instructions','get_instructions'],['get','information','read_ai_information'],['get','takeoff','read_takeoff'],['post','validate','validate_changes'],['post','save','save_takeoff']])app[method](base+'/'+path,route((req,res)=>res.json(execute(grantFor(req),name,method==='get'?req.query:req.body))));
  const tools=[['list_ai_data','List all takeoffs currently marked AI Data, across workbooks, as read-only references.',false],['read_ai_data','Read the full JSON of an AI Data reference using workbook, list, and takeoff from list_ai_data. Cannot edit references.',false],['read_ai_information','Read the shared text reference library first and revisit it for guidance. Folders organize user-maintained rates, standards and other reference material.',false],['get_instructions','Read JSON editing instructions and schema.',false],['read_takeoff','Read only the authorized takeoff and its revision.',false],['validate_changes','Validate proposed takeoff JSON and preview changes without saving.',false],['save_takeoff','Save changes to the authorized takeoff. This key remains active for future saves. Requires the revision you read and a unique requestId.',true]].map(([name,description,write])=>({name,description,inputSchema:name==='read_ai_data'?referenceSchema:name==='save_takeoff'?{...changeSchema,required:['revision','takeoff','requestId']}:name==='validate_changes'?changeSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false}}));
  // Stateless Streamable HTTP, compatible with the 2025-11-25 MCP handshake.
  app.get(base+'/mcp',route((req,res)=>{grantFor(req);res.set('Allow','POST').sendStatus(405);}));
  app.post(base+'/mcp',route((req,res)=>{
    const grant=grantFor(req),msg=req.body;
    const versions=['2025-03-26','2025-06-18','2025-11-25'];
    if(req.headers['mcp-protocol-version']&&!versions.includes(req.headers['mcp-protocol-version']))return res.status(400).json({error:'Unsupported MCP version. Negotiate a supported version using initialize.'});
    if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}});
    if(msg.id===undefined)return res.sendStatus(202);
    const respond=result=>res.json({jsonrpc:'2.0',id:msg.id,result});
    if(msg.method==='initialize')return respond({protocolVersion:versions.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'freedom-takeoff',version:'1.0.0'},instructions:'Read get_instructions and analyze its AI Information first, before working on the takeoff. Revisit read_ai_information whenever guidance is needed. Editing is limited to one takeoff. Use list_ai_data and read_ai_data for read-only access to all AI Data references. Access permits repeated saves and does not expire.'});
    if(msg.method==='ping')return respond({});
    if(msg.method==='tools/list')return respond({tools});
    if(msg.method!=='tools/call')return res.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found.'}});
    try{return respond({content:[{type:'text',text:JSON.stringify(execute(grant,msg.params?.name,msg.params?.arguments))}]});}
    catch(error){return respond({isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,status:error.status||422})}]});}
  }));
  app.get(base+'/openapi.json',(req,res)=>{
    const paths={};
    for(const [path,method,name] of [['/ai-data','get','list_ai_data'],['/ai-data/takeoff','get','read_ai_data'],['/instructions','get','get_instructions'],['/information','get','read_ai_information'],['/takeoff','get','read_takeoff'],['/validate','post','validate_changes'],['/save','post','save_takeoff']]) {
      const tool=tools.find(t=>t.name===name);
      paths[path]={[method]:{operationId:name,summary:tool.description,
        ...(name==='read_ai_data'?{parameters:Object.entries(referenceSchema.properties).map(([name,schema])=>({name,in:'query',required:true,schema}))}:{}),
        ...(method==='post'?{requestBody:{required:true,content:{'application/json':{schema:tool.inputSchema}}}}:{}),
        responses:{200:{description:'Operation result',content:{'application/json':{schema:{type:'object'}}}}}}};
    }
    res.json({openapi:'3.1.0',info:{title:'Freedom one-takeoff editing',version:'1.0.0'},servers:[{url:req.protocol+'://'+req.get('host')+base}],security:[{takeoffKey:[]}],components:{securitySchemes:{takeoffKey:{type:'http',scheme:'bearer'}}},paths});
  });
  const admin='/api/projects/:id/ai-access';
  app.post(admin,route((req,res)=>{
    const user=signed(req),data=source(req.params.id),scope=locateTakeoff(data.book,req.body?.list,req.body?.takeoff);
    if(!scope)fail(404,'Takeoff not found.');
    const key=randomBytes(32).toString('hex'),id=randomUUID(),time=Date.now(),scopeText=JSON.stringify(scope);
    db.prepare('INSERT INTO ai_grants(id,key_hash,workbook,scope,created_by,created_at,expires_at) VALUES (?,?,?,?,?,?,0)').run(id,hash(key),req.params.id,scopeText,user.name,time);
    res.status(201).json({id,key,expiresAt:null,takeoffName:findTakeoff(data.book,scope).name,endpoint:base,mcp:base+'/mcp',instructions:base+'/instructions',information:base+'/information',openapi:base+'/openapi.json'});
  }));
  app.get(admin,route((req,res)=>{
    signed(req);const data=source(req.params.id),scope=locateTakeoff(data.book,req.query.list,req.query.takeoff);if(!scope)fail(404,'Takeoff not found.');
    const scopeText=JSON.stringify(scope);
    const grants=db.prepare('SELECT id,created_by,created_at,NULL AS expires_at,revoked,used_at FROM ai_grants WHERE workbook=? AND scope=? ORDER BY created_at DESC LIMIT 30').all(req.params.id,scopeText);
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
