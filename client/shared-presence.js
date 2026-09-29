export function setupSharedPresence({key,bridge,host,navigate}){
  const people=document.createElement('div');people.id='shared-people';people.setAttribute('aria-label','People viewing this estimate');host.append(people);
  const layer=document.createElement('div');layer.id='shared-cursors';layer.setAttribute('aria-hidden','true');document.body.append(layer);
  let socket,ready=false,selfId,peers=[],pointer={visible:false},timer,closed=false,lastSent=0;
  let peopleSignature='';const cursorNodes=new Map();
  function paint(){
    const here=bridge.getLocation(),signature=JSON.stringify([ready,peers.filter(p=>p.id!==selfId).map(p=>[p.id,p.name,p.view,p.sheet,p.color])]);
    const rebuild=signature!==peopleSignature;peopleSignature=signature;if(rebuild)people.replaceChildren();
    const visible=new Set();
    for(const peer of peers.filter(p=>p.id!==selfId)){
      let hash=0;for(const c of peer.id)hash=(hash*31+c.charCodeAt(0))|0;
      const color=peer.color||`hsl(${Math.abs(hash)%360} 65% 45%)`;
      const page=document.querySelector(`#shared-page option[value="${CSS.escape(peer.sheet||'')}"]`);
      const label=peer.view==='summary'?'Summary':page?.textContent||'Detail page';
      if(rebuild){const button=document.createElement('button');button.textContent=peer.name+' · '+label;button.title='Go to '+peer.name+' · '+label;button.style.borderLeft='4px solid '+color;
      button.onclick=()=>navigate(peer.view,peer.sheet);people.append(button);}
      if(!peer.visible||peer.view!==here.view||peer.view==='sheet'&&peer.sheet!==here.sheet)continue;
      let target;try{target=document.querySelector(peer.anchor);}catch{}if(!target||!target.closest('.sheet'))continue;
      const r=target.getBoundingClientRect();if(!r.width||!r.height||r.bottom<0||r.top>innerHeight)continue;
      let cursor=cursorNodes.get(peer.id);if(!cursor){cursor=document.createElement('div');cursor.className='shared-peer-cursor';cursorNodes.set(peer.id,cursor);layer.append(cursor);}visible.add(peer.id);cursor.textContent='➤ '+peer.name;cursor.style.color=color;cursor.style.left=r.left+r.width*peer.x+'px';cursor.style.top=r.top+r.height*peer.y+'px';
    }
    for(const [id,node] of cursorNodes)if(!visible.has(id)){node.remove();cursorNodes.delete(id);}
    if(!people.childElementCount){const text=document.createElement('span');text.textContent=ready?'You are the only viewer here':'Connecting live viewers…';people.append(text);}
  }
  function send(){if(!ready||socket?.readyState!==1)return;socket.send(JSON.stringify({type:'presence',presence:{...bridge.getLocation(),...pointer}}));lastSent=Date.now();}
  function schedule(){clearTimeout(timer);timer=setTimeout(send,Math.max(0,60-(Date.now()-lastSent)));}
  function connect(){
    socket=new WebSocket(`${location.protocol==='https:'?'wss:':'ws:'}//${location.host}/share-live`);
    socket.onopen=()=>socket.send(JSON.stringify({type:'auth',key}));
    socket.onmessage=e=>{const msg=JSON.parse(e.data);if(msg.type==='ready'){ready=true;selfId=msg.selfId;send();}if(msg.type==='presence'){selfId=msg.selfId;peers=msg.peers;paint();}};
    socket.onclose=e=>{ready=false;peers=[];paint();if(!closed&&e.code!==4003)setTimeout(connect,1500);else people.textContent='Live viewers unavailable';};
  }
  document.addEventListener('pointermove',e=>{
    const target=e.target.closest('.sheet [data-id],.sheet [id]');
    if(!target){pointer={visible:false};schedule();return;}
    let anchor;if(target.id)anchor='#'+CSS.escape(target.id);else{const root=target.parentElement.closest('[id]');if(!root)return;anchor='#'+CSS.escape(root.id)+' [data-id="'+CSS.escape(target.dataset.id)+'"]';}
    const r=target.getBoundingClientRect();pointer={anchor,x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height,visible:true};schedule();
  });
  document.addEventListener('pointerleave',()=>{pointer={visible:false};schedule();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){pointer={visible:false};send();}});
  document.addEventListener('estimator:view',()=>{pointer={visible:false};schedule();paint();});
  document.addEventListener('scroll',()=>{pointer={visible:false};schedule();paint();},{capture:true,passive:true});
  window.addEventListener('resize',paint);
  window.addEventListener('pagehide',()=>{closed=true;clearTimeout(timer);socket?.close();});
  connect();
}
