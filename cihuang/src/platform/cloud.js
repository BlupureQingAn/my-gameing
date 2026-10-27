// 与主站共享登录态：pb_auth_token + bitlife_user_cache_v1。
// 所有网络失败都降级为本地模式，不阻断对局。

const CLIENT_KEY = "cihuang_client_id";
const LICENSE_KEY = "cihuang_license_v1";
const EMAIL_KEY = "pb_auth_email";
const USER_CACHE_KEY = "bitlife_user_cache_v1";

// 打包版（APK / 桌面 / Steam）通过 index.html 注入该全局开关：买断离线，无登录、无云同步。
const OFFLINE = typeof window !== "undefined" && window.__CIHUANG_OFFLINE__ === true;

export function isOffline() {
  return OFFLINE;
}

// 词谎买断（¥21）与主站会员完全解耦：只认 /api/cihuang/entitlement 的结果
let licensed = false;
let licensedAt = "";
try {
  const cached = JSON.parse(localStorage.getItem(LICENSE_KEY) || "null");
  if (cached && cached.licensed) {
    licensed = true;
    licensedAt = String(cached.purchasedAt || "");
  }
} catch (e) {}

export function authToken() {
  try {
    return localStorage.getItem("pb_auth_token") || "";
  } catch (e) {
    return "";
  }
}

export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null");
  } catch (e) {
    return null;
  }
}

export function accountIdentity() {
  try {
    return localStorage.getItem(EMAIL_KEY) || "";
  } catch (e) {
    return "";
  }
}

export function isLoggedIn() {
  return !!authToken() && !!currentUser();
}

export function storeAuthSession(token, identity, record) {
  const user = record || {};
  try {
    localStorage.setItem("pb_auth_token", token);
    localStorage.setItem(EMAIL_KEY, String(identity || ""));
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify({
      id: user.id || "",
      email: user.email || identity || "",
      coins: Number(user.coins ?? 0),
      membership_type: user.membership_type || "",
      membership_expires_at: user.membership_expires_at || "",
      nickname: user.nickname || user.username || "",
      signature: user.signature || "",
      faceimg: user.faceimg || "",
      social: user.social_uid ? 1 : 0,
      ts: Date.now(),
    }));
  } catch (e) {}
  licensed = false;
  licensedAt = "";
  try { localStorage.removeItem(LICENSE_KEY); } catch (e) {}
}

export function clearAuthSession() {
  try {
    localStorage.removeItem("pb_auth_token");
    localStorage.removeItem(EMAIL_KEY);
    localStorage.removeItem(USER_CACHE_KEY);
    localStorage.removeItem(LICENSE_KEY);
  } catch (e) {}
  licensed = false;
  licensedAt = "";
}

export function hasLicense() {
  return OFFLINE || licensed;
}

export function licensePurchasedAt() {
  return licensedAt;
}

export async function fetchEntitlement() {
  if (OFFLINE) return { licensed: true, purchasedAt: "" };
  if (!isLoggedIn()) {
    licensed = false;
    licensedAt = "";
    try { localStorage.removeItem(LICENSE_KEY); } catch (e) {}
    return { licensed: false, purchasedAt: "" };
  }
  try {
    const data = await api("/api/cihuang/entitlement");
    licensed = data?.licensed === true;
    licensedAt = String(data?.purchasedAt || "");
    try {
      if (licensed) localStorage.setItem(LICENSE_KEY, JSON.stringify({ licensed, purchasedAt: licensedAt }));
      else localStorage.removeItem(LICENSE_KEY);
    } catch (e) {}
    return { licensed, purchasedAt: licensedAt };
  } catch (e) {
    return { licensed, purchasedAt: licensedAt };
  }
}

export async function createPayOrder(planId = "cihuang_full") {
  return api("/api/pay/create", {
    method: "POST",
    body: { planId, payType: "wxpay" },
    timeout: 15000,
  });
}

export async function payStatus(orderNo) {
  return api(`/api/pay/status?out_trade_no=${encodeURIComponent(orderNo)}`);
}

export function isMember() {
  const user = currentUser();
  if (!user || !user.membership_type) return false;
  if (user.membership_type === "lifetime") return true;
  return !!(user.membership_expires_at && Date.parse(user.membership_expires_at) > Date.now());
}

