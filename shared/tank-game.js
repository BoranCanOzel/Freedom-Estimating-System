export const WIDTH = 1000, HEIGHT = 280;

export function terrain(random = Math.random) {
  const phase = random() * 6.28, phase2 = random() * 6.28;
  const hills = 2 + random() * 2, ridges = 5 + random() * 3;
  const ground = Array.from({length: WIDTH + 1}, (_, x) => Math.round(185 + 36 * Math.sin(x / WIDTH * hills * Math.PI + phase) + 17 * Math.sin(x / WIDTH * ridges * Math.PI + phase2)));
  for (const x of [85, 915]) for (let i = x - 23; i <= x + 23; i++) ground[i] = ground[x];
  return ground;
}

export function fireShot(ground, player, angle, power) {
  const x0 = player === 0 ? 85 : 915, y0 = ground[x0] - 12;
  const radians = angle * Math.PI / 180;
  let x = x0 + Math.cos(radians) * 24, y = y0 - Math.sin(radians) * 24;
  const vx = Math.cos(radians) * power * 5;
  let vy = -Math.sin(radians) * power * 5;
  const path = [[x, y]];
  let hit = null, impact = null;
  for (let i = 0; i < 800; i++) {
    x += vx * .025; y += vy * .025; vy += 200 * .025;
    path.push([Math.round(x * 10) / 10, Math.round(y * 10) / 10]);
    if (x < 0 || x > WIDTH || y > HEIGHT) break;
    for (const [index, tx] of [85, 915].entries()) {
      if (Math.hypot(x - tx, y - (ground[tx] - 8)) < 18) { hit = index; impact = [x, y]; break; }
    }
    if (impact) break;
    if (y >= ground[Math.round(x)]) {
      impact = [x, y];
      for (const [index, tx] of [85, 915].entries()) if (Math.hypot(x - tx, y - ground[tx]) < 28) hit = index;
      break;
    }
  }
  const next = [...ground];
  if (impact) for (let i = Math.max(0, Math.floor(x - 25)); i <= Math.min(WIDTH, Math.ceil(x + 25)); i++) {
    next[i] = Math.min(HEIGHT - 8, Math.max(next[i], y + Math.sqrt(Math.max(0, 625 - (i - x) ** 2))));
  }
  return {path, ground: next, hit, impact};
}
