import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { gsap } from "gsap";
import { COSMETIC_INDEX } from "../platform/store.js";
import { buildCardBack, buildFeltPattern, buildMask } from "./cosmetics.js";
import { sfx } from "./audio.js";

const CARD_W = 96;
const CARD_H = 136;
const FONT = "Fusion Pixel, SimSun, monospace";

const LAYOUTS = {
  landscape: {
    W: 960,
    H: 640,
    seats: [
      { x: 480, y: 545 },
      { x: 130, y: 300 },
      { x: 480, y: 110 },
      { x: 830, y: 300 },
    ],
    avatars: [
      { x: 150, y: 560 },
      { x: 92, y: 212 },
      { x: 480, y: 56 },
      { x: 868, y: 212 },
    ],
    showSelf: true,
    table: { cx: 480, cy: 330, rx: 392, ry: 218 },
    center: { x: 310, y: 262, w: 340, h: 84 },
    slots: [
      { x: 480, y: 444 },
      { x: 220, y: 330 },
      { x: 480, y: 205 },
      { x: 740, y: 330 },
    ],
    hand: { spacing: 104, tight: 88, y: 545 },
  },
  portrait: {
    W: 480,
    H: 900,
    seats: [
      { x: 240, y: 812 },
      { x: 88, y: 132 },
      { x: 240, y: 96 },
      { x: 392, y: 132 },
    ],
    avatars: [
      { x: 240, y: 660 },
      { x: 88, y: 132 },
      { x: 240, y: 96 },
      { x: 392, y: 132 },
    ],
    showSelf: false,
    table: { cx: 240, cy: 430, rx: 228, ry: 262 },
    center: { x: 60, y: 330, w: 360, h: 88 },
    slots: [
      { x: 240, y: 620 },
      { x: 108, y: 258 },
      { x: 240, y: 235 },
      { x: 372, y: 258 },
    ],
    hand: { spacing: 86, tight: 76, y: 812 },
  },
};
const PLAYER_COLORS = [0x7fd6b2, 0x8fb6e8, 0xe8b26a, 0xe88fa8];
const MASK_FILES = ["", "mask1.webp", "mask2.webp", "mask3.webp"];
const MASK_SKINS = ["mask_default", "mask_fox", "mask_plague"];

function text(str, size, color = 0xf1e6c8, extra = {}) {
  return new Text({
    text: str,
    style: {
      fontFamily: FONT,
      fontSize: size,
      fill: color,
      align: "center",
      lineHeight: Math.round(size * 1.35),
      ...extra,
    },
  });
}

function rounded(g, x, y, w, h, r, color, alpha = 1) {
  g.roundRect(x, y, w, h, r).fill({ color, alpha });
  return g;
}

function clearLayer(container) {
  const removed = container.removeChildren();
  for (const child of removed) {
    if (!child || child.destroyed) continue;
    gsap.killTweensOf(child);
    for (const grandchild of child.children || []) gsap.killTweensOf(grandchild);
    child.destroy({ children: true });
  }
}

