export function tankCamera(width, height, path = []) {
  const top = Math.min(0, ...path.map(point => point[1] - 60));
  const left = Math.min(0, ...path.map(point => point[0] - 12));
  const right = Math.max(1000, ...path.map(point => point[0] + 12));
  const bottom = Math.max(280, ...path.map(point => point[1] + 12));
  const scale = Math.min(width / (right - left), height / (bottom - top));
  return {scale, x: (width - (right - left) * scale) / 2 - left * scale, y: height - bottom * scale};
}
