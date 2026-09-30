import test from 'node:test';
import assert from 'node:assert/strict';
import { terrain, fireShot, moveTank, tankPose, MOVE_FUEL } from '../shared/tank-game.js';
import { createDuels } from '../server-duels.js';

test('random terrain stays in bounds and tanks can hit each other', () => {
  assert.notDeepEqual(terrain(),terrain());
  for(let n=0;n<8;n++) {
    const ground=terrain();
    assert.equal(ground.length,1001);
    assert.ok(ground.every(y=>y>=100&&y<=250));
    for(const player of [0,1]) {
      let hit=false;
      for(let angle=25;angle<=80&&!hit;angle+=2) for(let power=60;power<=100&&!hit;power++) {
        hit=fireShot(ground,player,player===0?angle:180-angle,power).hit===1-player;
      }
      assert.ok(hit,'Each tank has a viable shot over the hills');
    }
  }
});

test('duels require consent, enforce turns and shot validation, and end on disconnect', () => {
  const make=(name)=>({name,peerId:name,readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw));}});
  const a=make('Alice'),b=make('Bob'),c=make('Other'),clients=new Set([a,b]);
  const duels=createDuels();
  duels.handle(a,{action:'challenge',target:'Other'},clients);
  assert.equal(a.messages.at(-1).event,'error');
  duels.handle(a,{action:'challenge',target:'Bob'},clients);
  const id=a.messages.at(-1).id;
  assert.equal(b.messages.at(-1).event,'invited');
  duels.handle(a,{action:'accept',id},clients);
  assert.equal(a.messages.at(-1).event,'error');
  duels.handle(c,{action:'accept',id},clients);
  assert.equal(c.messages.at(-1).event,'error');
  duels.handle(b,{action:'accept',id},clients);
  const state=a.messages.at(-1), shooter=[a,b][state.turn], other=[b,a][state.turn];
  assert.deepEqual(state.ground,b.messages.at(-1).ground);
  const initial=shooter.messages.length;
  for(const [client,round,direction] of [[other,0,1],[shooter,99,1],[shooter,0,100]])duels.handle(client,{action:'move',id,round,direction},clients);
  assert.equal(shooter.messages.length,initial);
  duels.handle(shooter,{action:'move',id,round:0,direction:1},clients);
  assert.equal(shooter.messages.at(-1).event,'moved');
  assert.equal(shooter.messages.at(-1).positions[state.turn],state.positions[state.turn]+6);
  assert.equal(shooter.messages.at(-1).fuel,MOVE_FUEL-6);
  assert.deepEqual(shooter.messages.at(-1),other.messages.at(-1));
  const count=shooter.messages.length;
  duels.handle(other,{action:'aim',id,round:0,angle:80},clients);
  assert.equal(shooter.messages.length,count);
  duels.handle(shooter,{action:'aim',id,round:0,angle:80},clients);
  assert.deepEqual(other.messages.at(-1),{type:'duel',event:'aim',id,round:0,player:state.turn,angle:80});
  const received=other.messages.length;
  for(const angle of [NaN,0,180,'80'])duels.handle(shooter,{action:'aim',id,round:0,angle},clients);
  duels.handle(shooter,{action:'aim',id,round:99,angle:70},clients);
  assert.equal(other.messages.length,received);
  duels.handle(other,{action:'fire',id,round:0,angle:45,power:60},clients);
  assert.equal(other.messages.at(-1).event,'error');
  duels.handle(shooter,{action:'fire',id,round:0,angle:NaN,power:60},clients);
  assert.equal(shooter.messages.at(-1).event,'error');
  duels.handle(shooter,{action:'fire',id,round:0,angle:state.turn===0?5:175,power:10},clients);
  assert.equal(a.messages.at(-1).round,1);
  assert.equal(a.messages.at(-1).fuel,MOVE_FUEL);
  assert.deepEqual(a.messages.at(-1).shot,b.messages.at(-1).shot);
  const afterShot=other.messages.length;
  duels.handle(other,{action:'move',id,round:1,direction:1},clients);
  assert.equal(other.messages.length,afterShot);
  duels.handle(other,{action:'fire',id,round:1,angle:45,power:60},clients);
  assert.equal(other.messages.at(-1).event,'error');
  duels.disconnect(a);
  assert.equal(b.messages.at(-1).event,'ended');
  duels.handle(b,{action:'challenge',target:'Alice'},clients);
  assert.equal(a.messages.at(-1).event,'invited');
  duels.handle(a,{action:'decline',id:a.messages.at(-1).id},clients);
  assert.equal(b.messages.at(-1).event,'ended');
});

