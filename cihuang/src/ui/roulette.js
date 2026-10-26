// 左轮六阶段演出：推近 → 装填 → 转轮 → 静默 → 击发 → 结果。
// 枪体与弹巢由 cosmetics.buildRevolver 绘制，与装扮预览共用同一套外观。

import { Application, Container, Graphics } from "pixi.js";
import { gsap } from "gsap";
import { buildRevolver } from "./cosmetics.js";
import { sfx } from "./audio.js";

const W = 320;
const H = 200;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 全局复用一个 WebGL 渲染器：每局新建/销毁 Application 会在手机上累积 WebGL
// 上下文，超过浏览器上限时牌桌画布会被顶掉而黑屏。
let sharedApp = null;
let sharedReady = null;

async function acquireApp() {
  if (!sharedReady) {
    const app = new Application();
    sharedApp = app;
    sharedReady = app.init({
      width: W,
      height: H,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
      preference: "webgl",
    }).then(() => {
      app.canvas.className = "gun-canvas";
      app.canvas.addEventListener("webglcontextlost", (event) => event.preventDefault());
      return app;
    });
  }
  const app = await sharedReady;
  app.start();
  return app;
}

function buildFlash() {
  const flash = new Graphics();
  flash.circle(0, 0, 13).fill({ color: 0xfff4cf });
  flash.circle(0, 0, 7).fill({ color: 0xffffff });
  for (let i = 0; i < 9; i += 1) {
    const angle = (i / 9) * Math.PI * 2 + 0.2;
    const len = i % 2 ? 26 : 42;
    flash.moveTo(0, 0);
    flash.lineTo(Math.cos(angle) * len, Math.sin(angle) * len * 0.7);
    flash.lineTo(Math.cos(angle + 0.22) * 12, Math.sin(angle + 0.22) * 12);
    flash.closePath();
    flash.fill({ color: i % 2 ? 0xffce7a : 0xffefc0, alpha: 0.85 });
  }
  return flash;
}

export async function runRoulette({ host, item, outcome, reducedMotion, onStage = () => {} }) {
  const rm = !!reducedMotion;
  const dur = (v) => (rm ? Math.max(0.02, v * 0.17) : v);
  // 每个补间都登记，收尾时逐个 kill()。用 killTweensOf([多个目标]) 时，
  // 尚未初始化过的补间只会被摘掉属性、不会移出时间线；留在时间线里的补间
  // 随后去读写已销毁的 Pixi 对象会每帧抛错，卡死之后所有 GSAP 动画。
  const tweens = [];
  const play = (target, vars) => {
    const tween = gsap.to(target, vars);
    tweens.push(tween);
    return tween;
  };
  const playFrom = (target, fromVars, toVars) => {
    const tween = gsap.fromTo(target, fromVars, toVars);
    tweens.push(tween);
    return tween;
  };

  const app = await acquireApp();
  for (const child of app.stage.removeChildren()) child.destroy({ children: true });
  host.querySelectorAll("canvas").forEach((canvas) => canvas.remove());
  host.appendChild(app.canvas);

  const root = new Container();
  app.stage.addChild(root);

  const vignette = new Graphics();
  vignette.ellipse(W / 2, H / 2 + 4, 148, 94).stroke({ width: 92, color: 0x000000, alpha: 0.78 });
  vignette.alpha = rm ? 0.6 : 0;
  root.addChild(vignette);

  const scene = new Container();
  scene.position.set(84, 106);
  scene.scale.set(rm ? 1.02 : 0.84);
  root.addChild(scene);

  const gun = buildRevolver(item, 1.02);
  scene.addChild(gun.container);

  const flash = buildFlash();
  flash.position.set(84 + 124 * 1.02, 106 - 8 * 1.02);
  flash.alpha = 0;
  flash.scale.set(0.2);
  root.addChild(flash);

  const shade = new Graphics();
  shade.rect(0, 0, W, H).fill({ color: 0xffffff });
  shade.alpha = 0;
  root.addChild(shade);

  const cleanup = () => {
    for (const tween of tweens.splice(0)) {
      try { tween.kill(); } catch (e) {}
    }
    try {
      for (const child of app.stage.removeChildren()) child.destroy({ children: true });
      app.stop();
    } catch (e) {}
  };

  try {
    // 1. 弹巢推近特写 + 呼吸暗角
    onStage("approach");
    play(vignette, {
      alpha: 0.88,
      duration: dur(0.8),
      ease: "sine.inOut",
      yoyo: true,
      repeat: rm ? 0 : 1,
    });
    await new Promise((resolve) => {
      play(scene.scale, {
        x: 1.04,
        y: 1.04,
        duration: dur(0.8),
        ease: "power2.out",
        onComplete: resolve,
      });
    });

    // 2. 装填：六格依次亮起
    onStage("load");
    for (let i = 0; i < gun.chambers.length; i += 1) {
      const chamber = gun.chambers[i];
      sfx.tick();
      play(chamber.glow, {
        alpha: 0.55,
        duration: dur(0.14),
        ease: "power2.out",
        onComplete: () => play(chamber.glow, { alpha: 0.16, duration: dur(0.5) }),
      });
      await wait(dur(0.18));
    }
    await wait(dur(0.2));

    // 3. 转轮：快速旋转后减速，停在本次膛位
    onStage("spin");
    sfx.spin();
    const chamberIndex = Math.min(5, Math.max(0, Number(outcome.draw) || 0));
    const stopAngle = Math.PI / 2 - (chamberIndex * Math.PI) / 3;
    gsap.set(gun.cylinder, { rotation: Math.PI * 2 });
    await new Promise((resolve) => {
      play(gun.cylinder, {
        rotation: Math.PI * 2 * 4 + stopAngle,
        duration: dur(1.8),
        ease: "power3.out",
        onComplete: resolve,
      });
    });
    for (let i = 0; i < 6; i += 1) {
      play(gun.chambers[i].glow, { alpha: 0.05, duration: dur(0.3) });
    }

    // 4. 静默：心跳与手指抖动
    onStage("silence");
    if (!rm) {
      play(scene, { y: 104, duration: 0.34, ease: "sine.inOut", yoyo: true, repeat: 2 });
      play(vignette, { alpha: 0.7, duration: 0.4, ease: "sine.inOut", yoyo: true, repeat: 2 });
    }
    await wait(dur(1.0));

    // 5. 击发
    onStage("fire");
    if (outcome.fire) {
      sfx.shot();
      flash.alpha = 1;
      flash.rotation = Math.random() * Math.PI;
      flash.scale.set(0.4);
      play(flash, { scale: 1.25, alpha: 0, duration: dur(0.45), ease: "power2.out" });
      shade.alpha = 0.65;
      play(shade, { alpha: 0, duration: dur(0.35) });
      if (!rm) {
        playFrom(root, { x: -9, y: 4 }, { x: 0, y: 0, duration: 0.42, ease: "elastic.out(1.1, 0.28)" });
        play(scene, { x: 90, duration: 0.08, yoyo: true, repeat: 1 });
      }
    } else {
      sfx.dry();
      playFrom(scene, { x: 84 }, { x: 82, duration: dur(0.07), yoyo: true, repeat: 2 });
      play(gun.cylinder, { rotation: `+=${0.18}`, duration: dur(0.2), ease: "power1.out" });
      vignette.alpha = 0.95;
    }
    await wait(dur(0.6));

    // 6. 结果：空枪也要留足反馈时间，降低动态偏好时同样至少停留 1.5 秒
    onStage("result", outcome);
    await wait(rm ? 1500 : 2600);
  } finally {
    cleanup();
  }
}
