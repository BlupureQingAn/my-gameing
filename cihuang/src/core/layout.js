export function fitWorld(viewW, viewH, W, H) {
  const scale = Math.min(viewW / W, viewH / H);
  return {
    scale,
    x: Math.round((viewW - W * scale) / 2),
    y: Math.round((viewH - H * scale) / 2),
  };
}