test('movement spends limited fuel, respects terrain, boundaries and tank separation',()=>{
  const ground=Array(1001).fill(200),positions=[85,915];
  let fuel=MOVE_FUEL;
  for(let i=0;i<20;i++){const result=moveTank(ground,positions,0,1,fuel);positions[0]=result.x;fuel=result.fuel;}
  assert.equal(positions[0],145);assert.equal(fuel,0);
  assert.deepEqual(moveTank(ground,[24,915],0,-1,60),{x:24,fuel:60});
  assert.deepEqual(moveTank(ground,[873,915],0,1,60),{x:873,fuel:60});
  ground[86]=220;
  assert.deepEqual(moveTank(ground,[85,915],0,1,60),{x:85,fuel:60});
  const gentle=ground.map((_,x)=>200+Math.floor(x/4));
  assert.equal(moveTank(gentle,[85,915],0,1,60).x,91);
  const moved=[200,800], shot=fireShot(Array(1001).fill(200),0,5,10,moved);
  assert.ok(shot.path[0][0]>200&&shot.path[0][0]<225);
  let hit=false;
  for(let angle=25;angle<80&&!hit;angle++)for(let power=40;power<=100&&!hit;power++)hit=fireShot(Array(1001).fill(200),0,angle,power,moved).hit===1;
  assert.ok(hit,'Shots can hit the relocated opponent');
});

test('a direct hit ends the match and a new accepted match gets fresh terrain', () => {
  const make=name=>({name,peerId:name,readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw));}});
  const a=make('Alice'),b=make('Bob'),clients=new Set([a,b]),duels=createDuels();
  duels.handle(a,{action:'challenge',target:'Bob'},clients);
  const id=b.messages.at(-1).id;
  duels.handle(b,{action:'accept',id},clients);
  const state=a.messages.at(-1);
  let solution;
  for(let angle=25;angle<=80&&!solution;angle++) for(let power=60;power<=100&&!solution;power++) {
    const aim=state.turn===0?angle:180-angle;
    if(fireShot(state.ground,state.turn,aim,power).hit===1-state.turn)solution={angle:aim,power};
  }
  assert.ok(solution);
  duels.handle([a,b][state.turn],{action:'fire',id,round:0,...solution},clients);
  assert.equal(a.messages.at(-1).finished,true);
  assert.equal(a.messages.at(-1).winner,state.turn);
  assert.equal(b.messages.at(-1).winner,state.turn);
  duels.handle(b,{action:'challenge',target:'Alice'},clients);
  const nextId=a.messages.at(-1).id;
  duels.handle(a,{action:'accept',id:nextId},clients);
  assert.notDeepEqual(a.messages.at(-1).ground,state.ground);
  duels.disconnect(a);
});

test('tracks climb slopes through 80 degrees in either direction but reject steeper slopes and cliffs',()=>{
  for(const direction of [-1,1]){
    for(const angle of [45,60,75,79.9,80,80.5,85,89]){
      const rise=Math.tan(angle*Math.PI/180);
      const slope=Array.from({length:1001},(_,x)=>200-Math.max(-16,Math.min(16,x-500))*rise);
      for(const player of [0,1]){
        const positions=player===0?[500,915]:[85,500];
        assert.deepEqual(moveTank(slope,positions,player,direction,60),
          angle<=80?{x:500+direction*6,fuel:54}:{x:500,fuel:60},
          `${angle} degree slope, tank ${player}, direction ${direction}`);
      }
    }
  }
  const pile=Array.from({length:1001},(_,x)=>200-Math.max(0,30-Math.abs(x-120)));
  const positions=[85,915];let fuel=60;
  while(fuel>0){const result=moveTank(pile,positions,0,1,fuel);assert.ok(result.fuel<fuel);positions[0]=result.x;fuel=result.fuel;}
  assert.equal(positions[0],145);
  const ledge=Array.from({length:1001},(_,x)=>x<86?200:195);
  assert.deepEqual(moveTank(ledge,[85,915],0,1,60),{x:91,fuel:54});
  for(const height of [180,220]){
    const cliff=Array.from({length:1001},(_,x)=>x<86?200:height);
    assert.deepEqual(moveTank(cliff,[85,915],0,1,60),{x:85,fuel:60});
  }
  const pose=tankPose(pile,100.5);
  assert.ok(Number.isFinite(pose.y)&&Number.isFinite(pose.angle),'Interpolated drawing positions have a valid terrain pose');
});

