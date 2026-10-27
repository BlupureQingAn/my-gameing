import test from "node:test";
import assert from "node:assert/strict";
import { fitWorld } from "../src/core/layout.js";

test("landscape 16:9 fills height and centers horizontally", () => {
  const fit = fitWorld(1920, 1080, 960, 640);
  assert.equal(fit.scale, 1.6875);
  assert.equal(fit.x, 150);
  assert.equal(fit.y, 0);
});

test("ultra-wide keeps full design height instead of cropping", () => {
  const fit = fitWorld(2400, 1080, 960, 640);
  assert.equal(fit.scale, 1.6875);
  assert.equal(fit.x, 390);
  assert.equal(fit.y, 0);
});

test("portrait viewport centers vertically without black bar logic", () => {
  const fit = fitWorld(390, 844, 480, 900);
  assert.ok(Math.abs(fit.scale - 0.8125) < 1e-9);
  assert.equal(fit.x, 0);
  assert.equal(fit.y, 56);
});

test("small viewport scales below one and never clips content", () => {
  const fit = fitWorld(800, 600, 960, 640);
  assert.ok(Math.abs(fit.scale - 800 / 960) < 1e-9);
  assert.equal(fit.x, 0);
  assert.equal(fit.y, 33);
  assert.ok(fit.y * 2 + 640 * fit.scale <= 600);
});

test("large desktop upscales instead of staying at the design size", () => {
  const fit = fitWorld(3840, 2160, 960, 640);
  assert.equal(fit.scale, 3.375);
  assert.equal(fit.x, 300);
  assert.equal(fit.y, 0);
});
