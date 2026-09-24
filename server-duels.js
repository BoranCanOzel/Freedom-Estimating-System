import { randomUUID } from 'node:crypto';
import { terrain, fireShot } from './shared/tank-game.js';

export function createDuels() {
  const active = new Map();
  const send = (ws, value) => { if (ws.readyState === 1) ws.send(JSON.stringify({type:'duel', ...value})); };
  function finish(game, reason) {
    clearTimeout(game.timer);
    for (const ws of game.players) { active.delete(ws); send(ws, {event:'ended', id:game.id, reason}); }
  }
  function publish(game, extra = {}) {
    game.players.forEach((ws, index) => send(ws, {event:'state', id:game.id, you:index,
      names:game.players.map(p=>p.name), ground:game.ground, angles:game.angles, turn:game.turn, round:game.round, ...extra}));
  }
  function handle(ws, msg, clients) {
    const error = reason => send(ws, {event:'error', reason});
    let game = active.get(ws);
    if (msg.action === 'challenge') {
      const target = [...clients].find(p=>p.peerId === msg.target);
      if (!target || target === ws || target.name === ws.name) return error('Choose another online player.');
      if (game || active.has(target)) return error('One of you already has a duel or invitation open.');
      if (Date.now() - (ws.lastChallenge || 0) < 10000) return error('Wait a few seconds before sending another challenge.');
      ws.lastChallenge = Date.now();
      game = {id:randomUUID(), players:[ws,target], phase:'invited'};
      game.timer = setTimeout(()=>finish(game, 'Challenge expired.'), 30000);
      game.timer.unref();
      active.set(ws,game); active.set(target,game);
      send(ws,{event:'waiting',id:game.id,name:target.name});
      send(target,{event:'invited',id:game.id,name:ws.name});
      return;
    }
    if (!game || msg.id !== game.id) return error('This duel has ended.');
    if (msg.action === 'leave' || msg.action === 'decline') return finish(game, game.phase === 'invited' ? 'Challenge cancelled or declined.' : ws.name + ' left the duel.');
    if (msg.action === 'accept') {
      if (game.phase !== 'invited' || ws !== game.players[1]) return error('This invitation cannot be accepted.');
      clearTimeout(game.timer); game.phase = 'playing'; game.ground = terrain();
      game.turn = Math.random() < .5 ? 0 : 1; game.round = 0; game.angles = [45,135];
      publish(game); return;
    }
    if (msg.action === 'aim') {
      if (game.phase !== 'playing' || game.players[game.turn] !== ws || msg.round !== game.round || Date.now() < (game.nextShot || 0)) return;
      if (!Number.isFinite(msg.angle) || msg.angle < 5 || msg.angle > 175) return;
      if (game.angles[game.turn] === msg.angle) return;
      game.angles[game.turn] = msg.angle;
      send(game.players[1-game.turn], {event:'aim', id:game.id, round:game.round, player:game.turn, angle:msg.angle});
      return;
    }
    if (msg.action !== 'fire') return;
    if (game.phase !== 'playing' || game.players[game.turn] !== ws || Date.now() < (game.nextShot || 0) || msg.round !== game.round) return error('Wait for your turn.');
    if (!Number.isFinite(msg.angle) || msg.angle < 5 || msg.angle > 175 || !Number.isFinite(msg.power) || msg.power < 10 || msg.power > 100) return error('Choose a valid angle and power.');
    const shot = fireShot(game.ground, game.turn, msg.angle, msg.power);
    game.angles[game.turn] = msg.angle;
    game.ground = shot.ground; game.round++; game.turn = 1 - game.turn; game.nextShot = Date.now() + 1700;
    const winner = shot.hit === null ? null : 1 - shot.hit;
    const finished = winner !== null || game.round >= 60;
    publish(game, {shot:{path:shot.path,impact:shot.impact}, winner, finished});
    if (finished) for (const player of game.players) active.delete(player);
  }
  return { handle, disconnect(ws) { const game = active.get(ws); if (game) finish(game, ws.name + ' disconnected. Duel ended.'); } };
}
