import {validateBook} from './model.js';
export function detectTransfer(raw){
  validateBook({sheets:[raw]});
  if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid estimating JSON.');
  if(raw._scope){if(!['customer','project','takeoff'].includes(raw._scope))throw Error('Unsupported import type.');transferChoices(raw,raw._scope);return raw._scope;}
  if(Array.isArray(raw.lists)||Array.isArray(raw.companies))return 'workbook';
  if(Array.isArray(raw.projects))return 'customer';
  if(Array.isArray(raw.takeoffs))return 'project';
  if(Array.isArray(raw.sheets)||Array.isArray(raw.rows))return 'takeoff';
  throw Error('No workbook, customer, project or estimate found in this file.');
}

export function transferChoices(raw, kind, fallback='Imported estimate') {
  // Reuse the size/depth and unsafe-property checks for scoped records too.
  validateBook({sheets:[raw]});
  const value=raw?._scope ? raw.data : raw;
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid estimating JSON.');
  const result=[];
  const add=(type,data,label)=>{if(type===kind)result.push({data,label});};
  const takeoff=(t,path)=>{if(!Array.isArray(t.sheets))throw Error('Takeoff is missing option pages.');add('takeoff',t,path+t.name);};
  const project=(p,path)=>{add('project',p,path+p.name);for(const t of p.takeoffs||[])takeoff(t,path+p.name+' / ');};
  const customer=(c,path)=>{add('customer',c,path+c.name);for(const p of c.projects||[])project(p,path+c.name+' / ');};
  if(Array.isArray(value.lists)&&value.lists.length)for(const l of value.lists)for(const c of l.companies||[])customer(c,(l.name||'Projects')+' / ');
  else if(Array.isArray(value.companies)&&value.companies.length)for(const c of value.companies)customer(c,'');
  else if(Array.isArray(value.projects))customer(value,'');
  else if(Array.isArray(value.takeoffs))project(value,'');
  else if(Array.isArray(value.sheets))takeoff(raw._scope==='takeoff'||(!value._app&&value.id)?{...value,name:value.name||fallback}:{name:value.name||fallback,note:value.note||'',custom:value.custom||{},sheets:value.sheets},'');
  else if(Array.isArray(value.rows))takeoff({name:fallback,sheets:[value]},'');
  else throw Error('No customers, projects or takeoffs found in this JSON.');
  return result;
}

export function exportTransfer(book,kind,record){
  const dependencies={};
  for(const key of ['libs','catalog','wageGroups','customFields','statuses'])if(book[key]!==undefined)dependencies[key]=structuredClone(book[key]);
  return {_app:'project-breakdown',_v:3,_scope:kind,data:structuredClone(record),dependencies};
}

export function importTransfer(book,kind,record,target,dependencies={},uuid=()=>crypto.randomUUID()){
  const next=structuredClone(book),bundle=structuredClone({record,dependencies}),ids=new Map();
  function scan(v){if(!v||typeof v!=='object')return;if(typeof v.id==='string'&&!ids.has(v.id))ids.set(v.id,uuid());for(const x of Object.values(v))scan(x);}
  scan(bundle);
  function rewrite(v){if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(typeof x==='string'&&ids.has(x)&&(/id$/i.test(k)||['active','sid','ref','template','subtype','service','construct'].includes(k)))v[k]=ids.get(x);else rewrite(x);}if(!Array.isArray(v)&&!v.id&&('rows'in v||'sheets'in v||'takeoffs'in v||'projects'in v))v.id=uuid();}
  rewrite(bundle);
  const lists=next.lists||[],companies=lists.flatMap(l=>l.companies||[]),projects=companies.flatMap(c=>c.projects||[]);
  const parent=(kind==='customer'?lists:kind==='project'?companies:projects).find(p=>p.id===target);
  if(!parent)throw Error('Choose an existing destination for this import.');
  const key=kind==='customer'?'companies':kind==='project'?'projects':'takeoffs';
  (parent[key] ||= []).push(bundle.record);
  for(const key of ['libs','wageGroups'])if(Array.isArray(bundle.dependencies[key]))(next[key] ||= []).push(...bundle.dependencies[key]);
  if(bundle.dependencies.catalog){next.catalog ||= {};for(const [key,value]of Object.entries(bundle.dependencies.catalog))if(Array.isArray(value))next.catalog[key]=[...(next.catalog[key]||[]),...value];}
  if(bundle.dependencies.customFields){next.customFields ||= {};for(const [key,value]of Object.entries(bundle.dependencies.customFields))if(Array.isArray(value))next.customFields[key]=[...new Set([...(next.customFields[key]||[]),...value])];}
  if(Array.isArray(bundle.dependencies.statuses))next.statuses=[...new Set([...(next.statuses||[]),...bundle.dependencies.statuses])];
  validateBook(next);return next;
}
