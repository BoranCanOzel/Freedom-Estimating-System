import {WebSocketServer} from 'ws';
import {randomUUID} from 'node:crypto';

// Presence only: share sockets never receive a workbook or accept edits.
export function createSharePresence({access,source,findTakeoff,readBook,rooms,session,project}) {
  const wss=new WebSocketServer({noServer:true,maxPayload:4096}),clients=new Set();
  const send=(ws,value)=>{if(ws.readyState===1)ws.send(JSON.stringify(value));};
  const valid=ws=>{try {access({headers:{authorization:ws.authorization}});return !!project(ws.link.workbook);}catch{return false;}};
  const guests=id=>[...clients].filter(ws=>ws.link?.workbook===id&&valid(ws)).map(ws=>({id:ws.peerId,name:ws.name,...ws.presence}));
  const owners=id=>[...(rooms.get(id)?.clients||[])].map(ws=>({id:ws.peerId,name:ws.name,...ws.presence}));
  function broadcast(workbook){
    const affected=new Set([...clients].map(ws=>ws.link?.workbook).filter(Boolean));if(workbook)affected.add(workbook);
    for(const ws of clients){
      if(!ws.link)continue;
      if(!valid(ws)){ws.close(4003,'Share access unavailable');continue;}
      const scope=ws.scope;
      const peers=[...owners(ws.link.workbook),...guests(ws.link.workbook)].filter(p=>p.takeoff===scope.takeoff&&p.list===scope.list);
      send(ws,{type:'presence',selfId:ws.peerId,peers});
    }
    for(const id of affected){const room=rooms.get(id);if(!room)continue;const peers=[...owners(id),...guests(id)];for(const ws of room.clients)send(ws,{type:'presence',peers});}
  }
  wss.on('connection',(ws,req)=>{
    ws.peerId=randomUUID();clients.add(ws);
    const timeout=setTimeout(()=>{if(!ws.link)ws.close(4001,'Authentication required');},5000);timeout.unref();
    ws.on('error',()=>{});
    ws.on('message',bytes=>{
      try{
        const msg=JSON.parse(bytes.toString());
        if(!ws.link){
          if(msg.type!=='auth')throw Error('Authentication required');
          ws.authorization='Bearer '+msg.key;const link=access({headers:{authorization:ws.authorization}}),scope=JSON.parse(link.scope),doc=source(link.workbook);
          try{const t=findTakeoff(readBook(doc),scope);if(!t)throw Error('Takeoff unavailable');ws.pages=new Set(t.sheets.map(s=>s.id));}finally{doc.destroy();}
          ws.link=link;ws.scope=scope;ws.name=session(req)?.name||'Guest '+ws.peerId.slice(0,4);ws.presence={...scope,view:'summary',visible:false};clearTimeout(timeout);
          send(ws,{type:'ready',selfId:ws.peerId});broadcast();return;
        }
        if(!valid(ws))throw Error('Share access unavailable');
        if(msg.type!=='presence'||Date.now()-(ws.lastPresence||0)<40)return;
        ws.lastPresence=Date.now();const p=msg.presence||{};
        if(!['sheet','summary'].includes(p.view)||p.view==='sheet'&&!ws.pages.has(p.sheet))return;
        const anchor=String(p.anchor||'').slice(0,500);
        ws.presence={...ws.scope,view:p.view,sheet:ws.pages.has(p.sheet)?p.sheet:'',anchor,
          x:Math.max(0,Math.min(1,Number(p.x)||0)),y:Math.max(0,Math.min(1,Number(p.y)||0)),visible:p.visible===true,cursor:'classic'};
        broadcast();
      }catch{ws.close(4003,'Share access unavailable');}
    });
    ws.on('close',()=>{clearTimeout(timeout);clients.delete(ws);broadcast(ws.link?.workbook);});
  });
  const timer=setInterval(()=>{if(clients.size)broadcast();},1000);timer.unref();
  return {peers:guests,upgrade(req,socket,head){wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));},close(){clearInterval(timer);for(const ws of clients)ws.terminate();wss.close();}};
}