export function nickname() {
  const user = currentUser();
  const raw = String(user?.nickname || user?.name || user?.username || "").trim();
  return raw ? raw.slice(0, 20) : "";
}

export function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = `c_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id.slice(0, 64);
  } catch (e) {
    return "c_anonymous";
  }
}

async function api(path, { method = "GET", body = null, timeout = 12000 } = {}) {
  if (OFFLINE) throw new Error("离线版不联网");
  const headers = { "Content-Type": "application/json" };
  const token = authToken();
  if (token) headers["X-Auth-Token"] = token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(path, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const error = new Error(data.error || `请求失败 ${res.status}`);
      error.code = data.code || "";
      error.status = res.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function startRun(band, difficulty) {
  if (!isLoggedIn()) return null;
  try {
    const data = await api("/api/cihuang/run/start", {
      method: "POST",
      body: { band, difficulty },
    });
    if (!data?.run_id || !data?.seed) return null;
    return data;
  } catch (e) {
    return null;
  }
}

export async function finishRun(payload) {
  if (!isLoggedIn()) return null;
  try {
    return await api("/api/cihuang/run/finish", { method: "POST", body: payload, timeout: 15000 });
  } catch (e) {
    return { ok: false, error: e.message, code: e.code || "" };
  }
}

export async function leaderboard(difficulty) {
  return api(`/api/cihuang/leaderboard?difficulty=${encodeURIComponent(difficulty)}`);
}

export async function setLeaderboardOptIn(optIn) {
  return api("/api/cihuang/leaderboard/opt", { method: "POST", body: { opt_in: !!optIn } });
}

export async function getProfile() {
  if (!hasLicense()) return null;
  try {
    const data = await api("/api/cihuang/profile");
    return data?.profile || null;
  } catch (e) {
    return null;
  }
}

export async function putProfile(profile) {
  if (!hasLicense()) return false;
  try {
    await api("/api/cihuang/profile", {
      method: "PUT",
      body: {
        crystals: profile.crystals,
        cosmetics: profile.cosmetics,
        equipped: profile.equipped,
        settings: profile.settings,
      },
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function listVocab(band = "") {
  if (!hasLicense()) return null;
  try {
    const query = band ? `?band=${encodeURIComponent(band)}&perPage=100` : "?perPage=100";
    const data = await api(`/api/cihuang/vocab${query}`);
    return Array.isArray(data?.items) ? data.items : null;
  } catch (e) {
    return null;
  }
}

export async function pushVocab(entry) {
  if (!hasLicense()) return null;
  try {
    const data = await api("/api/cihuang/vocab", {
      method: "POST",
      body: {
        w: entry.w,
        band: entry.band,
        ipa: entry.ipa,
        pos: entry.pos,
        glossZh: entry.glossZh,
        glossEn: entry.glossEn,
        topicType: entry.topicType,
        topicPrompt: entry.topicPrompt,
        source: entry.source,
      },
    });
    return data?.item || null;
  } catch (e) {
    return null;
  }
}

export async function patchVocab(cloudId, entry) {
  if (!hasLicense() || !cloudId) return false;
  try {
    await api(`/api/cihuang/vocab?id=${encodeURIComponent(cloudId)}`, {
      method: "PATCH",
      body: { streak: entry.streak, reviews: entry.reviews, lastResult: entry.lastResult },
    });
    return true;
  } catch (e) {
    return false;
  }
}

export async function removeVocab(cloudId) {
  if (!hasLicense() || !cloudId) return false;
  try {
    await api(`/api/cihuang/vocab?id=${encodeURIComponent(cloudId)}`, { method: "DELETE" });
    return true;
  } catch (e) {
    return false;
  }
}

const telemetry = [];
let flushTimer = null;

export function track(event, props = {}) {
  telemetry.push({ event, props, ts: Date.now() });
  if (telemetry.length >= 12) flushEvents();
  else if (!flushTimer) flushTimer = setTimeout(flushEvents, 4000);
}

export async function flushEvents() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (!telemetry.length) return;
  const batch = telemetry.splice(0, 20);
  try {
    await api("/api/cihuang/events", {
      method: "POST",
      body: { client_id: clientId(), events: batch },
      timeout: 6000,
    });
  } catch (e) {
    // 遥测失败直接丢弃，不重试以免放大流量
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => { flushEvents(); });
}
