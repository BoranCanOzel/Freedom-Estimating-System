// Lock newly rendered controls, not the whole document on every text/total update.
export function createReadonlyControls(root,excluded){
  const selector='input,textarea,select,button,[contenteditable]';
  const previous=new WeakMap();let enabled=false;
  function lockControl(el){
    if(excluded.contains(el)||previous.has(el))return;
    const property=el.matches('input,textarea')?'readOnly':el.matches('select,button')?'disabled':'contentEditable';
    previous.set(el,{property,value:el[property]});
    const value=property==='contentEditable'?'false':true;
    if(el[property]!==value)el[property]=value;
  }
  function lockTree(node){
    if(node.nodeType!==1||excluded.contains(node))return;
    if(node.matches(selector))lockControl(node);
    for(const el of node.querySelectorAll(selector))lockControl(el);
  }
  const observer=new MutationObserver(records=>{
    const added=new Set();
    for(const record of records)for(const node of record.addedNodes)if(node.nodeType===1&&node.isConnected)added.add(node);
    for(const node of added){let parent=node.parentElement;while(parent&&!added.has(parent))parent=parent.parentElement;if(!parent)lockTree(node);}
  });
  return {setEnabled(value){
    if(enabled===value)return;enabled=value;observer.disconnect();
    if(enabled){lockTree(root);observer.observe(root,{childList:true,subtree:true});}
    else for(const el of root.querySelectorAll(selector)){const old=previous.get(el);if(old){el[old.property]=old.value;previous.delete(el);}}
  }};
}
