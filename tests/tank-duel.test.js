import test from 'node:test';
import assert from 'node:assert/strict';
import { terrain, fireShot } from '../shared/tank-game.js';
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
  assert.deepEqual(a.messages.at(-1).shot,b.messages.at(-1).shot);
  duels.handle(other,{action:'fire',id,round:1,angle:45,power:60},clients);
  assert.equal(other.messages.at(-1).event,'error');
  duels.disconnect(a);
  assert.equal(b.messages.at(-1).event,'ended');
  duels.handle(b,{action:'challenge',target:'Alice'},clients);
  assert.equal(a.messages.at(-1).event,'invited');
  duels.handle(a,{action:'decline',id:a.messages.at(-1).id},clients);
  assert.equal(b.messages.at(-1).event,'ended');
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
