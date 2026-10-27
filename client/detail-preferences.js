// Personal display choices live outside the collaborative workbook and undo history.
export function createDetailPreferences({api,user,workbook,storage=localStorage,onError=()=>{}}){
  const key='freedom:takeoff-detail:'+JSON.stringify([user,workbook]);
  const entryKey=(list,takeoff)=>JSON.stringify([list,takeoff]);
  let entries=new Map(),pending=new Map(),saving=Promise.resolve();
  try{
    const cached=JSON.parse(storage.getItem(key));
    entries=new Map(cached?.entries||[]);pending=new Map(cached?.pending||[]);
  }catch{}
  function cache(){try{storage.setItem(key,JSON.stringify({entries:[...entries],pending:[...pending]}));}catch{}}
  function flush(){
    saving=saving.then(async()=>{
      for(const [id,value] of [...pending]){
        const [list,takeoff]=JSON.parse(id);
        try{
          await api('/projects/'+workbook+'/takeoff-preferences',{method:'PUT',body:JSON.stringify({list,takeoff,detailsCollapsed:value})});
          if(pending.get(id)===value)pending.delete(id);
          cache();
        }catch{onError('Detail preference saved on this device; it will sync when you reopen the workbook.');break;}
      }
    });
    return saving;
  }
  return {
    collapsed(list,takeoff){return entries.get(entryKey(list,takeoff))!==false;},
    set(list,takeoff,collapsed){
      const id=entryKey(list,takeoff);entries.set(id,collapsed);pending.set(id,collapsed);cache();return flush();
    },
    async load(){
      try{
        const saved=await api('/projects/'+workbook+'/takeoff-preferences',{signal:AbortSignal.timeout(5000)});
        entries=new Map(saved.map(item=>[entryKey(item.list,item.takeoff),item.detailsCollapsed]));
        for(const [id,value] of pending)entries.set(id,value);
        cache();
      }catch{} // Cached choices and the collapsed default work offline too.
      if(pending.size)void flush();
    }
  };
}
