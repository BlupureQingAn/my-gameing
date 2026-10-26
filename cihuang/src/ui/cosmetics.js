// 装扮皮肤的程序化绘制。TableView 与装扮预览共用同一套函数，保证预览即局内效果。

import { Container, Graphics } from "pixi.js";

// 确定性伪随机：同一款皮肤每次绘制出的碎屑/苔斑位置一致
function rand(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function shade(color, factor) {
  const r = Math.min(255, Math.round(((color >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((color >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((color & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}

/* ---------------- 牌背 ---------------- */

function cardBackPattern(g, item, w, h) {
  const accent = item.accent;
  const cx = 0;
  const cy = 0;
  const innerW = w - 20;
  const innerH = h - 20;

  if (item.id === "cb_moss") {
    // 青苔暗纹：对称藤蔓 + 叶片 + 苔斑
    const rnd = rand(931);
    for (let i = 0; i < 26; i += 1) {
      const x = cx + (rnd() - 0.5) * innerW;
      const y = cy + (rnd() - 0.5) * innerH;
      g.ellipse(x, y, 2 + rnd() * 5, 1.5 + rnd() * 3).fill({ color: accent, alpha: 0.07 + rnd() * 0.08 });
    }
    for (const dir of [-1, 1]) {
      g.moveTo(cx + dir * 30, cy + 48);
      g.quadraticCurveTo(cx + dir * 8, cy + 20, cx + dir * 22, cy - 6);
      g.quadraticCurveTo(cx + dir * 34, cy - 28, cx + dir * 14, cy - 48);
      g.stroke({ width: 1.4, color: accent, alpha: 0.55 });
      for (let i = 0; i < 5; i += 1) {
        const t = i / 4;
        const y = cy + 40 - t * 84;
        const x = cx + dir * (30 - t * 14);
        g.ellipse(x + dir * 6, y, 4.5, 2.2).fill({ color: accent, alpha: 0.35 });
      }
    }
    g.circle(cx, cy, 9).stroke({ width: 1, color: accent, alpha: 0.4 });
    g.circle(cx, cy, 3).fill({ color: accent, alpha: 0.5 });
    return;
  }

  if (item.id === "cb_gold") {
    // 烫金残页：撕裂纸片 + 金箔碎屑 + 角花
    const rnd = rand(4217);
    g.moveTo(cx - 26, cy - 34);
    g.lineTo(cx + 18, cy - 38);
    g.lineTo(cx + 27, cy - 12);
    g.lineTo(cx + 22, cy + 30);
    g.lineTo(cx - 6, cy + 38);
    g.lineTo(cx - 27, cy + 18);
    g.closePath();
    g.fill({ color: accent, alpha: 0.16 });
    g.stroke({ width: 1.2, color: accent, alpha: 0.75 });
    // 撕裂边缘
    for (let i = 0; i < 7; i += 1) {
      const y = cy - 32 + i * 10;
      g.moveTo(cx + 18 + rnd() * 6, y).lineTo(cx + 24 + rnd() * 5, y + 5);
      g.stroke({ width: 1, color: accent, alpha: 0.5 });
    }
    // 残页文字线（不可读的烫印）
    for (let i = 0; i < 4; i += 1) {
      const y = cy - 18 + i * 12;
      g.moveTo(cx - 15, y).lineTo(cx - 15 + 22 + rnd() * 14, y);
      g.stroke({ width: 1.6, color: accent, alpha: 0.32 });
    }
    // 金箔碎屑
    for (let i = 0; i < 18; i += 1) {
      const x = cx + (rnd() - 0.5) * (innerW - 4);
      const y = cy + (rnd() - 0.5) * (innerH - 4);
      const s = 1 + rnd() * 2.4;
      g.rect(x, y, s, s * (0.6 + rnd())).fill({ color: accent, alpha: 0.25 + rnd() * 0.45 });
    }
    // 四角烫印角花
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        g.moveTo(cx + sx * (innerW / 2 - 4), cy + sy * (innerH / 2 - 16));
        g.quadraticCurveTo(cx + sx * (innerW / 2 - 12), cy + sy * (innerH / 2 - 4), cx + sx * (innerW / 2 - 26), cy + sy * (innerH / 2 - 6));
        g.stroke({ width: 1.6, color: accent, alpha: 0.7 });
      }
    }
    return;
  }

  // 酒红罗盘：刻度盘 + 四向指针 + 角部菱形
  g.circle(cx, cy, Math.min(innerW, innerH) * 0.24).stroke({ width: 1.4, color: accent, alpha: 0.7 });
  g.circle(cx, cy, Math.min(innerW, innerH) * 0.17).stroke({ width: 0.8, color: accent, alpha: 0.4 });
  const rOuter = Math.min(innerW, innerH) * 0.31;
  for (let i = 0; i < 24; i += 1) {
    const angle = (i / 24) * Math.PI * 2;
    const long = i % 6 === 0;
    const r1 = rOuter;
    const r2 = rOuter - (long ? 8 : 4);
    g.moveTo(cx + Math.cos(angle) * r1, cy + Math.sin(angle) * r1);
    g.lineTo(cx + Math.cos(angle) * r2, cy + Math.sin(angle) * r2);
    g.stroke({ width: long ? 1.6 : 0.9, color: accent, alpha: long ? 0.85 : 0.4 });
  }
  for (let i = 0; i < 4; i += 1) {
    const angle = (i / 4) * Math.PI * 2 - Math.PI / 2;
    const tip = rOuter - 2;
    const side = 5;
    const bx = cx + Math.cos(angle) * 6;
    const by = cy + Math.sin(angle) * 6;
    const px = cx + Math.cos(angle) * tip;
    const py = cy + Math.sin(angle) * tip;
    const ox = Math.cos(angle + Math.PI / 2) * side;
    const oy = Math.sin(angle + Math.PI / 2) * side;
    g.moveTo(px, py).lineTo(bx + ox, by + oy).lineTo(bx - ox, by - oy).closePath();
    g.fill({ color: accent, alpha: i === 0 ? 0.85 : 0.45 });
  }
  g.circle(cx, cy, 2.6).fill({ color: accent, alpha: 0.9 });
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = cx + sx * (innerW / 2 - 8);
      const y = cy + sy * (innerH / 2 - 10);
      g.moveTo(x, y - 4).lineTo(x + 4, y).lineTo(x, y + 4).lineTo(x - 4, y).closePath();
      g.fill({ color: accent, alpha: 0.35 });
    }
  }
}

export function buildCardBack(item, w = 96, h = 136) {
  const root = new Container();
  const base = new Graphics();
  base.roundRect(-w / 2, -h / 2, w, h, 7).fill({ color: 0x120d0b });
  root.addChild(base);
  const body = new Graphics();
  body.roundRect(-w / 2 + 3, -h / 2 + 3, w - 6, h - 6, 5).fill({ color: item.color });
  // 底部斜纹织物
  for (let x = -w / 2 + 4; x < w / 2 - 4; x += 7) {
    body.moveTo(x, -h / 2 + 4).lineTo(x + h - 8, h / 2 - 4);
    body.stroke({ width: 1, color: shade(item.color, 1.35), alpha: 0.12 });
  }
  body.roundRect(-w / 2 + 6, -h / 2 + 6, w - 12, h - 12, 4)
    .stroke({ width: 1.2, color: item.accent, alpha: 0.55 });
  body.roundRect(-w / 2 + 9, -h / 2 + 9, w - 18, h - 18, 3)
    .stroke({ width: 0.7, color: item.accent, alpha: 0.28 });
  cardBackPattern(body, item, w, h);
  root.addChild(body);
  return root;
}

/* ---------------- 桌布 ---------------- */

export function buildFeltPattern(item, t) {
  const g = new Graphics();
  const accent = item.accent;
  const rx = t.rx - 26;
  const ry = t.ry - 21;

  if (item.id === "felt_ink") {
    // 深海墨蓝：同心波纹 + 鳞片阵列 + 中央锚徽
    for (let i = 1; i <= 4; i += 1) {
      g.ellipse(t.cx, t.cy, rx * (0.25 + i * 0.18), ry * (0.25 + i * 0.18))
        .stroke({ width: 1, color: accent, alpha: 0.09 });
    }
    for (let row = 0; row < 6; row += 1) {
      for (let col = 0; col < 14; col += 1) {
        const x = t.cx - rx * 0.82 + col * 46 + (row % 2) * 23;
        const y = t.cy - ry * 0.66 + row * 38;
        const dx = (x - t.cx) / rx;
        const dy = (y - t.cy) / ry;
        if (dx * dx + dy * dy > 0.78) continue;
        g.arc(x, y, 9, Math.PI, Math.PI * 2).stroke({ width: 0.8, color: accent, alpha: 0.13 });
      }
    }
    g.moveTo(t.cx, t.cy - 26).lineTo(t.cx, t.cy + 22)
      .stroke({ width: 2, color: accent, alpha: 0.16 });
    g.circle(t.cx, t.cy - 30, 4).fill({ color: accent, alpha: 0.16 });
    g.arc(t.cx, t.cy + 14, 13, -0.2, Math.PI + 0.2).stroke({ width: 2, color: accent, alpha: 0.16 });
    g.moveTo(t.cx - 13, t.cy + 8).lineTo(t.cx + 13, t.cy + 8)
      .stroke({ width: 1.6, color: accent, alpha: 0.16 });
    return g;
  }

  if (item.id === "felt_oxblood") {
    // 牛血红绒：放射绒面高光 + 丝绒暗纹 + 双金线包边
    for (let i = 0; i < 48; i += 1) {
      const angle = (i / 48) * Math.PI * 2;
      const r1 = 0.18;
      const r2 = 0.42 + (i % 3) * 0.16;
      g.moveTo(t.cx + Math.cos(angle) * rx * r1, t.cy + Math.sin(angle) * ry * r1);
      g.lineTo(t.cx + Math.cos(angle) * rx * r2, t.cy + Math.sin(angle) * ry * r2);
      g.stroke({ width: 2.2, color: 0xff9a8a, alpha: i % 2 ? 0.035 : 0.07 });
    }
    for (let i = 1; i <= 3; i += 1) {
      g.ellipse(t.cx, t.cy, rx * (0.3 + i * 0.2), ry * (0.3 + i * 0.2))
        .stroke({ width: 1, color: 0x1d0709, alpha: 0.25 });
    }
    g.ellipse(t.cx, t.cy, rx - 4, ry - 3).stroke({ width: 2.4, color: accent, alpha: 0.4 });
    g.ellipse(t.cx, t.cy, rx - 12, ry - 9).stroke({ width: 0.8, color: 0xe8c98a, alpha: 0.28 });
    // 毛边包边
    const rnd = rand(771);
    for (let i = 0; i < 90; i += 1) {
      const angle = (i / 90) * Math.PI * 2;
      const len = 3 + rnd() * 5;
      const x = t.cx + Math.cos(angle) * (rx - 5);
      const y = t.cy + Math.sin(angle) * (ry - 4);
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(angle + 0.4) * len, y + Math.sin(angle + 0.4) * len);
      g.stroke({ width: 1, color: accent, alpha: 0.18 + rnd() * 0.18 });
    }
    return g;
  }

  // 旧酒馆绿：斜织纹 + 罗盘水印 + 磨边（全部裁剪在椭圆台面内）
  for (let y = t.cy - ry; y < t.cy + ry; y += 7) {
    const dy = (y - t.cy) / ry;
    const span = rx * Math.sqrt(Math.max(0, 1 - dy * dy));
    for (let x = t.cx - span; x < t.cx + span; x += 26) {
      g.moveTo(x, y).lineTo(x + 12, y + 5);
      g.stroke({ width: 1, color: 0x000000, alpha: 0.07 });
      g.moveTo(x + 2, y + 1).lineTo(x + 12, y + 5);
      g.stroke({ width: 1, color: accent, alpha: 0.05 });
    }
  }
  const rOuter = Math.min(rx, ry) * 0.42;
  g.circle(t.cx, t.cy, rOuter).stroke({ width: 2, color: accent, alpha: 0.18 });
  g.circle(t.cx, t.cy, rOuter * 0.72).stroke({ width: 1, color: accent, alpha: 0.14 });
  for (let i = 0; i < 16; i += 1) {
    const angle = (i / 16) * Math.PI * 2;
    g.moveTo(t.cx + Math.cos(angle) * rOuter, t.cy + Math.sin(angle) * rOuter);
    g.lineTo(t.cx + Math.cos(angle) * (rOuter - 7), t.cy + Math.sin(angle) * (rOuter - 7));
    g.stroke({ width: 1, color: accent, alpha: 0.2 });
  }
  const rnd = rand(1201);
  for (let i = 0; i < 80; i += 1) {
    const angle = (i / 80) * Math.PI * 2;
    const x = t.cx + Math.cos(angle) * (rx - 6);
    const y = t.cy + Math.sin(angle) * (ry - 5);
    g.moveTo(x, y).lineTo(x - 3 - rnd() * 4, y + rnd() * 3);
    g.stroke({ width: 1, color: 0x0b1f18, alpha: 0.2 });
  }
  return g;
}

/* ---------------- 面具 ---------------- */

export function buildMask(item, size = 56) {
  const root = new Container();
  const g = new Graphics();
  const s = size / 56;
  root.scale.set(s);

  if (item.id === "mask_fox") {
    // 裂痕狐面：尖下巴 + 双耳 + 红眼线
    for (const dir of [-1, 1]) {
      g.moveTo(dir * 10, -22);
      g.lineTo(dir * 19, -34);
      g.lineTo(dir * 23, -12);
      g.closePath();
      g.fill({ color: item.color, alpha: 0.95 });
      g.stroke({ width: 1, color: item.accent, alpha: 0.5 });
      g.moveTo(dir * 14, -21).lineTo(dir * 19, -29).lineTo(dir * 20, -16).closePath();
      g.fill({ color: item.accent, alpha: 0.35 });
    }
    g.moveTo(0, -24);
    g.quadraticCurveTo(24, -26, 25, -2);
    g.quadraticCurveTo(24, 20, 0, 34);
    g.quadraticCurveTo(-24, 20, -25, -2);
    g.quadraticCurveTo(-24, -26, 0, -24);
    g.closePath();
    g.fill({ color: item.color });
    g.stroke({ width: 1.4, color: item.accent, alpha: 0.55 });
    for (const dir of [-1, 1]) {
      g.moveTo(dir * 5, -6).lineTo(dir * 17, -11);
      g.stroke({ width: 2.6, color: item.accent, alpha: 0.85 });
      g.ellipse(dir * 11, -9, 3.4, 1.8).fill({ color: 0x1a1412, alpha: 0.8 });
    }
    g.moveTo(0, 2).lineTo(3.6, 8).lineTo(-3.6, 8).closePath();
    g.fill({ color: item.accent, alpha: 0.9 });
    // 裂纹
    g.moveTo(-14, -20).lineTo(-9, -6).lineTo(-14, 4).lineTo(-8, 16);
    g.stroke({ width: 1, color: 0x6b5b52, alpha: 0.55 });
    g.moveTo(16, -18).lineTo(11, -8);
    g.stroke({ width: 0.8, color: 0x6b5b52, alpha: 0.5 });
    root.addChild(g);
    return root;
  }

  if (item.id === "mask_plague") {
    // 疫医鸟喙：皮革面 + 长喙 + 圆目镜 + 缝线
    g.ellipse(0, -2, 21, 25).fill({ color: item.color });
    g.ellipse(0, -2, 21, 25).stroke({ width: 1.2, color: item.accent, alpha: 0.35 });
    g.moveTo(-2, -20);
    g.quadraticCurveTo(2, -10, 0, 2);
    g.stroke({ width: 0.8, color: item.accent, alpha: 0.25 });
    // 长喙
    g.moveTo(-9, 4);
    g.quadraticCurveTo(-4, 26, 0, 32);
    g.quadraticCurveTo(2, 24, 9, 4);
    g.closePath();
    g.fill({ color: shade(item.color, 1.9) });
    g.stroke({ width: 1, color: item.accent, alpha: 0.45 });
    g.moveTo(-6, 9).quadraticCurveTo(0, 14, 6, 9);
    g.stroke({ width: 0.8, color: 0x1a1512, alpha: 0.5 });
    // 圆目镜
    for (const dir of [-1, 1]) {
      g.circle(dir * 10, -10, 6.4).fill({ color: 0x120f0d }).stroke({ width: 1.6, color: item.accent, alpha: 0.9 });
      g.circle(dir * 10, -10, 3.2).fill({ color: item.accent, alpha: 0.22 });
      g.circle(dir * 8.6, -11.6, 1.2).fill({ color: 0xfff2cf, alpha: 0.7 });
    }
    // 皮革缝线
    for (let i = 0; i < 7; i += 1) {
      const angle = -Math.PI * 0.75 + (i / 6) * Math.PI * 0.5;
      const x = Math.cos(angle) * 20;
      const y = -2 + Math.sin(angle) * 24;
      g.moveTo(x, y).lineTo(x * 0.84, y * 0.84 - 1);
      g.stroke({ width: 1, color: item.accent, alpha: 0.4 });
    }
    root.addChild(g);
    return root;
  }

  // 无名白面：瓷面 + 眼洞 + 鼻梁 + 嘴缝
  g.ellipse(0, 0, 19, 24).fill({ color: item.color });
  g.ellipse(0, 0, 19, 24).stroke({ width: 1.4, color: item.accent, alpha: 0.6 });
  g.ellipse(0, -1, 17, 21).fill({ color: shade(item.color, 1.06), alpha: 0.5 });
  for (const dir of [-1, 1]) {
    g.ellipse(dir * 7.5, -6, 5, 3.4).fill({ color: 0x241f1b, alpha: 0.82 });
    g.ellipse(dir * 7.5, -7, 3.4, 1.6).fill({ color: 0x0d0b09, alpha: 0.75 });
    g.ellipse(dir * 7.5, -2, 4, 1.2).fill({ color: item.accent, alpha: 0.16 });
  }
  g.moveTo(0, 0).lineTo(-2.4, 10).lineTo(2.4, 10);
  g.stroke({ width: 1, color: item.accent, alpha: 0.45 });
  for (let i = 0; i < 3; i += 1) {
    g.moveTo(-6 + i * 0.6, 15 + i * 2).lineTo(6 - i * 0.6, 15 + i * 2);
    g.stroke({ width: 0.9, color: 0x6a5f55, alpha: 0.5 });
  }
  g.circle(-11, 12, 2.2).fill({ color: 0xb08a8a, alpha: 0.14 });
  root.addChild(g);
  return root;
}

/* ---------------- 左轮 ---------------- */

export function buildRevolver(item, scale = 1) {
  const root = new Container();
  const body = new Graphics();
  const barrel = shade(item.color, 1.12);
  const dark = shade(item.color, 0.55);

  // 扳机护圈
  body.arc(-4, 30, 17, 0.1, Math.PI - 0.1).stroke({ width: 5, color: dark, alpha: 0.95 });
  // 握把
  body.moveTo(-34, 14);
  body.quadraticCurveTo(-48, 46, -40, 66);
  body.quadraticCurveTo(-30, 72, -20, 58);
  body.lineTo(-12, 30);
  body.closePath();
  body.fill({ color: item.id === "rl_obsidian" ? 0x2a1c22 : 0x4a2c1c });
  body.moveTo(-34, 20);
  for (let i = 0; i < 5; i += 1) {
    body.moveTo(-38 + i * 2, 24 + i * 8).lineTo(-26 + i * 1.4, 28 + i * 8);
    body.stroke({ width: 1, color: shade(item.color, 0.75), alpha: 0.4 });
  }
  // 枪管
  body.roundRect(26, -18, 96, 20, 4).fill({ color: barrel });
  body.roundRect(26, -18, 96, 6, 3).fill({ color: shade(item.color, 1.4), alpha: 0.5 });
  body.roundRect(114, -20, 10, 24, 3).fill({ color: dark });
  body.circle(66, -20, 4).fill({ color: dark });
  // 机匣
  body.roundRect(-34, -24, 76, 44, 8).fill({ color: item.color });
  body.roundRect(-34, -24, 76, 12, 6).fill({ color: shade(item.color, 1.35), alpha: 0.45 });
  // 击锤
  body.moveTo(-32, -20);
  body.quadraticCurveTo(-46, -30, -42, -40);
  body.quadraticCurveTo(-36, -34, -28, -28);
  body.closePath();
  body.fill({ color: dark });
  // 刻纹
  if (item.id === "rl_obsidian") {
    body.moveTo(-20, 6).lineTo(-6, -6).lineTo(8, 6).lineTo(22, -6);
    body.stroke({ width: 1.4, color: item.accent, alpha: 0.65 });
    body.moveTo(40, -12).lineTo(112, -12);
    body.stroke({ width: 0.8, color: item.accent, alpha: 0.35 });
  } else if (item.id === "rl_steel") {
    for (let i = 0; i < 12; i += 1) {
      body.moveTo(30 + i * 7, -16).lineTo(30 + i * 7, -2);
      body.stroke({ width: 0.7, color: 0xffffff, alpha: 0.12 });
    }
    body.moveTo(-16, -10).lineTo(28, -10).stroke({ width: 1, color: 0xffffff, alpha: 0.2 });
    body.moveTo(-16, 8).lineTo(28, 8).stroke({ width: 1, color: 0xffffff, alpha: 0.14 });
  } else {
    // 黄铜氧化斑
    const rnd = rand(88);
    for (let i = 0; i < 22; i += 1) {
      const x = -30 + rnd() * 100;
      const y = -20 + rnd() * 38;
      body.circle(x, y, 1 + rnd() * 2.6).fill({ color: 0x4b3a1c, alpha: 0.16 + rnd() * 0.16 });
    }
    body.circle(0, -14, 2).fill({ color: item.accent, alpha: 0.7 });
  }
  root.addChild(body);

  // 弹巢（可旋转）
  const chambers = [];
  const cylinder = new Container();
  const cyl = new Graphics();
  cyl.circle(0, 0, 34).fill({ color: shade(item.color, 0.8) });
  cyl.circle(0, 0, 34).stroke({ width: 2, color: item.accent, alpha: 0.55 });
  cyl.circle(0, 0, 27).stroke({ width: 1, color: dark, alpha: 0.8 });
  for (let i = 0; i < 6; i += 1) {
    const angle = (i / 6) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * 19;
    const y = Math.sin(angle) * 19;
    const chamber = new Container();
    const cg = new Graphics();
    cg.circle(0, 0, 8).fill({ color: 0x0b0908 });
    cg.circle(0, 0, 8).stroke({ width: 1.6, color: item.accent, alpha: 0.45 });
    cg.circle(0, 0, 4.2).fill({ color: 0x060504 });
    cg.circle(-1.6, -1.6, 1.6).fill({ color: 0xffffff, alpha: 0.1 });
    const glow = new Graphics();
    glow.circle(0, 0, 10.5).fill({ color: item.accent, alpha: 1 });
    glow.alpha = 0;
    chamber.addChild(glow);
    chamber.addChild(cg);
    chamber.position.set(x, y);
    chamber.cellIndex = i;
    chamber.glow = glow;
    cylinder.addChild(chamber);
    chambers.push(chamber);
  }
  cylinder.position.set(0, 0);
  root.addChild(cylinder);
  // 中心轴
  const hub = new Graphics();
  hub.circle(0, 0, 5).fill({ color: item.accent, alpha: 0.9 });
  hub.circle(0, 0, 2.2).fill({ color: 0x1a1512 });
  root.addChild(hub);

  root.scale.set(scale);
  return { container: root, cylinder, chambers };
}
