import { Application, Assets, Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { gsap } from "gsap";
import { COSMETIC_INDEX } from "../platform/store.js";

const W = 960;
const H = 640;
const CARD_W = 96;
const CARD_H = 136;
const FONT = "Fusion Pixel, SimSun, monospace";

const SEAT_POS = [
  { x: 480, y: 545 },
  { x: 130, y: 300 },
  { x: 480, y: 110 },
  { x: 830, y: 300 },
];
const AVATAR_POS = [
  { x: 150, y: 560 },
  { x: 92, y: 212 },
  { x: 480, y: 56 },
  { x: 868, y: 212 },
];
const PLAYER_COLORS = [0x7fd6b2, 0x8fb6e8, 0xe8b26a, 0xe88fa8];
const MASK_FILES = ["", "mask1.webp", "mask2.webp", "mask3.webp"];

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
  }

  async init() {
    this.app = new Application();
    await this.app.init({
      width: W,
      height: H,
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
    this.layers.seats = new Container();
    this.layers.center = new Container();
    this.layers.chain = new Container();
    this.layers.fx = new Container();
    this.layers.hand = new Container();
    this.layers.hand.sortableChildren = true;
    for (const key of ["bg", "table", "seats", "center", "chain", "fx", "hand"]) {
      this.root.addChild(this.layers[key]);
    }
    this.textures = {};
    await this.loadArt();
    this.buildBackground();
    this.buildTable();
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
  }

  buildBackground() {
    const layer = this.layers.bg;
    layer.removeChildren();
    const bg = new Graphics();
    bg.rect(0, 0, W, H).fill({ color: 0x06100d });
    layer.addChild(bg);
    const texture = this.textures["tavern.webp"];
    if (texture) {
      const sprite = new Sprite(texture);
      const scale = Math.max(W / texture.width, H / texture.height);
      sprite.anchor.set(0.5);
      sprite.position.set(W / 2, H / 2);
      sprite.scale.set(scale);
      sprite.alpha = 0.55;
      layer.addChild(sprite);
    }
    const shade = new Graphics();
    shade.rect(0, 0, W, H).fill({ color: 0x02100c, alpha: 0.35 });
    for (let i = 0; i < 5; i += 1) {
      shade.rect(0, i * 28, W, 28).fill({ color: 0x000000, alpha: 0.025 });
    }
    layer.addChild(shade);
    const vignette = new Graphics();
    vignette.ellipse(W / 2, H / 2, W * 0.62, H * 0.65).fill({ color: 0x000000, alpha: 0 });
    layer.addChild(vignette);
  }

  buildTable() {
    const layer = this.layers.table;
    layer.removeChildren();
    const felt = COSMETIC_INDEX[this.equipped.felt?.id] || this.equipped.felt || COSMETIC_INDEX.felt_default;
    const rim = new Graphics();
    rim.ellipse(W / 2, 330, 392, 218).fill({ color: 0x2a1810 });
    rim.ellipse(W / 2, 330, 382, 210).fill({ color: 0x170f0a });
    rim.ellipse(W / 2, 330, 366, 197).fill({ color: felt.color });
    rim.ellipse(W / 2, 330, 338, 180).stroke({ width: 3, color: felt.accent, alpha: 0.45 });
    rim.ellipse(W / 2, 330, 366, 197).stroke({ width: 2, color: 0xd8c690, alpha: 0.25 });
    layer.addChild(rim);
    const weave = new Graphics();
    for (let x = 120; x < 850; x += 14) {
      weave.moveTo(x, 140).lineTo(x + 40, 520).stroke({ width: 1, color: 0x000000, alpha: 0.05 });
    }
    layer.addChild(weave);
    const crest = text("词 谎", 30, 0xe8dcc0, { letterSpacing: 12 });
    crest.anchor.set(0.5);
    crest.position.set(W / 2, 336);
    crest.alpha = 0.14;
    layer.addChild(crest);
  }

  setEquipped(equipped) {
    this.equipped = equipped;
    if (this.app) this.buildTable();
  }

  makeCard(card, faceUp = true, compact = false) {
    const w = compact ? CARD_W * 0.72 : CARD_W;
    const h = compact ? CARD_H * 0.72 : CARD_H;
    const node = new Container();
    node.pivot.set(w / 2, h / 2);
    const cardback = COSMETIC_INDEX[this.equipped.cardback?.id] || COSMETIC_INDEX.cb_default;
    const g = new Graphics();
    rounded(g, -w / 2, -h / 2, w, h, 8, 0x120d0b);
    rounded(g, -w / 2 + 2, -h / 2 + 2, w - 4, h - 4, 7, card.joker ? 0x392247 : (card.review ? 0x2c3a26 : 0x1b1310));
    g.roundRect(-w / 2 + 5, -h / 2 + 5, w - 10, h - 10, 5)
      .stroke({ width: 1, color: card.joker ? 0xd9b3ff : cardback.accent, alpha: 0.75 });
    node.addChild(g);
    if (!faceUp) {
      const back = new Graphics();
      back.roundRect(-w / 2 + 10, -h / 2 + 10, w - 20, h - 20, 4)
        .fill({ color: cardback.color, alpha: 0.9 })
        .stroke({ width: 1, color: cardback.accent, alpha: 0.5 });
      back.circle(0, 0, 14).stroke({ width: 2, color: cardback.accent, alpha: 0.55 });
      back.moveTo(-12, 0).lineTo(12, 0).stroke({ width: 2, color: cardback.accent, alpha: 0.55 });
      back.moveTo(0, -12).lineTo(0, 12).stroke({ width: 2, color: cardback.accent, alpha: 0.55 });
      node.addChild(back);
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

  handTargets(count) {
    const spacing = count <= 5 ? 104 : 88;
    const start = W / 2 - ((count - 1) * spacing) / 2;
    return Array.from({ length: count }, (_, i) => ({
      x: start + i * spacing,
      y: SEAT_POS[0].y,
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
      node.position.set(deal ? W / 2 : target.x, deal ? 330 : target.y);
      node.rotation = deal ? 0 : target.rot;
      node.alpha = deal ? 0 : 1;
      node.eventMode = "static";
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
          duration: this.reducedMotion ? 0.01 : 0.35,
          delay: this.reducedMotion ? 0 : i * 0.08,
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
    this.pendingDrag = {
      card,
      node,
      startY: event.global.y,
      startX: event.global.x,
      moved: false,
      originY: node.y,
    };
    const onMove = (moveEvent) => {
      if (!this.pendingDrag) return;
      const dy = moveEvent.global.y - this.pendingDrag.startY;
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
      const dy = upEvent.global.y - drag.startY;
      this.pendingDrag = null;
      if (dy < -90) {
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
    const pos = AVATAR_POS[seat];
    const group = new Container();
    group.position.set(pos.x, pos.y);
    const color = PLAYER_COLORS[seat];
    const ring = new Graphics();
    ring.circle(0, 0, 32).fill({ color: 0x0b1210, alpha: 0.92 });
    ring.circle(0, 0, 32).stroke({ width: 2, color, alpha: player.alive ? 0.9 : 0.25 });
    group.addChild(ring);
    if (seat === 0) {
      const you = text("你", 15, color);
      you.anchor.set(0.5);
      group.addChild(you);
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
      layer.addChild(this.makeAvatar(view, seat));
    }
    // AI 手牌背面扇形
    for (const seat of [1, 2, 3]) {
      const player = view.players[seat];
      if (!player.alive) continue;
      const pos = AVATAR_POS[seat];
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
  }

  renderCenter(view) {
    const layer = this.layers.center;
    clearLayer(layer);
    if (!view.topic) return;
    const panel = new Graphics();
    rounded(panel, W / 2 - 170, 262, 340, 84, 10, 0x0d1512, 0.9);
    panel.roundRect(W / 2 - 170, 262, 340, 84, 10).stroke({ width: 1, color: 0x6c7f6a, alpha: 0.5 });
    layer.addChild(panel);
    const typeLabel = view.topic.type === "synonym" ? "同义词主题" : "释义主题";
    const tag = text(typeLabel, 9, 0x92a891);
    tag.anchor.set(0.5);
    tag.position.set(W / 2, 273);
    layer.addChild(tag);
    const prompt = text(view.topic.prompt || view.topic.promptTokens?.join("；") || "", 15, 0xf2e6c8, {
      wordWrap: true,
      wordWrapWidth: 300,
    });
    prompt.anchor.set(0.5);
    prompt.position.set(W / 2, 303);
    layer.addChild(prompt);
    const x = view.x;
    const textX = text(`声称  ${x} / 6`, 12, x > 6 ? 0xe08a6a : 0xb9c8b4);
    textX.anchor.set(0.5);
    textX.position.set(W / 2, 331);
    layer.addChild(textX);
    if (view.currentPlayer === 0 && view.phase === "turn" && !view.result) {
      const hint = text("你的回合", 10, 0x7fd6b2);
      hint.anchor.set(0.5);
      hint.position.set(W / 2, 246);
      layer.addChild(hint);
      gsap.to(hint, { alpha: 0.45, duration: 0.9, yoyo: true, repeat: -1, ease: "sine.inOut" });
    }
  }

  renderChain(view) {
    const layer = this.layers.chain;
    clearLayer(layer);
    const chain = view.chain || [];
    if (!chain.length) return;
    const startX = W / 2 - ((chain.length - 1) * 78) / 2;
    chain.forEach((segment, i) => {
      const x = startX + i * 78;
      const y = 392 + (i % 2) * 8;
      const color = PLAYER_COLORS[segment.player];
      const chip = new Graphics();
      rounded(chip, x - 34, y - 14, 68, 28, 8, 0x0c1210, 0.92);
      chip.roundRect(x - 34, y - 14, 68, 28, 8).stroke({ width: 1, color, alpha: segment.challenged ? 0.25 : 0.6 });
      layer.addChild(chip);
      const label = text(`${segment.player === 0 ? "你" : `面具${"一二三"[segment.player - 1]}`} +${segment.claimed}`, 10, color, {
        wordWrap: false,
      });
      label.anchor.set(0.5);
      label.position.set(x, y);
      if (segment.challenged) label.alpha = 0.4;
      layer.addChild(label);
    });
    const total = text(`X = ${view.x}`, 11, view.x > 6 ? 0xe08a6a : 0x9fb7a7);
    total.anchor.set(0.5);
    total.position.set(W / 2, 430);
    layer.addChild(total);
  }

  animateAiPlay(playerId, words = []) {
    const from = AVATAR_POS[playerId];
    words.slice(0, 3).forEach((word, i) => {
      const node = this.makeCard({ w: word, truth: false }, false, true);
      node.scale.set(0.5);
      node.position.set(from.x, from.y);
      this.layers.fx.addChild(node);
      gsap.to(node, {
        x: W / 2 + (i - 1) * 12,
        y: 384,
        rotation: (i - 1) * 0.08,
        alpha: 0.9,
        scale: 0.62,
        duration: this.reducedMotion ? 0.01 : 0.42,
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
    nodes.forEach((node, i) => {
      const clone = this.makeCard(node.cardData, true, true);
      clone.position.set(node.x, node.y);
      clone.scale.set(0.85);
      clone.rotation = node.rotation;
      this.layers.hand.addChild(clone);
      gsap.to(clone, {
        x: W / 2 + (i - 1) * 10,
        y: 380,
        rotation: (i - 1) * 0.1,
        scale: 0.62,
        alpha: 0.95,
        duration: this.reducedMotion ? 0.01 : 0.36,
        ease: "power2.inOut",
        onComplete: () => {
          gsap.to(clone, { alpha: 0, duration: 0.18, delay: 0.2, onComplete: () => clone.destroy() });
        },
      });
    });
  }

  animateChallenge(playerId) {
    const pos = AVATAR_POS[playerId];
    const stamp = text("质疑！", 26, 0xd4584a, { fontWeight: "bold", letterSpacing: 4 });
    stamp.anchor.set(0.5);
    stamp.position.set(pos.x, pos.y);
    stamp.scale.set(1.8);
    stamp.alpha = 0;
    this.layers.fx.addChild(stamp);
    gsap.to(stamp, {
      alpha: 1,
      scale: 1,
      duration: this.reducedMotion ? 0.01 : 0.18,
      ease: "back.out(2)",
      onComplete: () => {
        gsap.to(stamp, { alpha: 0, y: pos.y - 30, duration: 0.4, delay: 0.55, onComplete: () => stamp.destroy() });
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
    const pos = AVATAR_POS[playerId];
    const flash = new Graphics();
    flash.circle(pos.x, pos.y, 42).fill({ color: 0xd23a3a, alpha: 0.5 });
    this.layers.fx.addChild(flash);
    gsap.to(flash, { alpha: 0, duration: 0.7, onComplete: () => flash.destroy() });
  }

  render(view, { deal = false, animatePlay = null, animateChallengeId = null } = {}) {
    this.view = view;
    this.renderSeats(view);
    this.renderCenter(view);
    this.renderChain(view);
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
    for (const node of this.handCards) {
      node.interactive = enabled;
      node.eventMode = enabled ? "static" : "none";
      node.alpha = enabled ? 1 : 0.72;
    }
  }

  destroy() {
    if (this.app) {
      this.app.destroy(true, { children: true, texture: false });
      this.app = null;
    }
  }
}
