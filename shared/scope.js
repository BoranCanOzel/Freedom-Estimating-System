export const scopeStatuses = ['included', 'excluded', 'ignored', 'duplicate'];

// Source IDs, rather than names or row positions, keep review decisions stable.
export function mergeScope(previous, incoming) {
  if (!incoming || typeof incoming.source !== 'string' || !Array.isArray(incoming.items) || incoming.items.length > 10000) throw Error('Invalid scope response.');
  const old = new Map(previous?.source === incoming.source ? (previous.items || []).map(item => [item.id, item]) : []);
  const seen = new Set();
  const items = incoming.items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || seen.has(item.id) || typeof item.name !== 'string') throw Error('Each scope item needs a unique source ID and a name.');
    seen.add(item.id);
    return {id:item.id, name:item.name, measurements:String(item.measurements || ''), group:String(item.group || ''),
      ...(Array.isArray(item.pages)?{pages:item.pages.map(page=>({id:String(page.id),name:String(page.name)}))}:{}),
      ...(typeof old.get(item.id)?.note==='string'?{note:old.get(item.id).note}:{}),
      ...(old.get(item.id)?.showAi===false?{showAi:false}:{}),
      status:scopeStatuses.includes(old.get(item.id)?.status) ? old.get(item.id).status : 'included', missing:false};
  });
  for (const [id, item] of old) if (!seen.has(id)) items.push({...item, missing:true});
  return {source:incoming.source, fetchedAt:incoming.fetchedAt, items};
}
