// Apply only actual editor changes, preserving fields omitted or normalized by the UI.
export function applyTakeoffDraft(original,before,after){
  if(JSON.stringify(before)===JSON.stringify(after))return structuredClone(original);
  if(Array.isArray(before)&&Array.isArray(after)&&[...before,...after].every(v=>v&&typeof v.id==='string')){
    const old=new Map(before.map(v=>[v.id,v])),source=new Map((original||[]).map(v=>[v.id,v]));
    return after.map(v=>applyTakeoffDraft(source.get(v.id),old.get(v.id),v));
  }
  if(before&&after&&typeof before==='object'&&typeof after==='object'&&!Array.isArray(before)&&!Array.isArray(after)){
    const result=structuredClone(original||{});
    for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
      if(!Object.hasOwn(after,key))delete result[key];
      else if(JSON.stringify(before[key])!==JSON.stringify(after[key]))result[key]=applyTakeoffDraft(original?.[key],before[key],after[key]);
    }
    return result;
  }
  return structuredClone(after);
}
