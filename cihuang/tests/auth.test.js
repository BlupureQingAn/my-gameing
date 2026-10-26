import test from "node:test";
import assert from "node:assert/strict";
import { normalizeEmail, validateAuthValues } from "../src/platform/auth.js";

test("normalizeEmail trims and lowercases", () => {
  assert.equal(normalizeEmail("  Player@Example.COM "), "player@example.com");
  assert.equal(normalizeEmail(""), "");
});

test("login requires both identity and password", () => {
  assert.equal(validateAuthValues("login", {}).ok, false);
  assert.equal(validateAuthValues("login", { identity: "a@b.com" }).ok, false);
  const ok = validateAuthValues("login", { identity: " player ", password: "secret123" });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values, { identity: "player", password: "secret123" });
});

test("register validates email, code, password length and confirmation", () => {
  const base = { email: "a@b.com", code: "123456", password: "secret123", passwordConfirm: "secret123" };
  assert.equal(validateAuthValues("register", { ...base, email: "bad" }).ok, false);
  assert.equal(validateAuthValues("register", { ...base, code: "12ab" }).ok, false);
  assert.equal(validateAuthValues("register", { ...base, password: "short", passwordConfirm: "short" }).ok, false);
  assert.equal(validateAuthValues("register", { ...base, passwordConfirm: "secret124" }).ok, false);
  assert.equal(validateAuthValues("register", base).ok, true);
});

test("register normalizes email and validates optional username", () => {
  const base = { email: " A@B.COM ", code: "123456", password: "secret123", passwordConfirm: "secret123" };
  const bad = validateAuthValues("register", { ...base, username: "a!" });
  assert.equal(bad.ok, false);
  const ok = validateAuthValues("register", { ...base, username: "player_01" });
  assert.equal(ok.ok, true);
  assert.equal(ok.values.email, "a@b.com");
  assert.equal(ok.values.username, "player_01");
  const empty = validateAuthValues("register", base);
  assert.equal(empty.values.username, "");
});

test("reset follows the same email, code and password rules", () => {
  const base = { email: "a@b.com", code: "123456", password: "newsecret", passwordConfirm: "newsecret" };
  assert.equal(validateAuthValues("reset", base).ok, true);
  assert.equal(validateAuthValues("reset", { ...base, code: "" }).ok, false);
  assert.equal(validateAuthValues("reset", { ...base, passwordConfirm: "other" }).ok, false);
});
