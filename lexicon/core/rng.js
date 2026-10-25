/* Lexicon Rush - seeded RNG (mulberry32) */
(function (root) {
  "use strict";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function createRng(seed) {
    const nextFn = mulberry32(seed);
    const state = { calls: 0 };
    return {
      seed: seed >>> 0,
      next() {
        state.calls++;
        return nextFn();
      },
      int(max) {
        return Math.floor(this.next() * max);
      },
      pick(arr) {
        return arr[Math.floor(this.next() * arr.length)];
      },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(this.next() * (i + 1));
          const t = a[i];
          a[i] = a[j];
          a[j] = t;
        }
        return a;
      },
    };
  }

  const api = { createRng };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LexiconRng = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
