import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { readBook, writeBook, validateBook } from './shared/model.js';
import { locateTakeoff, findTakeoff, aiVisibleTakeoff, revision, validateTakeoff, differences, takeoffSchema, changeSchema } from './shared/ai-takeoff.js';

import {deriveTimeline} from './shared/timeline.js';

const instructions=readFileSync(new URL('./docs/ai-takeoff.md',import.meta.url),'utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function mountAiAccess({app,db,session,project,rooms,snapshot,readAiInformation,readAiEstimates}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_grants (
    id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, workbook TEXT REFERENCES projects(id), scope TEXT NOT NULL,
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
  // NULL workbook represents universal access. Rebuild only the legacy NOT NULL table;
  // keep IDs and dependent save receipts intact when upgrading an existing database.
  if(db.prepare('PRAGMA table_info(ai_grants)').all().find(column=>column.name==='workbook').notnull){
    db.exec('PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE');
    try{
      db.exec(`CREATE TABLE ai_grants_new (
        id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, workbook TEXT REFERENCES projects(id), scope TEXT NOT NULL,
        created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0,
        used_at INTEGER, request_id TEXT, request_hash TEXT, receipt TEXT);
        INSERT INTO ai_grants_new SELECT * FROM ai_grants;
        DROP TABLE ai_grants; ALTER TABLE ai_grants_new RENAME TO ai_grants;`);
      if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('AI access migration failed its foreign key check.');
      db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error;}
    finally{db.exec('PRAGMA foreign_keys=ON');}
  }
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
    if(!grant)fail(401,'A valid AI access key is required.');
    if(grant.revoked)fail(403,'Takeoff access was revoked.');
    return grant;
  }
  function prepare(grant,payload){
    if(!payload||typeof payload!=='object'||Array.isArray(payload))fail(422,'Send revision and takeoff.');
    if(Object.keys(payload).some(key=>!['revision','takeoff','requestId',...(grant.universal?['target']:[])].includes(key)))fail(422,'Only revision, takeoff, requestId, and a universal key target are accepted.');
    const data=target(grant);
    if(payload.revision!==revision(data.takeoff))fail(409,'This takeoff changed. Read it again before saving.');
    if(Buffer.byteLength(JSON.stringify(payload.takeoff||{}))>2*1024*1024)fail(413,'Takeoff exceeds the 2 MB AI editing limit.');
    validateTakeoff(payload.takeoff,aiVisibleTakeoff(data.takeoff));
    const next=structuredClone(data.book),current=findTakeoff(next,data.scope);
    Object.keys(current).forEach(key=>delete current[key]);Object.assign(current,payload.takeoff);
    for(const key of ['scopeData','scopeLink']){
      if(Object.hasOwn(data.takeoff,key))current[key]=structuredClone(data.takeoff[key]);
    }
    // Preserve assignments the AI cannot see, while allowing visible items to be unassigned.
    const visibleIds=new Set((aiVisibleTakeoff(data.takeoff).scopeData?.items||[]).map(item=>item.id));
    const pageIds=new Set(current.sheets.map(sheet=>sheet.id));
    const assignments={...current.scopeAssignments};
    for(const [id,page] of Object.entries(data.takeoff.scopeAssignments||{}))if(!visibleIds.has(id)&&pageIds.has(page))assignments[id]=page;
    if(Object.hasOwn(current,'scopeAssignments')||Object.keys(assignments).length)current.scopeAssignments=assignments;
    validateBook(next);
    return {...data,next,summary:differences(data.takeoff,current)};
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
  const targetedOperations=['read_takeoff','read_scope','read_timeline','validate_changes','save_takeoff'];
  function selectTarget(grant,selector){
    if(!selector||typeof selector!=='object'||Array.isArray(selector)||Object.keys(selector).some(key=>!Object.hasOwn(referenceSchema.properties,key))||referenceSchema.required.some(key=>typeof selector[key]!=='string'||!selector[key].length||selector[key].length>200))fail(422,'Universal keys require target: {workbook, list, takeoff} from list_takeoffs.');
    const scope=locateTakeoff(source(selector.workbook).book,selector.list,selector.takeoff);
    if(!scope)fail(404,'Takeoff not found.');
    return {...grant,universal:true,workbook:selector.workbook,scope:JSON.stringify(scope)};
  }
  function listTakeoffs(grant){
    const takeoffs=[];
    const workbooks=grant.workbook===null?db.prepare('SELECT id,name FROM projects ORDER BY name,id').all():db.prepare('SELECT id,name FROM projects WHERE id=?').all(grant.workbook);
    for(const workbook of workbooks){
      const book=source(workbook.id).book;
      for(const list of book.lists||[])for(const company of list.companies||[])for(const project of company.projects||[])for(const takeoff of project.takeoffs||[]){
        if(grant.workbook!==null&&JSON.stringify({list:list.id,company:company.id,project:project.id,takeoff:takeoff.id})!==grant.scope)continue;
        takeoffs.push({workbook:workbook.id,workbookName:workbook.name,list:list.id,listName:list.name||'Projects',companyName:company.name||'',projectName:project.name||'',takeoff:takeoff.id,takeoffName:takeoff.name||''});
      }
    }
    return {takeoffs};
  }
  const scopeGuidance='Use the fetched Scope items as the measured work for this takeoff. Include only items with status included and missing=false. Do not price excluded, ignored, duplicate, or missing items unless the user explicitly asks. Read item notes for scope details and estimating context. Preserve names, notes, units, measurements, review statuses and source IDs. Ask about missing measurements; do not invent quantities. Scope data is read-only and reflects the last fetch, not a live ZZTakeoff connection.';
  function execute(grant,name,payload={}){
    if(grant.workbook!==null&&payload?.target!==undefined)fail(403,'Project keys cannot select a different target.');
    if(name==='list_takeoffs')return listTakeoffs(grant);
    if(grant.workbook===null&&targetedOperations.includes(name))grant=selectTarget(grant,payload?.target);
    if(name==='read_timeline'){const {takeoff}=target(grant);return {takeoffId:takeoff.id,revision:revision(takeoff),...deriveTimeline(takeoff)};}
    if(name==='read_scope'){
      const {takeoff}=target(grant);
      if(takeoff.scopeAiAccess===false)fail(403,'Scope access is disabled for this estimate. The user can enable Allow AI to read Scope on its Scope page.');
      const visible=aiVisibleTakeoff(takeoff);
      return {takeoffId:takeoff.id,scopeData:visible.scopeData||null,scopeAssignments:visible.scopeAssignments||{},pages:takeoff.sheets.map(({id,title,color})=>({id,title,color})),readOnly:true,guidance:scopeGuidance+' Assign visible items through takeoff.scopeAssignments and set sheets[].color using validate_changes/save_takeoff. Measurements and review decisions remain read-only.'};
    }
    if(name==='list_ai_data')return readAiEstimates();
    if(name==='read_ai_data'){
      if(!payload||Object.keys(payload).some(key=>!['workbook','list','takeoff'].includes(key))||['workbook','list','takeoff'].some(key=>typeof payload[key]!=='string'||!payload[key].length||payload[key].length>200))fail(422,'Provide workbook, list, and takeoff from list_ai_data.');
      const reference=readAiEstimates(payload);
      if(!reference)fail(404,'AI Data reference not found or no longer enabled.');
      return reference;
    }
    if(name==='get_instructions')return {aiInformation:readAiInformation(),aiData:readAiEstimates(),access:grant.workbook===null?'universal':'takeoff',scopeAvailable:grant.workbook===null?null:target(grant).takeoff.scopeAiAccess!==false&&!!target(grant).takeoff.scopeData,instructions,schema:takeoffSchema,changeSchema:grant.workbook===null?{...changeSchema,required:[...changeSchema.required,'target'],properties:{...changeSchema.properties,target:referenceSchema}}:changeSchema};
    if(name==='read_ai_information')return {guidance:'Read and analyze this reference library before working. Return here whenever you need guidance. Use only entries relevant to the task; ask about missing or conflicting information.',...readAiInformation(),aiData:readAiEstimates()};
    if(name==='read_takeoff'){const {takeoff}=target(grant);return {aiInformation:readAiInformation(),guidance:'Analyze AI Information first. Read takeoff.scopeData or call read_scope for fetched Scope items and review decisions. '+scopeGuidance,takeoff:aiVisibleTakeoff(takeoff),revision:revision(takeoff),expiresAt:null};}
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
    const id=randomUUID(),time=Date.now(),after=revision(findTakeoff(data.next,data.scope));
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
  for(const [method,path,name]of [['get','takeoffs','list_takeoffs'],['get','timeline','read_timeline'],['get','scope','read_scope'],['get','ai-data','list_ai_data'],['get','ai-data/takeoff','read_ai_data'],['get','instructions','get_instructions'],['get','information','read_ai_information'],['get','takeoff','read_takeoff'],['post','validate','validate_changes'],['post','save','save_takeoff']])app[method](base+'/'+path,route((req,res)=>{
    const grant=grantFor(req);
    let payload=method==='get'?req.query:req.body;
    if(method==='get'&&targetedOperations.includes(name)&&Object.keys(req.query).length)payload={target:req.query};
    res.json(execute(grant,name,payload));
  }));
  const tools=[['read_timeline','Read the saved AI work plan, availableWork source IDs, availableResources equipment/item references, and daily costs. Nothing is scheduled or assigned automatically. Write explicit tasks with startHour, durationHours, crew, notes and resources; add daily travel/hotel/meals/other allowances in takeoff.timeline.costs through validate_changes/save_takeoff. Planning costs never change estimate prices.',false],['read_scope','Read the authorized takeoff\'s last fetched Scope items, measurements, groups and review statuses. Read-only; excluded, ignored, duplicate and missing items must not be priced by default.',false],['list_ai_data','List all takeoffs currently marked AI Data, across workbooks, as read-only references.',false],['read_ai_data','Read the full JSON of an AI Data reference using workbook, list, and takeoff from list_ai_data. Cannot edit references.',false],['read_ai_information','Read the shared text reference library first and revisit it for guidance. Folders organize user-maintained rates, standards and other reference material.',false],['get_instructions','Read JSON editing instructions and schema.',false],['read_takeoff','Read only the authorized takeoff and its revision.',false],['validate_changes','Validate proposed takeoff JSON and preview changes without saving.',false],['save_takeoff','Save changes to the authorized takeoff. This key remains active for future saves. Requires the revision you read and a unique requestId.',true]].map(([name,description,write])=>({name,description,inputSchema:name==='read_ai_data'?referenceSchema:name==='save_takeoff'?{...changeSchema,required:['revision','takeoff','requestId']}:name==='validate_changes'?changeSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:!write,destructiveHint:write,idempotentHint:true,openWorldHint:false}}));
  // Stateless Streamable HTTP, compatible with the 2025-11-25 MCP handshake.
  tools.unshift({name:'list_takeoffs',description:'List accessible takeoffs with workbook, list, and takeoff IDs. Universal keys must choose a target from this list for every takeoff read or edit.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}});
  function toolsFor(universal){return tools.map(tool=>universal&&targetedOperations.includes(tool.name)?{...tool,description:tool.description+' Requires target from list_takeoffs.',inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,target:referenceSchema},required:[...(tool.inputSchema.required||[]),'target']}}:tool);}
  app.get(base+'/mcp',route((req,res)=>{grantFor(req);res.set('Allow','POST').sendStatus(405);}));
  app.post(base+'/mcp',route((req,res)=>{
    const grant=grantFor(req),msg=req.body;
    const versions=['2025-03-26','2025-06-18','2025-11-25'];
    if(req.headers['mcp-protocol-version']&&!versions.includes(req.headers['mcp-protocol-version']))return res.status(400).json({error:'Unsupported MCP version. Negotiate a supported version using initialize.'});
    if(!msg||msg.jsonrpc!=='2.0'||typeof msg.method!=='string')return res.status(400).json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request.'}});
    if(msg.id===undefined)return res.sendStatus(202);
    const respond=result=>res.json({jsonrpc:'2.0',id:msg.id,result});
    if(msg.method==='initialize')return respond({protocolVersion:versions.includes(msg.params?.protocolVersion)?msg.params.protocolVersion:'2025-11-25',capabilities:{tools:{}},serverInfo:{name:'freedom-takeoff',version:'1.0.0'},instructions:'Read get_instructions and analyze its AI Information first, before working on the takeoff. Revisit read_ai_information whenever guidance is needed. Call read_scope for fetched measurements and respect review statuses. Call list_takeoffs to discover accessible estimates. Project keys edit only their authorized takeoff. Universal keys require target: {workbook, list, takeoff} on every takeoff read, scope read, timeline read, validation, and save; choose the requested estimate explicitly. Before creating, repricing, or restructuring an estimate, use list_ai_data and read_ai_data to read the closest examples in full. Use applicable examples as the primary estimating reference for structure, crews, production, and pricing; match work type, pricing method, prevailing wage, night work, and job conditions. Follow get_instructions for adapting examples and resolving gaps. References remain read-only. Access permits repeated saves and does not expire.'});
    if(msg.method==='ping')return respond({});
    if(msg.method==='tools/list')return respond({tools:toolsFor(grant.workbook===null)});
    if(msg.method!=='tools/call')return res.json({jsonrpc:'2.0',id:msg.id,error:{code:-32601,message:'Method not found.'}});
    try{return respond({content:[{type:'text',text:JSON.stringify(execute(grant,msg.params?.name,msg.params?.arguments))}]});}
    catch(error){return respond({isError:true,content:[{type:'text',text:JSON.stringify({error:error.message,status:error.status||422})}]});}
  }));
  app.get(base+'/openapi.json',(req,res)=>{
    const paths={};
    for(const [path,method,name] of [['/takeoffs','get','list_takeoffs'],['/timeline','get','read_timeline'],['/scope','get','read_scope'],['/ai-data','get','list_ai_data'],['/ai-data/takeoff','get','read_ai_data'],['/instructions','get','get_instructions'],['/information','get','read_ai_information'],['/takeoff','get','read_takeoff'],['/validate','post','validate_changes'],['/save','post','save_takeoff']]) {
      const tool=tools.find(t=>t.name===name),targeted=targetedOperations.includes(name);
      paths[path]={[method]:{operationId:name,summary:tool.description,
        ...(name==='read_ai_data'||(method==='get'&&targeted)?{parameters:Object.entries(referenceSchema.properties).map(([name,schema])=>({name,in:'query',required:name==='read_ai_data',description:name==='read_ai_data'?'Reference ID.':'Required for universal keys; omit for project keys.',schema}))}:{}),
        ...(method==='post'?{requestBody:{required:true,content:{'application/json':{schema:{...tool.inputSchema,properties:{...tool.inputSchema.properties,target:{...referenceSchema,description:'Required for universal keys; omit for project keys.'}}}}}}}:{}),
        responses:{200:{description:'Operation result',content:{'application/json':{schema:{type:'object'}}}}}}};
    }
    res.json({openapi:'3.1.0',info:{title:'Freedom AI editing',version:'1.1.0'},servers:[{url:req.protocol+'://'+req.get('host')+base}],security:[{takeoffKey:[]}],components:{securitySchemes:{takeoffKey:{type:'http',scheme:'bearer'}}},paths});
  });
  const admin='/api/projects/:id/ai-access';
  app.get('/api/ai-access/universal',route((req,res)=>{
    signed(req);res.json({grants:db.prepare('SELECT id,created_by,created_at,revoked,used_at FROM ai_grants WHERE workbook IS NULL ORDER BY created_at DESC').all()});
  }));
  app.post('/api/ai-access/universal',route((req,res)=>{
    const user=signed(req),key=randomBytes(32).toString('hex'),id=randomUUID();
    db.prepare("INSERT INTO ai_grants(id,key_hash,workbook,scope,created_by,created_at,expires_at) VALUES (?,?,NULL,'{}',?,?,0)").run(id,hash(key),user.name,Date.now());
    res.status(201).json({id,key,access:'universal',expiresAt:null,endpoint:base,mcp:base+'/mcp',instructions:base+'/instructions',information:base+'/information',openapi:base+'/openapi.json'});
  }));
  app.delete('/api/ai-access/universal/:grant',route((req,res)=>{
    signed(req);const result=db.prepare('UPDATE ai_grants SET revoked=1 WHERE id=? AND workbook IS NULL').run(req.params.grant);
    if(!result.changes)fail(404,'Universal access not found.');res.json({revoked:true});
  }));
  app.get('/api/ai-access',route((req,res)=>{
    signed(req);
    const users=db.prepare('SELECT created_by AS name, SUM(CASE WHEN revoked=0 THEN 1 ELSE 0 END) AS active FROM ai_grants GROUP BY created_by ORDER BY created_by COLLATE NOCASE').all();
    res.json({users,active:users.reduce((sum,user)=>sum+user.active,0)});
  }));
  app.post('/api/ai-access/revoke',route((req,res)=>{
    signed(req);const body=req.body;
    if(!body||!['user','server'].includes(body.scope)||Object.keys(body).some(key=>!['scope','user'].includes(key)))fail(422,'Choose a user or server-wide revocation.');
    if(body.scope==='user'&&(typeof body.user!=='string'||!body.user.trim()))fail(422,'Choose the user whose AI keys should be revoked.');
    if(body.scope==='server'&&body.user!==undefined)fail(422,'Server-wide revocation cannot specify a user.');
    const result=body.scope==='user'?db.prepare('UPDATE ai_grants SET revoked=1 WHERE revoked=0 AND created_by=?').run(body.user):db.prepare('UPDATE ai_grants SET revoked=1 WHERE revoked=0').run();
    res.json({revoked:result.changes});
  }));
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
