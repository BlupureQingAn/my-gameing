// 站内账号：复用主站 PB 用户库与 worker 验证码接口，登录态仍写主站共享的 localStorage。

const PB_URL = "https://db.blupure.cn";
const AUTH_COLLECTION = "users";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function validateAuthValues(mode, values = {}) {
  const identity = String(values.identity || "").trim();
  const email = normalizeEmail(values.email);
  const code = String(values.code || "").trim();
  const password = String(values.password || "");
  const passwordConfirm = String(values.passwordConfirm || "");
  const username = String(values.username || "").trim();

  if (mode === "login") {
    if (!identity) return { ok: false, error: "请输入账号或邮箱" };
    if (!password) return { ok: false, error: "请输入密码" };
    return { ok: true, values: { identity, password } };
  }
  if (!EMAIL_RE.test(email)) return { ok: false, error: "请输入正确的邮箱地址" };
  if (!/^\d{6}$/.test(code)) return { ok: false, error: "请输入 6 位验证码" };
  if (password.length < 8) return { ok: false, error: "密码至少需要 8 位" };
  if (password !== passwordConfirm) return { ok: false, error: "两次输入的密码不一致" };
  if (mode === "register" && username && !USERNAME_RE.test(username)) {
    return { ok: false, error: "昵称需为 3-30 位字母、数字、下划线或短横线" };
  }
  if (mode === "register") {
    return { ok: true, values: { email, code, password, passwordConfirm, username } };
  }
  return { ok: true, values: { email, code, password, passwordConfirm } };
}

export async function loginWithPassword(identity, password) {
  let res;
  try {
    res = await fetch(`${PB_URL}/api/collections/${AUTH_COLLECTION}/auth-with-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identity, password }),
    });
  } catch (e) {
    const error = new Error("网络异常，请稍后重试");
    error.code = "NETWORK";
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.token) {
    const error = new Error(res.status === 429 ? "尝试次数过多，请稍后再试" : "账号或密码错误，请检查后重试");
    error.code = res.status === 429 ? "TOO_MANY" : "AUTH_FAILED";
    error.status = res.status;
    throw error;
  }
  return { token: data.token, record: data.record || null };
}

async function postAuth(path, body) {
  let res;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const error = new Error("网络异常，请稍后重试");
    error.code = "NETWORK";
    throw error;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `请求失败 ${res.status}`);
    error.code = data.code || "";
    error.status = res.status;
    error.retryAfter = Number(data?.detail?.retryAfter) || 0;
    throw error;
  }
  return data;
}

export function sendAuthCode(email, purpose = "register") {
  return postAuth("/api/auth/send-code", { email, purpose });
}

export function registerAccount({ email, code, password, passwordConfirm, username }) {
  return postAuth("/api/auth/register", {
    email,
    code,
    password,
    passwordConfirm,
    ...(username ? { username } : {}),
  });
}

export function resetAccountPassword({ email, code, password, passwordConfirm }) {
  return postAuth("/api/auth/reset-password", { email, code, password, passwordConfirm });
}
