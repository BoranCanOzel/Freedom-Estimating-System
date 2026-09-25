import './tank-duel.css';
import { tankCamera } from './tank-camera.js';

export function setupTankDuel(getConnection, notify) {
  const panel = document.createElement('section');
  panel.id = 'tank-duel'; panel.hidden = true;
  panel.setAttribute('aria-label', 'Tank duel');
  panel.innerHTML = `<header><strong>DESERT DUEL</strong><span id="duel-status" role="status"></span><button id="duel-sound" type="button" aria-pressed="true">Sound on</button><button id="duel-close" type="button">Close</button></header>
    <div id="duel-invite"><p id="duel-invite-text"></p><button id="duel-accept" type="button">Accept duel</button><button id="duel-decline" type="button">Decline</button></div>
    <div id="duel-game" hidden><canvas width="1000" height="280" aria-label="Random desert battlefield with two tanks"></canvas>
    <div class="duel-controls"><span id="duel-side"></span><button id="duel-left" type="button" aria-label="Move tank left">← A</button><button id="duel-right" type="button" aria-label="Move tank right">D →</button><output id="duel-fuel" aria-label="Movement fuel"></output><label>Angle <input id="duel-angle" type="range" min="5" max="175" value="45"><output id="duel-angle-value">45°</output></label><label>Power <input id="duel-power" type="range" min="10" max="100" value="65"><output id="duel-power-value">65</output></label><button id="duel-fire" type="button">Fire!</button><span>Move before firing · Fuel resets each turn · First hit wins · 90° points straight up</span></div></div>`;
  document.body.append(panel);
  const $ = id => panel.querySelector('#duel-' + id);
  const canvas = panel.querySelector('canvas'), ctx = canvas.getContext('2d');
  let state = null, id = null, frame = 0, timer = null, aimTimer = null, animating = false, muted = false, audio;
  let shotPath = [], visibleGround = null, visibleProjectile = null;
  let moveTimer = null;
  const stopMoving = () => { clearInterval(moveTimer); moveTimer = null; };
  const send = (action, extra = {}) => {
    const connection = getConnection();
    if (!connection?.synced || connection.socket.readyState !== WebSocket.OPEN) { notify('Reconnect before starting a duel.', true); return false; }
    connection.socket.send(JSON.stringify({type:'duel',action,id,...extra})); return true;
  };
  function sound(kind) {
    if (muted) return;
    try {
      audio ||= new AudioContext();
      if (audio.state !== 'running') { audio.resume().catch(()=>{}); return; }
      const tones = kind === 'invite' ? [220,330,440] : kind === 'fire' ? [110,55] : [330,440,660];
      tones.forEach((frequency,i)=>{
        const oscillator=audio.createOscillator(), gain=audio.createGain(), start=audio.currentTime+i*.12;
        oscillator.type='triangle'; oscillator.frequency.setValueAtTime(frequency,start);
        gain.gain.setValueAtTime(.0001,start); gain.gain.exponentialRampToValueAtTime(.06,start+.01); gain.gain.exponentialRampToValueAtTime(.0001,start+.2);
        oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(start); oscillator.stop(start+.22);
      });
    } catch {}
  }
  document.addEventListener('pointerdown',()=>{ try { audio ||= new AudioContext(); audio.resume().catch(()=>{}); } catch {} },{once:true});
  function stop() { stopMoving(); cancelAnimationFrame(frame); clearTimeout(timer); clearTimeout(aimTimer); aimTimer=null; animating=false; shotPath=[]; visibleGround=null; visibleProjectile=null; }
  function controls() {
    const mine = state && state.turn === state.you && !state.finished && !animating;
    for (const control of ['angle','power','fire']) $(control).disabled = !mine;
    for (const control of ['left','right']) $(control).disabled = !mine || !state.fuel;
    $('fuel').textContent = `Turn fuel: ${state?.fuel ?? 0}/60`;
    if (!mine || !state.fuel) stopMoving();
    if (state) $('status').textContent = state.finished ? (state.winner === null ? 'Draw — 60 shots!' : state.names[state.winner] + ' wins!') : animating ? 'Shell in flight…' : state.names[state.turn] + "’s turn";
  }
  function draw(ground = state?.ground, projectile = null) {
    if (!ground || !state) return;
    visibleGround = ground; visibleProjectile = projectile;
    const bounds = canvas.getBoundingClientRect(), density = window.devicePixelRatio || 1;
    if (!bounds.width || !bounds.height) return;
    const width = Math.round(bounds.width * density), height = Math.round(bounds.height * density);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
    const camera = tankCamera(bounds.width, bounds.height, shotPath);
    const sx = camera.scale, sy = camera.scale;
    ctx.setTransform(1,0,0,1,0,0);
    ctx.clearRect(0,0,width,height);
    ctx.setTransform(density * sx,0,0,density * sy,density * camera.x,density * camera.y);
    ctx.fillStyle='#695f59';ctx.beginPath();ctx.moveTo(0,280);
    for(let x=0;x<=1000;x+=10)ctx.lineTo(x,Math.max(55,ground[x]-38));
    ctx.lineTo(1000,280);ctx.fill();
    const soil=ctx.createLinearGradient(0,110,0,280);soil.addColorStop(0,'#b99362');soil.addColorStop(1,'#57432f');
    ctx.fillStyle=soil;ctx.beginPath();ctx.moveTo(0,280);ground.forEach((y,x)=>ctx.lineTo(x,y));ctx.lineTo(1000,280);ctx.closePath();ctx.fill();
    ctx.strokeStyle='#dac099';ctx.lineWidth=2;ctx.beginPath();ground.forEach((y,x)=>x?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();
    for (const [index,x] of (state.positions || [85,915]).entries()) {
      const y=ground[x], color=index===0?'#6ddbd0':'#ffb86a';
      const angle=(index===state.you?Number($('angle').value):state.angles[index])*Math.PI/180;
      ctx.save();ctx.translate(x,y);ctx.scale(1/sx,1/sy);
      ctx.fillStyle='#20282c';ctx.fillRect(-18,-8,36,8);
      ctx.fillStyle=color;ctx.fillRect(-15,-17,30,11);ctx.beginPath();ctx.arc(0,-15,8,Math.PI,0);ctx.fill();
      ctx.strokeStyle=color;ctx.lineWidth=5;ctx.beginPath();ctx.moveTo(0,-12);ctx.lineTo(Math.cos(angle)*25,-12-Math.sin(angle)*25);ctx.stroke();
      if(index===state.turn&&!state.finished){ctx.fillStyle='#fff';ctx.beginPath();ctx.moveTo(0,-43);ctx.lineTo(-5,-50);ctx.lineTo(5,-50);ctx.fill();}
      ctx.restore();ctx.save();ctx.setTransform(density,0,0,density,0,0);
      ctx.font='bold 12px system-ui';ctx.textAlign=index===0?'left':'right';
      ctx.fillStyle=color;ctx.shadowColor='#172129';ctx.shadowBlur=4;ctx.fillText(state.names[index].slice(0,24),index===0?16:bounds.width-16,22);ctx.restore();
    }
    if(projectile){ctx.save();ctx.translate(...projectile);ctx.scale(1/sx,1/sy);ctx.fillStyle='#fff2af';ctx.shadowBlur=12;ctx.shadowColor='#ffc65b';ctx.beginPath();ctx.arc(0,0,4,0,Math.PI*2);ctx.fill();ctx.restore();}
  }
  new ResizeObserver(()=>draw(visibleGround || state?.ground, visibleProjectile)).observe(canvas);
  function move(direction) {
    if (state && !state.finished && !animating && state.turn===state.you && state.fuel>0) send('move',{direction,round:state.round});
  }
  for (const [name,direction] of [['left',-1],['right',1]]) {
    $(name).onpointerdown = event => {
      if (event.button!==0 || $(name).disabled) return;
      stopMoving();move(direction);moveTimer=setInterval(()=>move(direction),100);
    };
    $(name).onclick = event => { if(event.detail===0)move(direction); };
  }
  window.addEventListener('pointerup',stopMoving);
  window.addEventListener('pointercancel',stopMoving);
  window.addEventListener('blur',stopMoving);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stopMoving();});
  document.addEventListener('keydown',event=>{
    if(panel.hidden || !state || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,textarea,select,[contenteditable="true"]'))return;
    const direction=event.key.toLowerCase()==='a'?-1:event.key.toLowerCase()==='d'?1:0;
    if(direction && !animating && !state.finished && state.turn===state.you){event.preventDefault();move(direction);}
  });
  for(const name of ['angle','power']) $(name).oninput=()=>{
    $(name+'-value').textContent=$(name).value+(name==='angle'?'°':'');draw();
    if(name==='angle' && !aimTimer) aimTimer=setTimeout(()=>{
      aimTimer=null;
      if(state && !state.finished && !animating && state.turn===state.you) send('aim',{angle:Number($('angle').value),round:state.round});
    },50);
  };
  $('sound').onclick=()=>{muted=!muted;$('sound').textContent=muted?'Sound off':'Sound on';$('sound').setAttribute('aria-pressed',String(!muted));};
  $('accept').onclick=()=>{if(send('accept'))$('accept').disabled=true;};
  $('decline').onclick=()=>send('decline');
  $('close').onclick=()=>{if(id&&!state?.finished)send('leave');stop();id=null;state=null;panel.hidden=true;};
  $('fire').onclick=()=>{
    if(!state||animating||state.finished||state.turn!==state.you)return;
    if(send('fire',{angle:Number($('angle').value),power:Number($('power').value),round:state.round})){animating=true;controls();}
  };
  return {
    challenge(target) { if(send('challenge',{target}))sound('invite'); },
    disconnect() { stop(); if(!panel.hidden){$('status').textContent='Connection closed. Duel ended.';$('game').hidden=true;$('invite').hidden=true;}id=null;state=null; },
    receive(message) {
      if(message.event==='moved') {
        if(!state || state.finished || message.id!==id || message.round!==state.round || animating)return;
        state.positions=message.positions;state.fuel=message.fuel;controls();draw();return;
      }
      if(message.event==='aim') {
        if(!state || state.finished || message.id!==id || message.round!==state.round || message.player===state.you)return;
        state.angles[message.player]=message.angle;
        if(!animating)draw();
        return;
      }
      if(message.event==='error'){notify(message.reason,true);animating=false;controls();return;}
      if(message.event==='ended') {
        if(id!==message.id)return;stop();id=null;state=null;$('status').textContent=message.reason;$('game').hidden=true;$('invite').hidden=true;return;
      }
      if(message.event==='waiting'||message.event==='invited') {
        stop();state=null;id=message.id;panel.hidden=false;$('game').hidden=true;$('invite').hidden=false;
        const incoming=message.event==='invited';$('status').textContent=incoming?'Duel challenge':'Challenge sent';
        $('invite-text').textContent=incoming?message.name+' challenges you to a tank duel. Random desert terrain, take turns, first hit wins.': 'Waiting for '+message.name+' to accept… (30 seconds)';
        $('accept').hidden=!incoming;$('accept').disabled=false;$('decline').textContent=incoming?'Decline':'Cancel';sound('invite');return;
      }
      if(message.event!=='state')return;
      const previous=state?.ground;const fresh=id!==message.id||!state;stop();id=message.id;state=message;
      panel.hidden=false;$('invite').hidden=true;$('game').hidden=false;
      if(fresh){$('angle').value=state.you===0?45:135;$('angle-value').textContent=$('angle').value+'°';}
      $('side').textContent=state.you===0?'You: teal tank (left)':'You: amber tank (right)';
      if(message.shot){
        animating=true;shotPath=message.shot.path;controls();sound('fire');const started=performance.now();
        const animate=now=>{
          const progress=Math.min(1,(now-started)/1400), points=message.shot.path;
          draw(previous,points[Math.min(points.length-1,Math.floor(progress*(points.length-1)))]);
          if(progress<1)frame=requestAnimationFrame(animate);
          else{draw();if(message.shot.impact){ctx.save();ctx.translate(...message.shot.impact);const bounds=canvas.getBoundingClientRect(),camera=tankCamera(bounds.width,bounds.height,shotPath);ctx.scale(1/camera.scale,1/camera.scale);ctx.strokeStyle='#ffdf90';ctx.lineWidth=5;ctx.beginPath();ctx.arc(0,0,24,0,Math.PI*2);ctx.stroke();ctx.restore();}timer=setTimeout(()=>{animating=false;shotPath=[];controls();draw();if(state.finished)sound('win');},350);}
        };frame=requestAnimationFrame(animate);
      }else{controls();draw();}
    }
  };
}