export class TableView {
  constructor({ container, equipped, reducedMotion = false, onSelect, onPlay }) {
    this.container = container;
    this.equipped = equipped;
    this.reducedMotion = reducedMotion;
    this.onSelect = onSelect || (() => {});
    this.onPlay = onPlay || (() => {});
    this.app = null;
    this.stage = null;
    this.layers = {};
    this.handCards = [];
    this.selected = new Set();
    this.textures = {};
    this.lastHandKey = "";
    this.view = null;
    this.pendingDrag = null;
    this.thinkingSeat = null;
    this.handEnabled = true;
    this.layout = window.innerHeight > window.innerWidth ? LAYOUTS.portrait : LAYOUTS.landscape;
    this.W = this.layout.W;
    this.H = this.layout.H;
    this.resizeHandler = null;
    this.recovering = false;
    this.contextTimer = null;
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      width: this.W,
      height: this.H,
      background: 0x050a09,
      antialias: false,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: "webgl",
    });
    this.app.canvas.className = "table-canvas";
    this.container.appendChild(this.app.canvas);
    this.root = new Container();
    this.root.sortableChildren = true;
    this.app.stage.addChild(this.root);
    this.layers.bg = new Container();
    this.layers.table = new Container();
    this.layers.piles = new Container();
    this.layers.seats = new Container();
    this.layers.center = new Container();
    this.layers.fx = new Container();
    this.layers.hand = new Container();
    this.layers.hand.sortableChildren = true;
    for (const key of ["bg", "table", "piles", "seats", "center", "fx", "hand"]) {
      this.root.addChild(this.layers[key]);
    }
    this.textures = {};
    await this.loadArt();
    this.buildBackground();
    this.buildTable();
    this.bindResize();
    this.bindContextRecovery();
  }

  // 手机上 WebGL 上下文可能被浏览器回收（画面全黑）。监听丢失事件并重建渲染器。
  bindContextRecovery() {
    const canvas = this.app?.canvas;
    if (!canvas) return;
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      clearTimeout(this.contextTimer);
      this.contextTimer = setTimeout(() => this.recoverRenderer(), 1500);
    });
    canvas.addEventListener("webglcontextrestored", () => {
      clearTimeout(this.contextTimer);
      this.recoverRenderer();
    });
  }

  async recoverRenderer() {
    if (this.recovering || !this.app) return;
    this.recovering = true;
    try {
      const view = this.view;
      try {
        this.app.destroy(true, { children: true, texture: false });
      } catch (error) {}
      this.app = null;
      this.root = null;
      this.layers = {};
      this.handCards = [];
      this.textures = {};
      await this.init();
      if (view) this.render(view);
    } catch (error) {
      console.error(error);
    } finally {
      this.recovering = false;
    }
  }

  bindResize() {
    if (!this.resizeHandler) {
      this.resizeHandler = () => this.handleResize();
      window.addEventListener("resize", this.resizeHandler);
      window.addEventListener("orientationchange", this.resizeHandler);
    }
    this.fitCanvas();
  }

  fitCanvas() {
    const canvas = this.app && this.app.canvas;
    if (!canvas) return;
    const rect = this.container.getBoundingClientRect();
    const vw = rect.width || window.innerWidth;
    const vh = rect.height || window.innerHeight;
    const scale = Math.min(1, vw / this.W, vh / this.H);
    canvas.style.width = `${Math.max(1, Math.round(this.W * scale))}px`;
    canvas.style.height = `${Math.max(1, Math.round(this.H * scale))}px`;
  }

  handleResize() {
    if (!this.app) return;
    const next = window.innerHeight > window.innerWidth ? LAYOUTS.portrait : LAYOUTS.landscape;
    if (next !== this.layout) {
      this.layout = next;
      this.W = next.W;
      this.H = next.H;
      this.app.renderer.resize(next.W, next.H);
      this.buildBackground();
      this.buildTable();
      this.lastHandKey = "";
      this.selected.clear();
      this.onSelect([]);
      if (this.view) this.render(this.view);
    }
    this.fitCanvas();
  }

  async loadArt() {
    const files = ["tavern.webp", "mask1.webp", "mask2.webp", "mask3.webp", "bartender.webp"];
    await Promise.all(files.map(async (file) => {
      try {
        const texture = await Assets.load(`assets/art/${file}`);
        this.textures[file] = texture;
      } catch (e) {
        this.textures[file] = null;
      }
    }));
    // 玩家面具皮肤贴图可选：文件存在时优先于程序化绘制
    await Promise.all(MASK_SKINS.map(async (id) => {
      const url = `assets/art/masks/${id}.webp`;
      try {
        const head = await fetch(url, { method: "HEAD" });
        if (!head.ok) return;
        this.textures[`skin:${id}`] = await Assets.load(url);
      } catch (e) {}
    }));
  }

  buildBackground() {
    const layer = this.layers.bg;
    layer.removeChildren();
    const bg = new Graphics();
    bg.rect(0, 0, this.W, this.H).fill({ color: 0x06100d });
    layer.addChild(bg);
    const texture = this.textures["tavern.webp"];
    if (texture) {
      const sprite = new Sprite(texture);
      const scale = Math.max(this.W / texture.width, this.H / texture.height);
      sprite.anchor.set(0.5);
      sprite.position.set(this.W / 2, this.H / 2);
      sprite.scale.set(scale);
      sprite.alpha = 0.55;
      layer.addChild(sprite);
    }
    const shade = new Graphics();
    shade.rect(0, 0, this.W, this.H).fill({ color: 0x02100c, alpha: 0.35 });
    for (let i = 0; i < 5; i += 1) {
      shade.rect(0, i * 28, this.W, 28).fill({ color: 0x000000, alpha: 0.025 });
    }
    layer.addChild(shade);
    const vignette = new Graphics();
    vignette.ellipse(this.W / 2, this.H / 2, this.W * 0.62, this.H * 0.65).fill({ color: 0x000000, alpha: 0 });
    layer.addChild(vignette);
  }

  buildTable() {
    const layer = this.layers.table;
    layer.removeChildren();
    const felt = COSMETIC_INDEX[this.equipped.felt?.id] || this.equipped.felt || COSMETIC_INDEX.felt_default;
    const t = this.layout.table;
    const rim = new Graphics();
    rim.ellipse(t.cx, t.cy, t.rx, t.ry).fill({ color: 0x2a1810 });
    rim.ellipse(t.cx, t.cy, t.rx - 10, t.ry - 8).fill({ color: 0x170f0a });
    rim.ellipse(t.cx, t.cy, t.rx - 26, t.ry - 21).fill({ color: felt.color });
    rim.ellipse(t.cx, t.cy, t.rx - 54, t.ry - 38).stroke({ width: 3, color: felt.accent, alpha: 0.45 });
    rim.ellipse(t.cx, t.cy, t.rx - 26, t.ry - 21).stroke({ width: 2, color: 0xd8c690, alpha: 0.25 });
    layer.addChild(rim);
    const weave = new Graphics();
    const left = Math.round(t.cx - t.rx);
    const right = Math.round(t.cx + t.rx);
    for (let x = left + 32; x < right - 36; x += 14) {
      weave.moveTo(x, Math.round(t.cy - t.ry + 20)).lineTo(x + 40, Math.round(t.cy + t.ry - 20))
        .stroke({ width: 1, color: 0x000000, alpha: 0.05 });
    }
    layer.addChild(weave);
    layer.addChild(buildFeltPattern(felt, t));
    const crest = text("词 谎", 30, 0xe8dcc0, { letterSpacing: 12 });
    crest.anchor.set(0.5);
    crest.position.set(t.cx, t.cy + 6);
    crest.alpha = 0.14;
    layer.addChild(crest);
  }

  setEquipped(equipped) {
    this.equipped = equipped;
    if (!this.app) return;
    this.buildTable();
    if (this.view) this.render(this.view);
  }

  makeCard(card, faceUp = true, compact = false) {
    const w = compact ? CARD_W * 0.72 : CARD_W;
    const h = compact ? CARD_H * 0.72 : CARD_H;
    const node = new Container();
    const cardback = COSMETIC_INDEX[this.equipped.cardback?.id] || COSMETIC_INDEX.cb_default;
    const g = new Graphics();
    rounded(g, -w / 2, -h / 2, w, h, 8, 0x120d0b);
    rounded(g, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 7, card.joker ? 0x392247 : (card.review ? 0x2c3a26 : 0x1b1310));
    g.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 5)
      .stroke({ width: 1, color: card.joker ? 0xd9b3ff : cardback.accent, alpha: 0.75 });
    node.addChild(g);
    if (!faceUp) {
      node.addChild(buildCardBack(cardback, w, h));
      return node;
    }
    const word = card.joker ? "JOKER" : card.w;
    const label = text(word, word.length > 10 ? 11 : word.length > 7 ? 13 : 16, card.joker ? 0xf0d6ff : 0xf4ead4, {
      fontWeight: "bold",
      wordWrap: true,
      wordWrapWidth: w - 12,
      breakWords: true,
    });
    label.anchor.set(0.5);
    label.position.set(0, -h / 2 + 34);
    node.addChild(label);
    if (card.ipa) {
      const ipa = text(card.ipa, 8, 0x9fb7a7, { wordWrap: true, wordWrapWidth: w - 14, breakWords: true });
      ipa.anchor.set(0.5);
      ipa.position.set(0, -h / 2 + 66);
      node.addChild(ipa);
    }
    if (Array.isArray(card.pos) && card.pos.length) {
      const pos = text(card.pos.slice(0, 2).join("/"), 8, 0x8b9a8e);
      pos.anchor.set(0.5);
      pos.position.set(0, h / 2 - 34);
      node.addChild(pos);
    }
    if (card.review) {
      const tag = text("复习", 8, 0xcfe3a8);
      tag.anchor.set(0.5);
      tag.position.set(0, h / 2 - 16);
      node.addChild(tag);
    }
    return node;
  }

  makePileBack() {
    const cardback = COSMETIC_INDEX[this.equipped.cardback?.id] || COSMETIC_INDEX.cb_default;
    return buildCardBack(cardback, 40, 56);
  }

  renderPiles(view, { skipLast = false } = {}) {
    const layer = this.layers.piles;
    clearLayer(layer);
    const chain = view.chain || [];
    if (!chain.length) return;
    const last = chain[chain.length - 1];
    const grouped = new Map();
    chain.forEach((segment, index) => {
      if (skipLast && index === chain.length - 1) return;
      if (!grouped.has(segment.player)) grouped.set(segment.player, []);
      grouped.get(segment.player).push(segment);
    });
    const w = 40;
    const h = 56;
    const gap = 20;
    for (const [seat, segments] of grouped) {
      const slot = this.layout.slots[seat];
      if (!slot) continue;
      const total = segments.reduce((sum, segment) => sum + Math.max(1, segment.count || segment.claimed || 1), 0);
      const shown = Math.min(total, 6);
      const startX = slot.x - ((shown - 1) * gap) / 2;
      for (let i = 0; i < shown; i += 1) {
        const back = this.makePileBack();
        back.position.set(startX + i * gap, slot.y);
        back.zIndex = i;
        layer.addChild(back);
      }
      if (!skipLast && last.player === seat) {
        const width = (shown - 1) * gap + w + 10;
        const halo = new Graphics();
        halo.roundRect(slot.x - width / 2, slot.y - h / 2 - 3, width, h + 6, 7)
          .stroke({ width: 2, color: PLAYER_COLORS[seat], alpha: 0.85 });
        layer.addChild(halo);
        gsap.to(halo, { alpha: 0.35, duration: 0.75, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
      const claimed = segments.reduce((sum, segment) => sum + (segment.claimed || 0), 0);
      const claimTag = text(`声称 ${claimed}`, 9, PLAYER_COLORS[seat]);
      claimTag.anchor.set(0.5);
      claimTag.position.set(slot.x, slot.y - h / 2 - 13);
      layer.addChild(claimTag);
    }
  }

  handTargets(count) {
    const { spacing, tight, y } = this.layout.hand;
    const gap = count <= 5 ? spacing : tight;
    const start = this.W / 2 - ((count - 1) * gap) / 2;
    return Array.from({ length: count }, (_, i) => ({
      x: start + i * gap,
      y,
      rot: (i - (count - 1) / 2) * 0.045,
    }));
  }

  renderHand(view, { deal = false } = {}) {
    const cards = view.players[0].hand || [];
    const key = cards.map((card) => card.id).join(",");
    if (key === this.lastHandKey && this.handCards.length) {
      this.layoutHand();
      return;
    }
    this.lastHandKey = key;
    this.selected.clear();
    clearLayer(this.layers.hand);
    this.handCards = [];
    const targets = this.handTargets(cards.length);
    cards.forEach((card, i) => {
      const node = this.makeCard(card, true);
      const target = targets[i];
      node.position.set(deal ? this.W / 2 : target.x, deal ? this.layout.table.cy : target.y);
      node.rotation = deal ? 0 : target.rot;
      node.alpha = deal ? 0 : 1;
      node.eventMode = this.handEnabled ? "static" : "none";
      node.cursor = "pointer";
      node.cardData = card;
      node.baseX = target.x;
      node.baseY = target.y;
      node.baseRot = target.rot;
      node.on("pointerdown", (event) => this.onCardDown(card, node, event));
      this.layers.hand.addChild(node);
      this.handCards.push(node);
      if (deal) {
        gsap.to(node, {
          x: target.x,
          y: target.y,
          rotation: target.rot,
          alpha: 1,
          duration: this.reducedMotion ? 0.01 : 0.6,
          delay: this.reducedMotion ? 0 : i * 0.12,
          ease: "power2.out",
        });
      }
    });
  }

  layoutHand() {
    const targets = this.handTargets(this.handCards.length);
    this.handCards.forEach((node, i) => {
      const target = targets[i];
      node.baseX = target.x;
      node.baseY = target.y;
      node.baseRot = target.rot;
      const selected = this.selected.has(node.cardData.id);
      if (!node.dragging) {
        gsap.to(node, {
          x: target.x,
          y: target.y - (selected ? 28 : 0),
          rotation: target.rot,
          scale: selected ? 1.06 : 1,
          duration: this.reducedMotion ? 0.01 : 0.16,
          ease: "power2.out",
        });
      }
      node.zIndex = selected ? 100 + i : i;
    });
  }

  onCardDown(card, node, event) {
    if (!node.interactive) return;
    const rect = this.app.canvas.getBoundingClientRect();
    const scale = rect.height / this.H || 1;
    this.pendingDrag = {
      card,
      node,
      startY: event.clientY,
      moved: false,
      originY: node.y,
    };
    const onMove = (moveEvent) => {
      if (!this.pendingDrag) return;
      const dy = (moveEvent.clientY - this.pendingDrag.startY) / scale;
      if (Math.abs(dy) > 8) this.pendingDrag.moved = true;
      if (dy < -10) {
        node.y = this.pendingDrag.originY + Math.max(-70, dy * 0.6);
      }
    };
    const onUp = (upEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (!this.pendingDrag) return;
      const drag = this.pendingDrag;
      const dy = (upEvent.clientY - drag.startY) / scale;
      this.pendingDrag = null;
      if (dy < -70) {
        if (!this.selected.has(card.id)) this.toggleCard(card.id);
        const ids = Array.from(this.selected);
        this.onPlay(ids.length ? ids : [card.id]);
        return;
      }
      if (!drag.moved) this.toggleCard(card.id);
      this.layoutHand();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  toggleCard(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else {
      if (this.selected.size >= 3) {
        const first = this.selected.values().next().value;
        this.selected.delete(first);
      }
      this.selected.add(id);
    }
    this.onSelect(Array.from(this.selected));
    this.layoutHand();
  }

  clearSelection() {
    this.selected.clear();
    this.onSelect([]);
    this.layoutHand();
  }

  selectedIds() {
    return Array.from(this.selected);
  }

  makeAvatar(view, seat) {
    const player = view.players[seat];
    const pos = this.layout.avatars[seat];
    const group = new Container();
    group.position.set(pos.x, pos.y);
    const color = PLAYER_COLORS[seat];
    const ring = new Graphics();
    ring.circle(0, 0, 32).fill({ color: 0x0b1210, alpha: 0.92 });
    ring.circle(0, 0, 32).stroke({ width: 2, color, alpha: player.alive ? 0.9 : 0.25 });
    group.addChild(ring);
    if (seat === view.currentPlayer && !view.result) {
      const pulse = new Graphics();
      pulse.circle(0, 0, 37).stroke({ width: 2, color, alpha: 0.85 });
      group.addChild(pulse);
      gsap.to(pulse, { alpha: 0.2, duration: 0.8, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }
    if (seat === 0) {
      const def = COSMETIC_INDEX[this.equipped.mask?.id] || COSMETIC_INDEX.mask_default;
      const own = this.textures[`skin:${def.id}`];
      if (own) {
        const sprite = new Sprite(own);
        const scale = 56 / Math.min(own.width, own.height);
        sprite.anchor.set(0.5);
        sprite.scale.set(scale);
        const clip = new Graphics();
        clip.circle(0, 0, 28).fill({ color: 0xffffff });
        group.addChild(clip);
        sprite.mask = clip;
        group.addChild(sprite);
      } else {
        group.addChild(buildMask(def, 56));
      }
      const breathe = new Graphics();
      breathe.circle(0, 0, 30).stroke({ width: 1, color, alpha: 0.35 });
      group.addChild(breathe);
      if (!this.reducedMotion) {
        gsap.to(breathe, { alpha: 0.12, duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
        gsap.to(breathe.scale, { x: 1.06, y: 1.06, duration: 2.4, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    } else {
      const texture = this.textures[MASK_FILES[seat]];
      if (texture) {
        const sprite = new Sprite(texture);
        const scale = 56 / Math.min(texture.width, texture.height);
        sprite.anchor.set(0.5);
        sprite.scale.set(scale);
        const mask = new Graphics();
        mask.circle(0, 0, 28).fill({ color: 0xffffff });
        group.addChild(mask);
        sprite.mask = mask;
        group.addChild(sprite);
        group.addChild(mask);
      } else {
        const def = COSMETIC_INDEX[this.equipped.mask?.id] || COSMETIC_INDEX.mask_default;
        const face = new Graphics();
        face.ellipse(0, 2, 17, 22).fill({ color: def.color });
        face.ellipse(-7, -4, 3, 2).fill({ color: def.accent });
        face.ellipse(7, -4, 3, 2).fill({ color: def.accent });
        group.addChild(face);
      }
    }
    const name = text(seat === 0 ? "你" : `面具${"一二三"[seat - 1]}`, 11, player.alive ? 0xdfd7c4 : 0x6b665c);
    name.anchor.set(0.5);
    name.position.set(0, 46);
    group.addChild(name);
    const count = text(player.alive ? `${player.handCount} 张` : "出局", 9, player.alive ? 0xa9b7a9 : 0x8a4a4a);
    count.anchor.set(0.5);
    count.position.set(0, 60);
    group.addChild(count);
    const pulls = new Graphics();
    for (let i = 0; i < 6; i += 1) {
      const filled = i < player.pulls;
      pulls.circle(-25 + i * 10, 74, 3.2).fill({
        color: filled ? 0xd25a4a : 0x39443d,
        alpha: filled ? 1 : 0.8,
      });
    }
    group.addChild(pulls);
    if (player.hit) {
      const cross = new Graphics();
      cross.moveTo(-24, -24).lineTo(24, 24).stroke({ width: 3, color: 0x9d2f2f });
      cross.moveTo(24, -24).lineTo(-24, 24).stroke({ width: 3, color: 0x9d2f2f });
      group.addChild(cross);
    }
    if (!player.alive) group.alpha = 0.5;
    group.zIndex = seat === view.currentPlayer ? 20 : 10;
    return group;
  }

  renderSeats(view) {
    const layer = this.layers.seats;
    clearLayer(layer);
    for (let seat = 0; seat < 4; seat += 1) {
      if (seat === 0 && !this.layout.showSelf) continue;
      layer.addChild(this.makeAvatar(view, seat));
    }
    // AI 手牌背面扇形
    for (const seat of [1, 2, 3]) {
      const player = view.players[seat];
      if (!player.alive) continue;
      const pos = this.layout.avatars[seat];
      const count = Math.min(player.handCount, 8);
      for (let i = 0; i < count; i += 1) {
        const back = this.makeCard({ w: "", truth: false }, false, true);
        back.scale.set(0.42);
        back.rotation = (i - (count - 1) / 2) * 0.12;
        back.position.set(pos.x + (i - (count - 1) / 2) * 9, pos.y - 44 - Math.abs(i - (count - 1) / 2) * 2);
        back.alpha = 0.85;
        layer.addChild(back);
      }
    }
    if (this.thinkingSeat && view.players[this.thinkingSeat]?.alive) {
      const pos = this.layout.avatars[this.thinkingSeat];
      const hint = text("思考中…", 10, 0xe8d9a8);
      hint.anchor.set(0.5);
      hint.position.set(pos.x, pos.y + 90);
      layer.addChild(hint);
      if (!this.reducedMotion) {
        gsap.to(hint, { alpha: 0.35, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    }
  }

  setThinking(seat, on) {
    this.thinkingSeat = on ? seat : null;
    if (this.view) this.renderSeats(this.view);
  }

  showTopicReveal(view, { first = false } = {}) {
    return new Promise((resolve) => {
      const topic = view && view.topic;
      if (!topic || !this.app) {
        resolve();
        return;
      }
      const layer = this.layers.fx;
      layer.zIndex = 60;
      const root = new Container();
      root.eventMode = "static";
      root.cursor = "pointer";
      layer.addChild(root);
      const W = this.W;
      const H = this.H;
      const cx = W / 2;
      const cy = H * 0.44;
      const rm = this.reducedMotion;
      const cardback = COSMETIC_INDEX[this.equipped.cardback?.id] || COSMETIC_INDEX.cb_default;

      const dim = new Graphics();
      dim.rect(0, 0, W, H).fill({ color: 0x02060a });
      dim.alpha = 0;
      root.addChild(dim);

      const spot = new Graphics();
      spot.ellipse(cx, cy, 250, 152).fill({ color: 0xffdfa0, alpha: 0.03 });
      spot.ellipse(cx, cy, 188, 114).fill({ color: 0xffdfa0, alpha: 0.045 });
      spot.ellipse(cx, cy, 128, 78).fill({ color: 0xfff0c8, alpha: 0.05 });
      spot.alpha = 0;
      root.addChild(spot);

      const cardW = 252;
      const cardH = 164;
      const card = new Container();
      card.position.set(cx, cy + 46);
      card.rotation = -0.08;
      card.scale.set(0.86);
      card.alpha = 0;
      root.addChild(card);

      const back = buildCardBack(cardback, cardW, cardH);
      card.addChild(back);

      const front = new Container();
      front.visible = false;
      const panel = new Graphics();
      rounded(panel, -cardW / 2, -cardH / 2, cardW, cardH, 9, 0x0b1210, 0.97);
      panel.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 9)
        .stroke({ width: 1.6, color: 0xd8c690, alpha: 0.7 });
      panel.roundRect(-cardW / 2 + 5, -cardH / 2 + 5, cardW - 10, cardH - 10, 6)
        .stroke({ width: 0.8, color: cardback.accent, alpha: 0.35 });
      front.addChild(panel);
      const typeLabel = topic.type === "synonym" ? "同义词主题" : "释义主题";
      const tag = text(typeLabel, 10, 0xd9b45f, { letterSpacing: 3 });
      tag.anchor.set(0.5);
      tag.position.set(0, -cardH / 2 + 20);
      front.addChild(tag);
      const full = topic.prompt || (topic.promptTokens || []).join("；");
      const promptText = text("", 16, 0xf4ead4, {
        wordWrap: true,
        wordWrapWidth: cardW - 40,
        lineHeight: 24,
      });
      promptText.anchor.set(0.5);
      promptText.position.set(0, -4);
      front.addChild(promptText);
      const seatName = (id) => (id === 0 ? "你" : `面具${"一二三"[id - 1]}`);
      const starter = view.starter == null ? view.currentPlayer : view.starter;
      const foot = text(
        `${first ? "开局" : `第 ${view.round} 轮`} · 由 ${seatName(starter)} 选主题`,
        10,
        0x9fb0a2,
      );
      foot.anchor.set(0.5);
      foot.position.set(0, cardH / 2 - 20);
      front.addChild(foot);
      card.addChild(front);

      let done = false;
      let tl = null;
      const cleanup = () => {
        if (tl) {
          tl.kill();
          tl = null;
        }
        gsap.killTweensOf([dim, spot, card, card.scale]);
        clearLayer(root);
        layer.zIndex = 0;
      };
      const finish = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve();
      };
      root.on("pointertap", finish);

      const dimTarget = 0.8;
      tl = gsap.timeline();
      tl.to(dim, { alpha: dimTarget, duration: rm ? 0.01 : 0.35 }, 0);
      tl.to(spot, { alpha: 1, duration: rm ? 0.01 : 0.5 }, 0);
      tl.to(card, {
        alpha: 1,
        y: cy,
        rotation: 0,
        scale: 1,
        duration: rm ? 0.01 : 0.55,
        ease: "power3.out",
      }, rm ? 0 : 0.15);
      tl.call(() => {
        if (done) return;
        sfx.card();
        gsap.to(card.scale, {
          x: 0,
          duration: rm ? 0.01 : 0.22,
          ease: "power2.in",
          onComplete: () => {
            if (done) return;
            back.visible = false;
            front.visible = true;
            sfx.tick();
            gsap.to(card.scale, {
              x: 1,
              duration: rm ? 0.01 : 0.24,
              ease: "power2.out",
              onComplete: () => {
                if (done) return;
                const proxy = { i: 0 };
                gsap.to(proxy, {
                  i: full.length,
                  duration: rm ? 0.01 : Math.min(1.4, full.length * 0.04),
                  ease: "none",
                  onUpdate: () => {
                    if (done || promptText.destroyed) return;
                    promptText.text = full.slice(0, Math.round(proxy.i));
                  },
                });
              },
            });
          },
        });
      }, [], rm ? 0.02 : 0.7);
      const holdAt = rm ? 0.1 : 2.55;
      tl.to(card, { alpha: 0, y: cy - 26, duration: rm ? 0.02 : 0.3 }, holdAt);
      tl.to([dim, spot], { alpha: 0, duration: rm ? 0.02 : 0.36 }, holdAt + 0.05);
      tl.call(finish, [], holdAt + (rm ? 0.05 : 0.42));
    });
  }

  renderCenter(view) {
    const layer = this.layers.center;
    clearLayer(layer);
    if (!view.topic) return;
    const c = this.layout.center;
    const cx = c.x + c.w / 2;
    const panel = new Graphics();
    rounded(panel, c.x, c.y, c.w, c.h, 10, 0x0d1512, 0.9);
    panel.roundRect(c.x, c.y, c.w, c.h, 10).stroke({ width: 1, color: 0x6c7f6a, alpha: 0.5 });
    layer.addChild(panel);
    const typeLabel = view.topic.type === "synonym" ? "同义词主题" : "释义主题";
    const tag = text(typeLabel, 9, 0x92a891);
    tag.anchor.set(0.5);
    tag.position.set(cx, c.y + 11);
    layer.addChild(tag);
    const prompt = text(view.topic.prompt || view.topic.promptTokens?.join("；") || "", 15, 0xf2e6c8, {
      wordWrap: true,
      wordWrapWidth: c.w - 40,
    });
    prompt.anchor.set(0.5);
    prompt.position.set(cx, c.y + 41);
    layer.addChild(prompt);
    const x = view.x;
    const textX = text(`本轮声称  ${x} / 6`, 12, x > 6 ? 0xe08a6a : 0xb9c8b4);
    textX.anchor.set(0.5);
    textX.position.set(cx, c.y + 69);
    layer.addChild(textX);
    const nameOf = (id) => (id === 0 ? "你" : `面具${"一二三"[id - 1]}`);
    const parts = [];
    const humanTurnNow = view.phase === "turn" && view.currentPlayer === 0 && !view.result;
    if (view.phase === "turn" && !view.result) {
      parts.push(humanTurnNow ? "轮到你" : `轮到 ${nameOf(view.currentPlayer)}`);
    }
    const lastSeg = view.chain && view.chain.length ? view.chain[view.chain.length - 1] : null;
    if (lastSeg) {
      parts.push(`刚才 ${nameOf(lastSeg.player)} 出了 ${lastSeg.count || lastSeg.claimed || 1} 张`);
    }
    if (parts.length) {
      const hint = text(parts.join(" · "), 10, humanTurnNow ? 0x7fd6b2 : 0xdfd7c4);
      hint.anchor.set(0.5);
      hint.position.set(cx, c.y - 16);
      layer.addChild(hint);
      if (humanTurnNow) {
        gsap.to(hint, { alpha: 0.45, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut" });
      }
    }
  }

  animateAiPlay(playerId, words = []) {
    const from = this.layout.avatars[playerId];
    const slot = this.layout.slots[playerId];
    const list = words.slice(0, 3);
    list.forEach((word, i) => {
      const node = this.makeCard({ w: word, truth: false }, false, true);
      node.scale.set(0.5);
      node.position.set(from.x, from.y);
      this.layers.fx.addChild(node);
      gsap.to(node, {
        x: slot.x + (i - (list.length - 1) / 2) * 24,
        y: slot.y,
        rotation: (i - (list.length - 1) / 2) * 0.05,
        alpha: 0.9,
        scale: 0.42,
        duration: this.reducedMotion ? 0.01 : 0.55,
        ease: "power2.inOut",
        onComplete: () => {
          gsap.to(node, {
            alpha: 0,
            duration: 0.2,
            delay: 0.25,
            onComplete: () => node.destroy(),
          });
        },
      });
    });
  }

  animateHumanPlay(cardIds, captured = null) {
    const nodes = (captured || this.handCards)
      .filter((node) => cardIds.includes((node.cardData || node).id));
    const slot = this.layout.slots[0];
    nodes.forEach((node, i) => {
      const clone = this.makeCard(node.cardData, true, true);
      clone.position.set(node.x, node.y);
      clone.scale.set(0.85);
      clone.rotation = node.rotation;
      this.layers.hand.addChild(clone);
      gsap.to(clone, {
        x: slot.x + (i - (nodes.length - 1) / 2) * 24,
        y: slot.y,
        rotation: (i - (nodes.length - 1) / 2) * 0.05,
        scale: 0.42,
        alpha: 0.95,
        duration: this.reducedMotion ? 0.01 : 0.55,
        ease: "power2.inOut",
        onComplete: () => {
          gsap.to(clone, { alpha: 0, duration: 0.18, delay: 0.2, onComplete: () => clone.destroy() });
        },
      });
    });
  }

  animateChallenge(playerId) {
    const pos = this.layout.avatars[playerId];
    const stamp = text("质疑！", 26, 0xd4584a, { fontWeight: "bold", letterSpacing: 4 });
    stamp.anchor.set(0.5);
    stamp.position.set(pos.x, pos.y);
    stamp.scale.set(1.8);
    stamp.alpha = 0;
    this.layers.fx.addChild(stamp);
    gsap.to(stamp, {
      alpha: 1,
      scale: 1,
      duration: this.reducedMotion ? 0.01 : 0.28,
      ease: "back.out(2)",
      onComplete: () => {
        gsap.to(stamp, { alpha: 0, y: pos.y - 34, duration: 0.35, delay: 0.6, onComplete: () => stamp.destroy() });
      },
    });
    this.shake();
  }

  shake() {
    if (this.reducedMotion) return;
    const root = this.root;
    gsap.fromTo(root, { x: -6 }, {
      x: 0, duration: 0.35, ease: "elastic.out(1.2, 0.3)",
    });
  }

  flashSeat(playerId) {
    const pos = this.layout.avatars[playerId];
    const flash = new Graphics();
    flash.circle(pos.x, pos.y, 42).fill({ color: 0xd23a3a, alpha: 0.5 });
    this.layers.fx.addChild(flash);
    gsap.to(flash, { alpha: 0, duration: 0.7, onComplete: () => flash.destroy() });
  }

  render(view, { deal = false, animatePlay = null, animateChallengeId = null } = {}) {
    this.view = view;
    this.renderPiles(view, { skipLast: !!animatePlay });
    this.renderSeats(view);
    this.renderCenter(view);
    // 手牌重绘会销毁旧节点，先记下打出的牌的原位置再补动画
    const captured = animatePlay && animatePlay.playerId === 0
      ? this.handCards.map((node) => ({
        cardData: node.cardData,
        x: node.x,
        y: node.y,
        rotation: node.rotation,
      }))
      : null;
    this.renderHand(view, { deal });
    const hand = this.layers.hand;
    hand.zIndex = 10;
    if (animatePlay) {
      if (animatePlay.playerId === 0) this.animateHumanPlay(animatePlay.cardIds || [], captured);
      else this.animateAiPlay(animatePlay.playerId, animatePlay.words || []);
    }
    if (animateChallengeId != null) this.animateChallenge(animateChallengeId);
  }

  setHandEnabled(enabled) {
    this.handEnabled = enabled;
    for (const node of this.handCards) {
      node.interactive = enabled;
      node.eventMode = enabled ? "static" : "none";
      node.alpha = enabled ? 1 : 0.72;
    }
  }

  destroy() {
    if (this.resizeHandler) {
      window.removeEventListener("resize", this.resizeHandler);
      window.removeEventListener("orientationchange", this.resizeHandler);
      this.resizeHandler = null;
    }
    clearTimeout(this.contextTimer);
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false });
      this.app = null;
    }
  }
}
