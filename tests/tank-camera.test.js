import test from 'node:test';
import assert from 'node:assert/strict';
import {tankCamera} from '../client/tank-camera.js';
import {terrain, fireShot} from '../shared/tank-game.js';

test('camera keeps maximum-power high arcs visible across viewport sizes',()=>{
  for(const [width,height] of [[1920,850],[1100,600],[390,500]]){
    for(const player of [0,1])for(const angle of [5,45,70,90,110,135,175]){
      const {path}=fireShot(terrain(()=>.5),player,angle,100);
      const camera=tankCamera(width,height,path);
      for(const [x,y] of path){
        const px=x*camera.scale+camera.x,py=y*camera.scale+camera.y;
        assert.ok(px>=0&&px<=width&&py>=0&&py<=height,`${width}x${height}: ${px},${py}`);
      }
      for(const x of [85,915])assert.ok(x*camera.scale+camera.x>=0&&x*camera.scale+camera.x<=width);
    }
  }
});
