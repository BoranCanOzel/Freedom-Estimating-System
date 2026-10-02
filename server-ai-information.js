import { aiDataMethods, aiDataMethodLabel, normalizeAiDataWorkTypes } from './shared/ai-data.js';
import { aiVisibleTakeoff } from './shared/ai-takeoff.js';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { readBook } from './shared/model.js';

export function mountAiInformation({app,db,session,rooms}) {
  db.exec(`CREATE TABLE IF NOT EXISTS ai_information (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    INSERT OR IGNORE INTO ai_information VALUES (1,'{"items":[]}');`);
  const read=()=>{
    const raw=db.prepare('SELECT data FROM ai_information WHERE id=1').get().data;
    return {...JSON.parse(raw),revision:createHash('sha256').update(raw).digest('hex')};
  };
  const authenticated=(req,res,next)=>session(req)?next():res.status(401).json({error:'Please sign in.'});
  app.get('/api/ai-information',authenticated,(req,res)=>res.json(read()));
  function readAiEstimates(selector){
    const estimates=[];
    for(const workbook of db.prepare('SELECT id,name,state FROM projects ORDER BY name,id').iterate()){
      if(selector&&selector.workbook!==workbook.id)continue;
      const live=rooms.get(workbook.id)?.doc,doc=live||new Y.Doc();
      try{
        if(!live)Y.applyUpdate(doc,workbook.state);
        const book=readBook(doc);
        for(const list of book.lists||[])for(const company of list.companies||[])for(const project of company.projects||[])for(const takeoff of project.takeoffs||[]){
          if(takeoff.aiData!==true)continue;
          if(selector&&(selector.list!==list.id||selector.takeoff!==takeoff.id))continue;
          const method=aiDataMethods.some(([id])=>id===takeoff.aiDataMethod)?takeoff.aiDataMethod:'';
          const metadata={aiDataWorkTypes:normalizeAiDataWorkTypes(takeoff.aiDataWorkTypes),aiDataMethod:method,aiDataMethodLabel:aiDataMethodLabel(method),workbook:workbook.id,workbookName:workbook.name,list:list.id,listName:list.name||'Projects',
            aiDataPrevailingWage:takeoff.aiDataPrevailingWage===true,
            companyName:company.name||'Untitled customer',projectName:project.name||'Untitled project',
            takeoff:takeoff.id,takeoffName:takeoff.name||'Untitled estimate',sheet:takeoff.sheets?.[0]?.id||'',pages:takeoff.sheets?.length||0};
          if(selector)return {reference:metadata,takeoff:aiVisibleTakeoff(takeoff),readOnly:true};
          estimates.push(metadata);
        }
      }finally{if(!live)doc.destroy();}
    }
    return selector?null:{estimates};
  }
  app.get('/api/ai-information/estimates',authenticated,(_req,res)=>res.json(readAiEstimates()));
  app.put('/api/ai-information',authenticated,(req,res)=>{
    try {
      const {items,revision}=req.body||{};
      if(revision!==read().revision)return res.status(409).json({error:'Someone changed AI Information. Copy your unsaved text, then reload the library before saving.'});
      if(!Array.isArray(items)||items.length>1000)throw Error('Use at most 1,000 folders and entries.');
      const ids=new Map();
      for(const item of items){
        if(!item||typeof item!=='object'||Object.keys(item).some(k=>!['id','parent','kind','title','text'].includes(k)))throw Error('Only text entries and folders are supported.');
        if(typeof item.id!=='string'||!item.id.length||item.id.length>100||ids.has(item.id))throw Error('Invalid or duplicate item ID.');
        if(!['folder','entry'].includes(item.kind)||typeof item.parent!=='string'||typeof item.title!=='string'||!item.title.trim()||item.title.length>160||typeof item.text!=='string'||item.text.length>100000)throw Error('Each item needs a title (up to 160 characters) and plain text (up to 100,000 characters).');
        if(item.kind==='folder'&&item.text)throw Error('Save reference text inside an entry.');
        ids.set(item.id,item);
      }
      for(const item of items){
        const seen=new Set([item.id]);let parent=item.parent;
        while(parent){if(seen.has(parent)||ids.get(parent)?.kind!=='folder')throw Error('Folders must form a valid hierarchy.');seen.add(parent);parent=ids.get(parent).parent;}
      }
      const raw=JSON.stringify({items});
      if(Buffer.byteLength(raw)>2*1024*1024)return res.status(413).json({error:'AI Information is limited to 2 MB of text.'});
      db.prepare('UPDATE ai_information SET data=? WHERE id=1').run(raw);
      res.json(read());
    }catch(error){res.status(422).json({error:error.message});}
  });
  return {readAiInformation:read,readAiEstimates};
}
