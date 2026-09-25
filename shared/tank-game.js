export const WIDTH = 1000, HEIGHT = 280;
export const MOVE_FUEL = 60, MOVE_STEP = 6;

export function moveTank(ground, positions, player, direction, fuel) {
  let x = positions[player], used = 0;
  for (let step = 0; step < Math.min(MOVE_STEP, fuel); step++) {
    const next = x + direction;
    if (next < 24 || next > WIDTH - 24 || Math.abs(next - positions[1-player]) < 42) break;
    // Reject sharp crater edges and slopes steeper than the tank can climb.
    if (Math.abs(ground[next] - ground[x]) > 1 || Math.abs(ground[next+12] - ground[next-12]) > 12) break;
    x = next; used++;
  }
  return {x, fuel: fuel - used};
}

export function terrain(random = Math.random) {
  const phase = random() * 6.28, phase2 = random() * 6.28;
  const hills = 2 + random() * 2, ridges = 5 + random() * 3;
  const ground = Array.from({length: WIDTH + 1}, (_, x) => Math.round(185 + 36 * Math.sin(x / WIDTH * hills * Math.PI + phase) + 17 * Math.sin(x / WIDTH * ridges * Math.PI + phase2)));
  for (const x of [85, 915]) for (let i = x - 23; i <= x + 23; i++) ground[i] = ground[x];
  return ground;
}

export function fireShot(ground, player, angle, power, positions = [85,915]) {
  const x0 = positions[player], y0 = ground[x0] - 12;
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
    for (const [index, tx] of positions.entries()) {
      if (Math.hypot(x - tx, y - (ground[tx] - 8)) < 18) { hit = index; impact = [x, y]; break; }
    }
    if (impact) break;
    if (y >= ground[Math.round(x)]) {
      impact = [x, y];
      for (const [index, tx] of positions.entries()) if (Math.hypot(x - tx, y - ground[tx]) < 28) hit = index;
      break;
    }
  }
  const next = [...ground];
  if (impact) for (let i = Math.max(0, Math.floor(x - 25)); i <= Math.min(WIDTH, Math.ceil(x + 25)); i++) {
    next[i] = Math.min(HEIGHT - 8, Math.max(next[i], y + Math.sqrt(Math.max(0, 625 - (i - x) ** 2))));
  }
  return {path, ground: next, hit, impact};
}