test('starting platforms blend into hills without trapping either tank',()=>{
  for(let n=0;n<20;n++){
    const ground=terrain(()=>n/20);
    for(const player of [0,1]){
      const positions=[85,915],direction=player===0?1:-1;let fuel=MOVE_FUEL;
      while(fuel>0){const moved=moveTank(ground,positions,player,direction,fuel);assert.ok(moved.fuel<fuel,'A spawn platform must be climbable');positions[player]=moved.x;fuel=moved.fuel;}
    }
  }
});


test('shield blocks a lethal hit without a crater and leaves misses alone',()=>{
  const ground=Array(1001).fill(200),positions=[85,915];
  let aim;
  for(let angle=25;angle<=80&&!aim;angle++)for(let power=60;power<=100&&!aim;power++)
    if(fireShot(ground,0,angle,power,positions).hit===1)aim={angle,power};
  assert.ok(aim);
  const blocked=fireShot(ground,0,aim.angle,aim.power,positions,[false,true]);
  assert.equal(blocked.hit,null);assert.equal(blocked.deflected,1);
  assert.deepEqual(blocked.ground,ground);
  assert.equal(fireShot(ground,0,5,10,positions,[true,true]).deflected,undefined);
  assert.equal(fireShot(ground,0,aim.angle,aim.power,positions,[false,false]).hit,1);
});

for (const outcome of ['hit','miss']) test(`online shield expires after one opponent ${outcome} and cannot be reused`,t=>{
  let now=100000;t.mock.method(Date,'now',()=>now);
  const make=name=>({name,peerId:name,readyState:1,messages:[],send(raw){this.messages.push(JSON.parse(raw));}});
  const players=[make('Alice'),make('Bob')],clients=new Set(players),duels=createDuels();
  const begin=()=>{
    duels.handle(players[0],{action:'challenge',target:'Bob'},clients);
    const id=players[0].messages.at(-1).id;
    duels.handle(players[1],{action:'accept',id},clients);return id;
  };
  const id=begin(),initial=players[0].messages.at(-1),attacker=initial.turn,defender=1-attacker;
  const shield=(player,round)=>duels.handle(players[player],{action:'shield',id,round},clients);
  const count=players[0].messages.length;
  shield(attacker,0);shield(defender,99);
  assert.equal(players[0].messages.length,count);
  shield(defender,0);
  assert.deepEqual(players[0].messages.at(-1),players[1].messages.at(-1));
  assert.equal(players[0].messages.at(-1).shields[defender],true);
  const activated=players[0].messages.length;shield(defender,0);
  assert.equal(players[0].messages.length,activated);
  let aim={angle:attacker===0?5:175,power:10};
  if(outcome==='hit'){
    aim=null;
    for(let angle=5;angle<=175&&!aim;angle++)for(let power=10;power<=100&&!aim;power++)
      if(fireShot(initial.ground,attacker,angle,power,initial.positions).hit===defender)aim={angle,power};
    assert.ok(aim);
  }
  duels.handle(players[attacker],{action:'fire',id,round:0,...aim},clients);
  let state=players[0].messages.at(-1);
  assert.equal(state.shot.deflected,outcome==='hit'?defender:undefined);
  assert.equal(state.finished,false);assert.deepEqual(state.shields,[false,false]);
  assert.equal(state.shieldUsed[defender],true);
  const inFlight=players[0].messages.length;shield(attacker,1);
  assert.equal(players[0].messages.length,inFlight);
  now+=2000;
  duels.handle(players[defender],{action:'fire',id,round:1,angle:defender===0?5:175,power:10},clients);
  now+=2000;const spent=players[0].messages.length;shield(defender,2);
  assert.equal(players[0].messages.length,spent);
  duels.handle(players[defender],{action:'leave',id},clients);
  now+=10000;const next=begin();
  assert.deepEqual(players[0].messages.at(-1).shieldUsed,[false,false]);
  assert.deepEqual(players[0].messages.at(-1).shields,[false,false]);
  duels.handle(players[0],{action:'leave',id:next},clients);
});
