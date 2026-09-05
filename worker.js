import { BANNED_WORDS } from "./banned_words.js";

// 违禁词过滤:命中返回首个命中词,否则 null;纯字母/数字词要求边界(避免误伤 obsessed 等含 sb 的正常词)
function checkBanned(text) {
    if (!text) return null;
    for (const w of BANNED_WORDS) {
        const idx = text.indexOf(w);
        if (idx === -1) continue;
        if (/^[A-Za-z0-9]+$/.test(w)) {
            const before = idx > 0 ? text[idx - 1] : "";
            const after = text[idx + w.length] || "";
            if (/[A-Za-z0-9]/.test(before) || /[A-Za-z0-9]/.test(after)) continue;
        }
        return w;
    }
    return null;
}

// ==================== 1. 配置中心 ====================

// 云币经济：AI 对话按 token 计费（输入 4 币/千 token、输出 12 币/千 token，向上取整，最低 1 币/轮，失败不扣费；典型对话约 10 币）、解锁 5000 币/张
const TOKEN_PRICE_INPUT = 4;   // 云币/千 token（输入）
const TOKEN_PRICE_OUTPUT = 12; // 云币/千 token（输出）
const TOKEN_COST_MIN = 1;      // 每轮最低消费
const UNLOCK_COST = 5000;
// 创作者分佣：别人玩你的社区卡 30 币/轮（单卡单用户每日最多计 10 轮），解锁分成 1000 币
const COMMUNITY_REWARD_PER_PLAY = 30;
const COMMUNITY_DAILY_PLAY_LIMIT = 10;
const COMMUNITY_UNLOCK_REWARD = 1000;
// 社区动态流防刷：发帖 30 秒间隔/点赞 5 秒间隔（内存 Map，Worker 单实例即可控）
const POST_RATE_LIMIT_MS = 30000;
const LIKE_RATE_LIMIT_MS = 5000;
const DONATE_RATE_LIMIT_MS = 5000;
const postRateMap = new Map();
// Cloudflare Worker 环境是 UTC，固定用 UTC+8 计算"今天"
const TIMEZONE_OFFSET_MS = 8 * 3600 * 1000;
const LIFETIME_EXPIRY = "2226-01-01T00:00:00.000Z";

// ---- token 计费 ----
// 输入 4 币/千 + 输出 12 币/千，向上取整，最低 1 币/轮
function calcTokenCost(inputTokens, outputTokens) {
    const cost = (Number(inputTokens) * TOKEN_PRICE_INPUT + Number(outputTokens) * TOKEN_PRICE_OUTPUT) / 1000;
    return Math.max(TOKEN_COST_MIN, Math.ceil(cost));
}
// 字符估算 token（不修改发给上游的请求体，避免 stream_options 等参数干扰模型输出）：
// 中文 ≈1 token/字，其它 ≈1 token/4 字符
function estimateTokens(text) {
    const s = String(text || "");
    const cjk = (s.match(/[一-鿿]/g) || []).length;
    return Math.ceil(cjk + (s.length - cjk) / 4);
}
function estimateInputTokens(messages) {
    try { return estimateTokens(JSON.stringify(messages || [])); } catch (e) { return 0; }
}
// 成功对话后按实际 token 结算扣费；余额不足扣到 0（下次请求余额 < 最低消费会被拒）
async function settleTokenDeduction(env, userId, record, inputTokens, outputTokens) {
    const cost = calcTokenCost(inputTokens, outputTokens);
    const cur = Number(record.coins || 0);
    const after = Math.max(0, cur - cost);
    if (after === cur) return cost; // 余额已为 0，无需写库
    const res = await pbAdminFetch(env, `/api/collections/users/records/${userId}`, {
        method: "PATCH", body: JSON.stringify({ coins: after })
    });
    if (res.ok) record.coins = after; // 同步内存副本，后续响应引用
    return cost;
}

// 模型池：Worker 自动路由（tier 越小越优先；dailyCap 为当日全局调用上限；enabled=false 池内禁用）
// ChatAnywhere 免费版（gpt_api_free）：每日 10000 点平台额度 + 各模型每日次数上限
const MODEL_POOL = [
    // ---- 讯飞（2026-08-25 实测通过:均为深度推理模型,先输出 reasoning 再出内容;官方并发 20）----
    // X2 主端点(200k tokens): model 名 "spark-x";X2-Flash agent 端点(2M tokens): model 名 "spark-x"
    // X2-Flash 非无限:2M token 免费包(2026-08-29 小徐报剩 1,723,155),实测剧情轮 ~1000-2500 tokens/轮 → dailyCap 150/天≈40 万 tokens/天≈撑 4 天,超额自动 fallback 后续模型
    // 小徐 2026-08-29 新授权 HTTP 服务(每服务独立系统默认 key,除 Lite 无限量外均 <20w token/年,dailyCap 20 限额度):
    //   X2/X1.5 共用 XFSPARK_X2_KEY2(WQHGCFVJdkalFMEQMCMo:qeFmOgPgFXTCfFghzsLv):x2 端点 model=spark-x、v2 端点 model=spark-x(实测出内容)
    //   Flash=Ctzg...(agent 端点,现有 key 在用);Lite=Amtvr...(v1 端点 model=lite,无限量);Pro=GxiG...(v1 端点 model=generalv3.5);Pro-128K=uZBk...(v1 端点 model=pro-128k)
    //   X2 系三个条目共享同一额度池(旧 XFSPARK_X2_KEY + 新 XFSPARK_X2_KEY2 的 x2/v2 端点):2026-08-29 小徐报合计剩 196,242 tokens
    //   → 三条目各 dailyCap 10(每天最多 30 次 ≈ 6 万 tokens,撑 ~3 天),超额自动 fallback 智谱/Lite;优质额度当补充不当主力
    //   主力保护:X2-Flash(agent 端点)剩 1,723,155(2M 免费包)dailyCap 150/天 ≈ 40 万 tokens/天;Lite 无限量是长期后盾
    { id: "xf-spark-x2-flash", url: "https://spark-api-open.xf-yun.com/agent/v1", apiKeyEnv: "XFSPARK_X2_FLASH_KEY", model: "spark-x", dailyCap: 150, tier: 1, enabled: true },
    { id: "xf-spark-x2b",      url: "https://spark-api-open.xf-yun.com/x2",       apiKeyEnv: "XFSPARK_X2_KEY2",       model: "spark-x", dailyCap: 10,     tier: 2, enabled: true },
    { id: "xf-spark-x1",       url: "https://spark-api-open.xf-yun.com/v2",       apiKeyEnv: "XFSPARK_X2_KEY2",       model: "spark-x", dailyCap: 10,     tier: 2, enabled: true },
    { id: "xf-spark-x2",       url: "https://spark-api-open.xf-yun.com/x2",       apiKeyEnv: "XFSPARK_X2_KEY",        model: "spark-x", dailyCap: 10,     tier: 2, enabled: true },
    { id: "xf-spark-ultra",    url: "https://spark-api-open.xf-yun.com/v1",       apiKeyEnv: "XFSPARK_ULTRA_KEY",     model: "4.0Ultra",       dailyCap: 20,     tier: 4, enabled: true },
    { id: "xf-spark-lite",     url: "https://spark-api-open.xf-yun.com/v1",       apiKeyEnv: "XFSPARK_LITE_KEY",      model: "lite",           dailyCap: Infinity, tier: 4, enabled: true },
    { id: "xf-spark-pro",      url: "https://spark-api-open.xf-yun.com/v1",       apiKeyEnv: "XFSPARK_PRO_KEY",       model: "generalv3.5",    dailyCap: 20,     tier: 5, enabled: true },
    { id: "xf-spark-pro128k",  url: "https://spark-api-open.xf-yun.com/v1",       apiKeyEnv: "XFSPARK_PRO128_KEY",    model: "pro-128k",       dailyCap: 20,     tier: 5, enabled: true },
    // ---- 智谱（实测从 CF 边缘 TTFB 0.3s 池内最快;官方按 RPM/TPM 限流无日次硬限,dailyCap 为自设保险）----
    // 小徐 2026-08-29 新注册账号新 key(ZHIPU_KEY2)双 key 并行:新 key 条目在前优先用,旧 key 超限/失败后 fallback
    // 2026-08-29 小徐补充免费模型:GLM-Z1-Flash(推理 128K 免费)/GLM-4.7(500 万 tokens)/GLM-4.5-Air(1200 万 tokens)
    //   GLM-4.7-Flash/GLM-4.6V-Flash(视觉,不入池)/GLM-4-Flash-250414;实测 6 名全通(4.7-flash 热限流 429 照常入池自愈)
    //   额度地图:4.5-Air 1200 万 > 4.7 500 万 > 4-Air/Flash 无硬限(免费档)
    // z1-flash 推理内嵌 content 的 <think> 标签且 thinking:{type:disabled} 无效(实测) → 前端已加 stripThink 统一剥离(2026-08-29)后启用
    // z1-flash ×2 禁用:流式 think 推理 >120s 仍无正文(实测 129s),前端 90s 读超时必断
    { id: "zp2-glm-z1-flash", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-z1-flash",   dailyCap: 1500, tier: 2, enabled: false },
    { id: "zp-glm-z1-flash",  url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-z1-flash",   dailyCap: 1500, tier: 2, enabled: false },
    // ZHIPU_KEY 已于 2026-08-29 换新 key(0a84a2ef...):zp- 条目 6 条恢复启用(4.7/4.5-air/4-air 直连全 200 合规)
    { id: "zp2-glm-4.7",      url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4.7",         dailyCap: 300,  tier: 3, enabled: true },
    { id: "zp2-glm-4-air",    url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4-air",       dailyCap: 1000, tier: 3, enabled: true },
    { id: "zp2-glm-4.5-air",  url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4.5-air",     dailyCap: 600,  tier: 3, enabled: true }, // 流式慢(102s),tier3 内垫底
    { id: "zp-glm-4.7",       url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-4.7",         dailyCap: 300,  tier: 3, enabled: true },
    { id: "zp-glm-4.5-air",   url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-4.5-air",     dailyCap: 600,  tier: 3, enabled: true },
    { id: "zp-glm-4-air",     url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-4-air",       dailyCap: 1000, tier: 3, enabled: true },
    // ---- Agnes（免费:apihub.agnes-ai.com,2026-08-25 实测可用）----
    { id: "agnes-2.0-flash", url: "https://apihub.agnes-ai.com/v1", apiKeyEnv: "AGNES_KEY", model: "agnes-2.0-flash", dailyCap: 500, tier: 4, enabled: true },
    // ---- OpenRouter 免费模型（2026-08-25 实测:glm-5.2 共享池偶发 429 属正常,自动 fallback;gemma-4 系列因 Google 地区限制从 CF 出口必然失败,不入池）----
    // or-glm-5.2 / or-ox-alpha / or-lfm 禁用:2026-08-29 实测 503(免费档限额)/503/2.6B 质量差
    { id: "or-glm-5.2",            url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "z-ai/glm-5.2:free",                dailyCap: 500, tier: 5, enabled: false },
    { id: "or-minimax-m3",         url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "minimax/minimax-m3:free",          dailyCap: 500, tier: 6, enabled: true },
    { id: "or-nemotron-3-super",   url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "nvidia/nemotron-3-super-120b-a12b:free", dailyCap: 500, tier: 6, enabled: true },
    { id: "zp2-glm-4.7-flash",    url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4.7-flash",     dailyCap: 5000, tier: 7,  enabled: true },
    { id: "zp-glm-4.7-flash",     url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-4.7-flash",     dailyCap: 5000, tier: 7,  enabled: true },
    { id: "zp2-glm-4-flash-250414", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4-flash-250414", dailyCap: 5000, tier: 7,  enabled: true },
    { id: "zp-glm-4-flash-250414", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY",  model: "glm-4-flash-250414", dailyCap: 5000, tier: 7,  enabled: true },
    { id: "zp2-glm-4-flash", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY2", model: "glm-4-flash", dailyCap: 5000, tier: 7,  enabled: true },
    { id: "zp-glm-4-flash", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY", model: "glm-4-flash", dailyCap: 5000, tier: 7,  enabled: true },
    { id: "or-minimax-m2.7",       url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "minimax/minimax-m2.7:free",        dailyCap: 500, tier: 8, enabled: true },
    { id: "or-nemotron-3-ultra",   url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "nvidia/nemotron-3-ultra-550b-a55b:free", dailyCap: 500, tier: 8, enabled: true },
    { id: "or-ox-alpha",           url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "stealth/ox-alpha",                 dailyCap: 500, tier: 8, enabled: false },
    { id: "or-lfm-2.5-2.6b",       url: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_KEY", model: "liquid/lfm-2.5-2.6b:free",          dailyCap: 500, tier: 9, enabled: false },
    // ---- ChatAnywhere（2026-08-25 实测:403 "请求客户端IP不支持访问,请勿使用Cloudflare等反向代理"= 永久拒绝 CF 出口,key 再对也白耗,整池禁用;若换非 CF 出口部署可恢复）----
    { id: "ca-gpt-4o-mini",   url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4o-mini",    dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-3.5-turbo", url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-3.5-turbo",  dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-4.1-mini",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1-mini",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-4.1-nano",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1-nano",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5-mini",    url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5-mini",     dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5-nano",    url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5-nano",     dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5.4-mini",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5.4-mini",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-gpt-5.4-nano",  url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5.4-nano",   dailyCap: 100, tier: 10, enabled: false },
    { id: "ca-deepseek-v3.2",          url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v3.2",        dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-deepseek-v4-flash",      url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v4-flash",    dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-deepseek-v4-pro",        url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v4-pro",      dailyCap: 30, tier: 20, enabled: false },
    { id: "ca-gpt-4o",        url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4o",         dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-gpt-4.1",       url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-4.1",        dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-gpt-5",         url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "gpt-5",          dailyCap: 5,   tier: 30, enabled: false },
    { id: "ca-deepseek-v3.2-thinking", url: "https://api.chatanywhere.tech/v1", apiKeyEnv: "CHATANYWHERE_KEY", model: "deepseek-v3.2-thinking", dailyCap: 30, tier: 95, enabled: false },
    // ---- DeepSeek 官方（池内禁用，等流量大了再启用）----
    { id: "ds-deepseek-chat",     url: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY",     model: "deepseek-chat",     dailyCap: Infinity, tier: 40, enabled: false },
    { id: "ds-deepseek-reasoner", url: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_KEY",     model: "deepseek-reasoner", dailyCap: Infinity, tier: 40, enabled: false },
    // ---- NVIDIA（平台按 credits 计费,2026-08-29 候选批量入池 enabled:false,pool: 后门逐个实测通过后启用）----
    // 原 qwen3.5-122b-a10b 已 EOL(HTTP 410);llama-3.3-70b-instruct 已从平台下架(8-24 实测 12s+ 无响应即额度耗尽)
    // llama-3.3-70b-instruct 已从平台下架(实测 503),保留条目但禁用防误测
    { id: "nv-llama-3.3-70b",        url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "meta/llama-3.3-70b-instruct",        dailyCap: 100, tier: 90, enabled: false },
    // 2026-08-29 全量实测:前 5 个流式稳定(8-26s),其余波动 503 熔断自愈,排后兜底
    { id: "nv-gpt-oss-120b",         url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "openai/gpt-oss-120b",                dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-gpt-oss-20b",          url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "openai/gpt-oss-20b",                 dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-kimi-k3",              url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "moonshotai/kimi-k3",                 dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-minimax-m3",           url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "minimaxai/minimax-m3",               dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-nemotron-super",       url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/nemotron-3-super-120b-a12b",  dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-deepseek-v4-flash",    url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "deepseek-ai/deepseek-v4-flash-0731", dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-deepseek-v4-pro",      url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "deepseek-ai/deepseek-v4-pro-0813",   dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-kimi-k2.6",            url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "moonshotai/kimi-k2.6",               dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-nemotron-ultra",       url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/nemotron-3-ultra-550b-a55b",  dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-nemotron-4-340b",      url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/nemotron-4-340b-instruct",    dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-nemotron-nano-30b",    url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/nemotron-3-nano-30b-a3b",     dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-nemotron-lightning",   url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/nemotron-3.5-lightning-30b-a3b", dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-mistral-large2",       url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "mistralai/mistral-large-2-instruct", dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-mistral-nemotron",     url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "mistralai/mistral-nemotron",         dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-nemotron-70b",         url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/llama-3.1-nemotron-70b-instruct", dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-nemotron-ultra-253b",  url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "nvidia/llama-3.1-nemotron-ultra-253b-v1", dailyCap: 800, tier: 90, enabled: true },
    { id: "nv-gemma-4-31b",          url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "google/gemma-4-31b-it",              dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-gemma-3-12b",          url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "google/gemma-3-12b-it",              dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-phi-3.5-moe",          url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "microsoft/phi-3.5-moe-instruct",     dailyCap: 5000, tier: 90, enabled: true },
    { id: "nv-yi-large",             url: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_KEY", model: "01-ai/yi-large",                     dailyCap: 5000, tier: 90, enabled: true },
    // ---- SiliconFlow 免费模型（2026-08-29 小徐补充:L0 档 1000 RPM / 50000 TPM,最后兜底）----
    // 思考系(GLM-Z1/R1)强制 enable_thinking:false 提速(见调用处);R1-0528 是 R1 蒸馏到 Qwen3-8B,关思考后普通输出
    // Qwen3.5-4B 实测 enable_thinking 无效(reasoning_content 吃满 max_tokens 致 content 空,前端重试循环) → 禁用
    { id: "sf-glm-z1-9b",    url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "THUDM/GLM-Z1-9B-0414",         dailyCap: 1000, tier: 95, enabled: true },
    { id: "sf-glm-4-9b",     url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "THUDM/GLM-4-9B-0414",          dailyCap: 1000, tier: 95, enabled: true },
    { id: "sf-r1-qwen3-8b",  url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "deepseek-ai/DeepSeek-R1-0528-Qwen3-8B", dailyCap: 1000, tier: 95, enabled: true },
    { id: "sf-qwen3.5-4b",   url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "Qwen/Qwen3.5-4B",             dailyCap: 1000, tier: 96, enabled: false },
    { id: "sf-qwen2.5-7b",   url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "Qwen/Qwen2.5-7B-Instruct",    dailyCap: 1000, tier: 96, enabled: true },
    // qwen3-8b 流式实测 35 字即停(转非流式后仍慢),禁用
    { id: "sf-qwen3-8b",     url: "https://api.siliconflow.cn/v1", apiKeyEnv: "SILICONFLOW_KEY", model: "Qwen/Qwen3-8B",               dailyCap: Infinity, tier: 99, enabled: false },
    // ---- 终极兜底(2026-08-31 小徐指定):智谱付费模型 GLM-5.3-Flash,不限额;tier 100 链尾,仅当全部免费模型
    // 失败/熔断/限流后使用(pickModel 优先 tier1-99,候选链排序也在最后;实付按智谱账单计费)
    // 2026-08-31 22:40 ZHIPU_KEY2 调用付费模型失败(503)→ 换用已验证可调付费模型的 ZHIPU_KEY3 ----
    { id: "zp-glm-5.3-flash", url: "https://open.bigmodel.cn/api/paas/v4", apiKeyEnv: "ZHIPU_KEY3", model: "glm-5.3-flash", dailyCap: Infinity, tier: 100, enabled: true },
];

// 流式坏模型两类（2026-08-29 全 55 模型实测 + 2026-08-31 线上剥 format 实测定稿）:
// 1. STREAM_NO_JSON:流式 + response_format json_object 下 content 恒空,但流式 + 去掉 format 后正常出 JSON
//    (讯飞系实测 5/5 出内容,x1 裸 JSON,其余带 ```json 围栏——前端 stripFence 已容错)→ 保持流式仅剥 format
// 2. STREAM_BROKEN:流式无论如何(带/不带 format)都零输出(content 恒空),仅非流式正常
//    (OpenRouter 免费 4 个 + 硅基 4 个实测 chunks=0)→ 强制上游非流式,单块 SSE 回吐(前端 finishStreaming 整卡替换)
const STREAM_NO_JSON = [
    "xf-spark-x1", "xf-spark-ultra", "xf-spark-lite", "xf-spark-pro", "xf-spark-pro128k"
];
const STREAM_BROKEN = [
    "or-minimax-m3", "or-minimax-m2.7", "or-nemotron-3-super", "or-nemotron-3-ultra",
    "sf-glm-z1-9b", "sf-glm-4-9b", "sf-r1-qwen3-8b", "sf-qwen2.5-7b"
];

// ==================== 上游限流管理(防 429) ====================
// 智谱按"并发数"限流(免费档并发极低,第三方实测 ~5RPM),会员绕过 dailyCap 后洪峰更需客户端自限速
// 策略(openai-cookbook 最佳实践):并发信号量 + 滑动窗口,本地近似(CF 多实例叠加后仍留余量)
const RATE_LIMIT = { concurrency: 2, windowMs: 60 * 1000, maxPerWindow: 12, acquireTimeoutMs: 8000 };
// 按 key 放宽门控:讯飞官方并发 20 且无日次硬限,自设 8 并发/60min 仍有 2.5 倍余量,承载翻倍;
// 其余平台(智谱免费档 ~5RPM / OpenRouter 免费模型 50 次/天)保持保守默认防 429
const RATE_LIMIT_OVERRIDES = {
    "XFSPARK_X2_FLASH_KEY": { concurrency: 8, maxPerWindow: 60 },
    "XFSPARK_X2_KEY":       { concurrency: 8, maxPerWindow: 60 },
    "XFSPARK_X2_KEY2":      { concurrency: 8, maxPerWindow: 60 },
    "XFSPARK_LITE_KEY":     { concurrency: 8, maxPerWindow: 60 },
    "XFSPARK_ULTRA_KEY":    { concurrency: 8, maxPerWindow: 60 },
};
// 模型级门控(优先于 key 级):NVIDIA 免费层按模型独立限流(2026-08 查证)
// 大模型 ~40 RPM / 1000 req/天 → 门控取平台 75% 余量(30/min,并发 3);小模型 ~60 RPM / 14400 req/天 → 45/min,并发 5
// 超限 429 由 Retry-After 短等重试 + 30s 短熔断兜底,不拖慢 fallback 链
const MODEL_LIMIT_OVERRIDES = {
    "nv-deepseek-v4-flash":   { concurrency: 3, maxPerWindow: 30 },
    "nv-deepseek-v4-pro":     { concurrency: 3, maxPerWindow: 30 },
    "nv-kimi-k2.6":           { concurrency: 3, maxPerWindow: 30 },
    "nv-kimi-k3":             { concurrency: 3, maxPerWindow: 30 },
    "nv-minimax-m3":          { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-super":      { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-ultra":      { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-4-340b":     { concurrency: 3, maxPerWindow: 30 },
    "nv-gpt-oss-120b":        { concurrency: 3, maxPerWindow: 30 },
    "nv-mistral-large2":      { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-70b":        { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-ultra-253b": { concurrency: 3, maxPerWindow: 30 },
    "nv-nemotron-nano-30b":   { concurrency: 5, maxPerWindow: 45 },
    "nv-nemotron-lightning":  { concurrency: 5, maxPerWindow: 45 },
    "nv-gpt-oss-20b":         { concurrency: 5, maxPerWindow: 45 },
    "nv-mistral-nemotron":    { concurrency: 5, maxPerWindow: 45 },
    "nv-gemma-4-31b":         { concurrency: 5, maxPerWindow: 45 },
    "nv-gemma-3-12b":         { concurrency: 5, maxPerWindow: 45 },
    "nv-phi-3.5-moe":         { concurrency: 5, maxPerWindow: 45 },
    "nv-yi-large":            { concurrency: 5, maxPerWindow: 45 },
};
function rateLimitFor(envName, modelId) {
    if (modelId && MODEL_LIMIT_OVERRIDES[modelId]) {
        return { ...RATE_LIMIT, ...MODEL_LIMIT_OVERRIDES[modelId] };
    }
    return RATE_LIMIT_OVERRIDES[envName]
        ? { ...RATE_LIMIT, ...RATE_LIMIT_OVERRIDES[envName] }
        : RATE_LIMIT;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const upstreamGates = new Map(); // "envName"|"envName#modelId" -> { active, timestamps }
function gateFor(envName, modelId) {
    const key = modelId ? envName + "#" + modelId : envName;
    let g = upstreamGates.get(key);
    if (!g) { g = { active: 0, timestamps: [] }; upstreamGates.set(key, g); }
    return g;
}
async function gateAcquire(envName, modelId, timeoutMs) {
    const g = gateFor(envName, modelId);
    const lim = rateLimitFor(envName, modelId);
    const start = Date.now();
    while (true) {
        const now = Date.now();
        g.timestamps = g.timestamps.filter(t => now - t < lim.windowMs);
        if (g.active < lim.concurrency && g.timestamps.length < lim.maxPerWindow) {
            g.active++;
            g.timestamps.push(now);
            return true;
        }
        if (Date.now() - start > (timeoutMs ?? lim.acquireTimeoutMs)) return false;
        await sleep(50);
    }
}
function gateRelease(envName, modelId) {
    const g = upstreamGates.get(modelId ? envName + "#" + modelId : envName);
    if (g && g.active > 0) g.active--;
}
// 免费模式排队人数近似(本实例内存):userId -> 最近 QUEUE_BUSY 时间;CF 多实例各自计数,
// 云吞吞并发规模(个位数)通常落同一热实例,跨实例误差可接受;不用 KV/Cache 计数(弱一致反而误导)
const freeQueueSeen = new Map();
function freeQueueLen(now = Date.now()) {
    let n = 0;
    for (const [uid, ts] of freeQueueSeen) {
        if (now - ts <= 10000) n++;
        else freeQueueSeen.delete(uid);
    }
    return Math.max(1, n); // 至少 1:自己正排在队里
}
// Retry-After 解析:优先毫秒(OpenAI 系 retry-after-ms),其次秒(HTTP 标准 retry-after)
function parseRetryAfterMs(resp) {
    const ms = resp.headers.get("retry-after-ms") || resp.headers.get("x-ratelimit-reset-requests");
    if (ms) { const n = parseInt(ms, 10); if (!isNaN(n)) return n; }
    const s = resp.headers.get("retry-after");
    if (s) { const n = parseInt(s, 10); if (!isNaN(n)) return n * 1000; }
    return null;
}

// 失败熔断:候选模型调用失败后 5 分钟内直接跳过,避免每次请求都重走失败链
// (实测:key 过期的 ChatAnywhere 每次 ~0.5s 失败 × 11 个候选 = 每请求固定浪费 ~6.5s)
// CF Workers 多实例内存隔离,仅用 Map 时每实例各自重走失败链;叠加 Cache API(zone 内全局共享)做跨实例熔断
const MODEL_FAIL_COOLDOWN_MS = 5 * 60 * 1000;
// 429 限流短熔断:Retry-After 等待重试仍 429 → 30s 内跳过该模型,避免每个请求都白试一次再 fallback
const MODEL_429_COOLDOWN_MS = 30 * 1000;
const modelFailTimes = new Map(); // modelId -> lastFailTime (本实例内存快路径)

const failCacheUrl = (modelId) => `https://ai.blupure.cn/_internal/fail/${encodeURIComponent(modelId)}`;

async function isModelInCooldown(modelId) {
    const t = modelFailTimes.get(modelId);
    if (t) {
        if (Date.now() - t > MODEL_FAIL_COOLDOWN_MS) {
            modelFailTimes.delete(modelId);
            return false;
        }
        return true;
    }
    try {
        const hit = await caches.default.match(failCacheUrl(modelId));
        if (hit) return true;
    } catch (e) { /* Cache API 异常时仅靠内存判断 */ }
    return false;
}

function setModelCooldown(modelId, ms = MODEL_FAIL_COOLDOWN_MS) {
    // 内存同步生效(本实例快路径);Cache API 跨实例广播异步不阻塞,失败链判定不因熔断写入变慢
    modelFailTimes.set(modelId, Date.now());
    try {
        caches.default.put(failCacheUrl(modelId), new Response("1", {
            headers: { "Cache-Control": `max-age=${Math.floor(ms / 1000)}` }
        })).catch(() => {});
    } catch (e) { /* best-effort */ }
}

async function clearModelCooldown(modelId) {
    modelFailTimes.delete(modelId);
    try { await caches.default.delete(failCacheUrl(modelId)); } catch (e) { /* best-effort */ }
}

// 充值档位（金额与 worker 校验共用，前端仅展示）：币值 = 基础 + 赠送；首充 = 基础 ×2
// 2026-08-31 新增 c1 ¥1 档:最低支持买 1 元(虎皮椒无最低限额),测试/小额体验门槛
const CHARGE_PLANS = {
    c1:  { id: "c1",  name: "1000 云币", price: "1",  base: 1000,  bonus: 100 },
    c6:  { id: "c6",  name: "6000 云币", price: "6",  base: 6000,  bonus: 600 },
    c18: { id: "c18", name: "18000 云币", price: "18", base: 18000, bonus: 1800 },
    c30: { id: "c30", name: "30000 云币", price: "30", base: 30000, bonus: 4500 },
    c68: { id: "c68", name: "68000 云币", price: "68", base: 68000, bonus: 13600 },
    c89: { id: "c89", name: "89000 云币", price: "89", base: 89000, bonus: 17800 },
    c168: { id: "c168", name: "168000 云币", price: "168", base: 168000, bonus: 33600 },
};
// 会员档位（金额/时长，前端仅展示；区别于 CHARGE_PLANS 云币档；2026-09-01 会员改革新增周/月/季/年）
const MEMBER_PLANS = {
    weekly:    { id: "weekly",    name: "周度会员", price: "9",   days: 7 },
    monthly:   { id: "monthly",   name: "月度会员", price: "21",  days: 30 },
    quarterly: { id: "quarterly", name: "季度会员", price: "49",  days: 90 },
    yearly:    { id: "yearly",    name: "年度会员", price: "118", days: 365 },
};
// 免费用户每日免费 AI 次数(北京时间 08:00 刷新;额度内仅路由 NVIDIA 全部 + 硅基 sf-glm-4-9b,超限转云币计费)
const FREE_QUOTA_PER_DAY = 10;
const FREE_QUOTA_REFRESH_HOUR = 8;
// 终身会员（会员改革后保留的会员档，非充值档）
const LIFETIME_PLAN = { id: "lifetime", name: "终身会员", price: "188", days: 73000 };
// 终身会员限时优惠:每用户从首次打开充值页起 24h 内 ¥188,过后恢复 ¥249
const OFFER_MS = 24 * 3600 * 1000;
const LIFETIME_REGULAR_PRICE = "249";
async function getLifetimeOffer(env, userId) {
    try {
        const raw = await env.COVER_CACHE.get("offer:" + userId);
        const started = raw ? Number(raw) : 0;
        return { startedAt: started || 0, active: !started || Date.now() - started < OFFER_MS };
    } catch (e) {
        return { startedAt: 0, active: true };
    }
}
// 封面生成 prompt 缓存（实例级，3 分钟 TTL，防重复生成耗额度）
const coverCache = new Map();
// 云存档：每个剧本 3 槽，一次性解锁价（云币/槽，可调）
const CLOUD_SLOT_PRICE = 200;
// 角色卡聊天：每张卡一次性解锁价（云币/张；终身会员免费）
const CHAR_CHAT_UNLOCK_PRICE = 200;
// Uint8Array → base64（Worker 无 Buffer，分块转字符串防调用栈溢出）
function toBase64(bytes) {
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
}

// 环境变量（Cloudflare Secrets，勿写入代码）：
//   CHATANYWHERE_KEY / SILICONFLOW_KEY / NVIDIA_KEY / DEEPSEEK_KEY / ZHIPU_KEY / PB_URL / PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD
//   H5_APP_ID / H5_APP_SECRET / PAY_NOTIFY_URL=https://ai.blupure.cn/api/pay/notify
//   MAPAY_APPID / MAPAY_APPKEY（聚合登录 QQ/微信,未配置时接口返回"暂未开通"）
//   XFSPARK_X2_KEY / XFSPARK_X2_FLASH_KEY（讯飞 Spark X2 两个端点,未配置时自动跳过）
//   OPENROUTER_KEY（OpenRouter 免费模型）/ AGNES_KEY（Agnes 免费模型）

// ==================== 2. 工具函数 ====================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        // 保留 X-Cloud-Card-Id 兼容旧前端灰度期
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Cloud-Card-Id",
        "Access-Control-Max-Age": "86400",
    };
}

// ==================== 防克隆：来源闸门 ====================
// 前端是公开 H5，可被第三方整体搬运（套壳 APK/克隆站换 key）。浏览器跨域请求必带 Origin，
// 非白名单来源直接 403，挡住克隆站直连官方 worker 白嫖模型池/业务 API。
// 无 Origin 的请求（同源访问、服务端回调如支付 notify、curl 探针）不受此闸门约束，
// 业务安全由 X-Auth-Token 登录校验与支付回调验签承担。
const ORIGIN_DEV_HOSTS = ["localhost", "127.0.0.1"];
const ORIGIN_ALLOWED_SUFFIXES = [".blupure.cn"];
function isAllowedOrigin(origin) {
    if (!origin) return true;
    try {
        const host = new URL(origin).hostname;
        if (ORIGIN_DEV_HOSTS.includes(host)) return true;
        return ORIGIN_ALLOWED_SUFFIXES.some((s) => host.endsWith(s));
    } catch (e) {
        return false;
    }
}

function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (e) {
        try {
            const repairedText = text.replace(/\\(?!(["\\\/bfnrt]|u[0-9a-fA-F]{4}))/g, "\\\\");
            return JSON.parse(repairedText);
        } catch (innerError) {
            throw new Error(`JSON 解析失败: ${e.message}`);
        }
    }
}

function escapePocketBaseFilterValue(value) {
    return String(value)
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'");
}

async function pbGetUser(env, userId) {
    if (!userId) return { id: "" };
    const q = await pbAdminFetch(env, `/api/collections/users/records/${encodeURIComponent(userId)}`);
    const d = await q.json().catch(() => ({}));
    if (d && d.id) return { id: d.id, nickname: d.nickname || "", faceimg: d.faceimg || "" };
    return { id: userId };
}

// 批量给列表项补 author_name（users 表按 id 批量查，避免 N+1）
async function attachAuthorNames(env, items) {
    const ids = [...new Set((items || []).map((c) => c && c.author_id).filter(Boolean))];
    if (!ids.length) return;
    const filter = encodeURIComponent(ids.map((id) => `id='${escapePocketBaseFilterValue(id)}'`).join("||"));
    const q = await pbAdminFetch(env, `/api/collections/users/records?perPage=200&fields=id,nickname&filter=${filter}`);
    const d = await q.json().catch(() => ({}));
    const byId = new Map((d.items || []).map((u) => [u.id, u.nickname || ""]));
    items.forEach((c) => {
        if (c) c.author_name = byId.get(c.author_id) || "";
    });
}

function npcOfCard(cardData, characterId) {
    const npcs = (cardData && cardData.structured && Array.isArray(cardData.structured.npcs)) ? cardData.structured.npcs : [];
    return npcs.find((n) => String(n.id || "") === String(characterId) || roleIdOf(n) === String(characterId) || String(n.name || "") === String(characterId)) || null;
}

// 与前端 roleIdOf 一致：无 id 的 NPC 用清洗后的 name 作角色 ID
function roleIdOf(n) {
    return String((n && (n.id || n.name)) || "role").replace(/[^\w-]/g, "_");
}

function errorResponse(msg, status = 500, detail = null, code = "") {
    return new Response(JSON.stringify({ error: msg, detail, code }), {
        status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
}

function getTodayStr() {
    return new Date(Date.now() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

// 排行榜切片起点(北京时间):day=今天 / week=本周一 / month=本月 1 号
function getCnSliceStart(span) {
    const d = new Date(Date.now() + TIMEZONE_OFFSET_MS);
    if (span === "month") return d.toISOString().slice(0, 8) + "01";
    if (span === "week") {
        const dow = (d.getUTCDay() + 6) % 7;   // 0=周一
        d.setUTCDate(d.getUTCDate() - dow);
    }
    return d.toISOString().slice(0, 10);
}

// 免费额度日期：北京时间 08:00 为界（00:00-07:59 归前一天 → 每天 08:00 自动刷新）
function getFreeQuotaDateStr() {
    const d = new Date(Date.now() + TIMEZONE_OFFSET_MS);
    if (d.getUTCHours() < FREE_QUOTA_REFRESH_HOUR) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}
// 免费额度：每用户每日计数存 KV（KV 非原子 read-modify-write，极端并发少计可接受）
async function readFreeQuota(env, userId, date) {
    try { return Number(await env.COVER_CACHE.get(`freequota:${userId}:${date}`) || 0); }
    catch (e) { return 0; }
}
async function bumpFreeQuota(env, userId, date) {
    const key = `freequota:${userId}:${date}`;
    try {
        const cur = Number(await env.COVER_CACHE.get(key) || 0);
        await env.COVER_CACHE.put(key, String(cur + 1), { expirationTtl: 48 * 3600 });
    } catch (e) { console.error("free quota bump failed:", e.message); }
}

// M7c 语言辅助日配额:点译 gloss / 复盘 recap 直调模型不计币,但须封日上限防已登录零余额用户刷付费兜底模型
// 分桶键 langaux:{kind}:{uid}:{date}(与剧情 freequota 分桶互不占用);返回 -1 = 用尽,其余 = 当日已用次数
const LANG_AUX_DAILY = { gloss: { free: 60, vip: 300 }, recap: { free: 20, vip: 60 } };
async function langAuxUsed(env, uid, kind, isVip) {
    try {
        const limit = (LANG_AUX_DAILY[kind] || {})[isVip ? "vip" : "free"];
        if (!limit) return 0;
        const cur = Number(await env.COVER_CACHE.get(`langaux:${kind}:${uid}:${getFreeQuotaDateStr()}`) || 0);
        return cur >= limit ? -1 : cur;
    } catch (e) { return 0; }
}
async function langAuxBump(env, uid, kind) {
    try {
        const key = `langaux:${kind}:${uid}:${getFreeQuotaDateStr()}`;
        const cur = Number(await env.COVER_CACHE.get(key) || 0);
        await env.COVER_CACHE.put(key, String(cur + 1), { expirationTtl: 48 * 3600 });
    } catch (e) {}
}
// 会员剩余天数(终身/非会员返回 0;前端徽章/我的页展示用)
function memberDaysLeft(record) {
    const t = record.membership_type;
    if (!t || t === "lifetime") return 0;
    const exp = Date.parse(record.membership_expires_at || "");
    if (!exp) return 0;
    return Math.max(0, Math.ceil((exp - Date.now()) / 86400000));
}

// 标准 MD5（公共域算法，纯 JS 免依赖；Worker 运行时 WebCrypto 不支持 MD5）
function md5(str) {
    const rotl = (x, n) => (x << n) | (x >>> (32 - n));
    const add = (x, y) => (x + y) & 0xFFFFFFFF;
    const K = [0xd76aa478,0xe8c7b756,0x242070db,0xc1bdceee,0xf57c0faf,0x4787c62a,0xa8304613,0xfd469501,0x698098d8,0x8b44f7af,0xffff5bb1,0x895cd7be,0x6b901122,0xfd987193,0xa679438e,0x49b40821,0xf61e2562,0xc040b340,0x265e5a51,0xe9b6c7aa,0xd62f105d,0x02441453,0xd8a1e681,0xe7d3fbc8,0x21e1cde6,0xc33707d6,0xf4d50d87,0x455a14ed,0xa9e3e905,0xfcefa3f8,0x676f02d9,0x8d2a4c8a,0xfffa3942,0x8771f681,0x6d9d6122,0xfde5380c,0xa4beea44,0x4bdecfa9,0xf6bb4b60,0xbebfbc70,0x289b7ec6,0xeaa127fa,0xd4ef3085,0x04881d05,0xd9d4d039,0xe6db99e5,0x1fa27cf8,0xc4ac5665,0xf4292244,0x432aff97,0xab9423a7,0xfc93a039,0x655b59c3,0x8f0ccc92,0xffeff47d,0x85845dd1,0x6fa87e4f,0xfe2ce6e0,0xa3014314,0x4e0811a1,0xf7537e82,0xbd3af235,0x2ad7d2bb,0xeb86d391];
    const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const bytes = unescape(encodeURIComponent(str));
    const msg = [];
    for (let i = 0; i < bytes.length; i++) msg.push(bytes.charCodeAt(i));
    const origLen = msg.length * 8;
    msg.push(0x80);
    while (msg.length % 64 !== 56) msg.push(0);
    for (let i = 0; i < 8; i++) msg.push(Math.floor(origLen / Math.pow(2, 8 * i)) & 0xFF);
    let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
    for (let i = 0; i < msg.length; i += 64) {
        const M = [];
        for (let j = 0; j < 16; j++) M[j] = msg[i + j * 4] | (msg[i + j * 4 + 1] << 8) | (msg[i + j * 4 + 2] << 16) | (msg[i + j * 4 + 3] << 24);
        let A = a0, B = b0, C = c0, D = d0;
        for (let j = 0; j < 64; j++) {
            let F, g;
            if (j < 16) { F = (B & C) | (~B & D); g = j; }
            else if (j < 32) { F = (D & B) | (~D & C); g = (5 * j + 1) % 16; }
            else if (j < 48) { F = B ^ C ^ D; g = (3 * j + 5) % 16; }
            else { F = C ^ (B | ~D); g = (7 * j) % 16; }
            F = add(add(F, A), add(K[j], M[g]));
            const tmp = D; D = C; C = B; B = add(B, rotl(F, S[j])); A = tmp;
        }
        a0 = add(a0, A); b0 = add(b0, B); c0 = add(c0, C); d0 = add(d0, D);
    }
    const toHex = n => {
        let s = "";
        for (let i = 0; i < 4; i++) s += ("0" + ((n >>> (i * 8)) & 0xFF).toString(16)).slice(-2);
        return s;
    };
    return toHex(a0) + toHex(b0) + toHex(c0) + toHex(d0);
}

// ==================== 3. 数据库服务层（PocketBase） ====================

async function getAdminToken(env) {
    if (getAdminToken.cache) return getAdminToken.cache; // 单次 invocation 内复用,免每请求都登录 PB
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const credentials = { identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD };
    const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
    });
    if (res.ok) return (getAdminToken.cache = (await res.json()).token);
    const resOld = await fetch(`${pbUrl}/api/collections/admins/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
    });
    if (resOld.ok) return (getAdminToken.cache = (await resOld.json()).token);
    throw new Error("PocketBase 身份验证失败");
}

async function pbAdminFetch(env, path, options = {}) {
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const adminToken = await getAdminToken(env);
    // 15s 兜底超时:PB(cloudflared 隧道)抖动时快速失败,避免前端 20s 才感知
    const signal = options.signal || AbortSignal.timeout(15000);
    return fetch(`${pbUrl}${path}`, {
        ...options,
        signal,
        headers: {
            "Authorization": `Bearer ${adminToken}`,
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });
}

// 读取当日各模型已用次数 → { modelId: count }
async function readModelUsageMap(env, today) {
    const q = await pbAdminFetch(
        env,
        `/api/collections/model_usage/records?perPage=50&skipTotal=true&filter=${encodeURIComponent(`usage_date='${today}'`)}`
    );
    if (!q.ok) return {};
    const data = await q.json();
    const map = {};
    for (const it of data.items || []) map[it.model_id] = Number(it.count || 0);
    return map;
}

// 模型调用成功后才计数（全局配额，所有用户共享）
async function bumpModelUsage(env, modelId, today) {
    const filter = encodeURIComponent(`usage_date='${today}' && model_id='${escapePocketBaseFilterValue(modelId)}'`);
    const q = await pbAdminFetch(env, `/api/collections/model_usage/records?perPage=1&skipTotal=true&filter=${filter}`);
    if (!q.ok) return;
    const data = await q.json();
    if ((data.items || []).length) {
        const rec = data.items[0];
        await pbAdminFetch(env, `/api/collections/model_usage/records/${rec.id}`, {
            method: "PATCH",
            body: JSON.stringify({ count: Number(rec.count || 0) + 1 })
        });
    } else {
        await pbAdminFetch(env, `/api/collections/model_usage/records`, {
            method: "POST",
            body: JSON.stringify({ usage_date: today, model_id: modelId, count: 1 })
        });
    }
}

// ==================== 4. 会员与配额 ====================

function isMember(record) {
    const t = record.membership_type;
    if (!t) return false;
    if (t === "lifetime") return true;
    return !!(record.membership_expires_at && Date.parse(record.membership_expires_at) > Date.now());
}

function isMemberExpired(record) {
    const t = record.membership_type;
    if (!t || t === "lifetime") return false;
    return !!(record.membership_expires_at && Date.parse(record.membership_expires_at) <= Date.now());
}

// 按 tier 升序选当日未超限的第一个 enabled 模型；全无返回 null
function pickModel(usageMap, today, isMember, pool = MODEL_POOL) {
    // 会员不受池配额(dailyCap)限制:付费用户优先命中池内最优质模型,且不占用免费用户配额
    return pool
        .filter(m => m.enabled)
        .sort((a, b) => a.tier - b.tier)
        .find(m => isMember || (usageMap[m.id] || 0) < m.dailyCap) || null;
}

// ==================== 5. H5 支付（h5zhifu.com） ====================

// h5zhifu 网关多节点（北京/上海/广州/成都）；env.PAY_API_URL 显式配置时只走该域名（禁用自动切换）
// 2026-09-02:原首节点 open.h5zhifu.com 实测 TLS 不可达(直连与海外出口均失败,曾致每单白等 15s 超时),
// 已移除;平台主域若恢复需连通性验证后再回添首位。仅后端程序调用，浏览器不可直接打开。
const PAY_GATEWAY_BASES = [
    "https://bj.open.serverapi.work",
    "https://sh.open.serverapi.work",
    "https://gz.open.serverapi.work",
    "https://cd.open.serverapi.work"
];

// 签名：非空参数（除 sign）按参数名 ASCII 升序拼接 a=b&c=d，追加 &key=密钥，md5 转大写（微信 APIv2 风格）
function h5BuildSign(params, secret) {
    const keys = Object.keys(params)
        .filter(k => k !== "sign" && params[k] !== "" && params[k] != null)
        .sort();
    const str = keys.map(k => `${k}=${params[k]}`).join("&");
    return md5(str + "&key=" + secret).toUpperCase();
}

function verifyH5Sign(params, secret) {
    const sign = String(params.sign || "");
    if (!sign) return false;
    return h5BuildSign(params, secret) === sign.toUpperCase();
}

// 虎皮椒签名：非空参数（除 hash）ASCII 升序 key=value 拼接后直接追加 APPSECRET（无连接符），MD5 32 位小写
function xunhuBuildSign(params, secret) {
    const keys = Object.keys(params)
        .filter(k => k !== "hash" && params[k] !== "" && params[k] != null)
        .sort();
    const str = keys.map(k => `${k}=${params[k]}`).join("&");
    return md5(str + secret);
}

function verifyXunhuSign(params, secret) {
    const hash = String(params.hash || "");
    if (!hash) return false;
    return xunhuBuildSign(params, secret) === hash.toLowerCase();
}

// 虎皮椒下单：POST form 到 api.xunhupay.com/payment/do.html；返回 { jumpUrl(手机跳转), qrUrl(PC 二维码图片) }
async function xunhuPlaceOrder(env, orderNo, title, price, userId) {
    const params = {
        version: "1.1",
        appid: env.XUNHU_APP_ID,
        trade_order_id: orderNo,
        total_fee: String(Number(price).toFixed(2)), // 元，最多两位小数
        title: String(title).replace(/%/g, "").slice(0, 40), // 虎皮椒限制：无 % 无表情
        time: String(Math.floor(Date.now() / 1000)),
        notify_url: env.XUNHU_NOTIFY_URL,
        attach: userId,
        nonce_str: Date.now().toString(16) + Math.random().toString(16).slice(2, 8),
        type: "WAP",
        wap_url: env.SITE_URL || "https://bitlife.blupure.cn",
        wap_name: "云吞吞数字故事平台"
    };
    params.hash = xunhuBuildSign(params, env.XUNHU_APP_SECRET);
    const apiBase = (env.XUNHU_API_URL || "https://api.xunhupay.com").replace(/\/$/, "");
    const res = await fetch(`${apiBase}/payment/do.html`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(params),
        signal: AbortSignal.timeout(8000)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.errcode !== 0) throw new Error(json.errmsg || `支付网关返回异常(HTTP ${res.status})`);
    if (!json.url && !json.url_qrcode) throw new Error("支付网关未返回支付链接");
    return { jumpUrl: json.url || "", qrUrl: json.url_qrcode || "", tradeNo: String(json.openid || json.oderid || "") };
}

// 创建订单：本地落库 pay_orders → 按设备/支付方式选网关 → 返回 { orderNo, jumpUrl, qrUrl? }
async function createPayOrder(env, userId, planId, payType, isMobile) {
    const plan = CHARGE_PLANS[planId] || MEMBER_PLANS[planId] || (planId === "lifetime" ? LIFETIME_PLAN : null);
    if (!plan) throw new Error("无效的充值档位");
    // 终身会员按 offer 状态定价:24h 优惠期内 188,过期恢复 249
    let price = plan.price;
    if (planId === "lifetime") {
        const offer = await getLifetimeOffer(env, userId);
        price = offer.active ? LIFETIME_PLAN.price : LIFETIME_REGULAR_PRICE;
    }
    const orderNo = "MP" + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase();
    const timestamp = new Date().toISOString();

    const orderRes = await pbAdminFetch(env, `/api/collections/pay_orders/records`, {
        method: "POST",
        body: JSON.stringify({
            order_no: orderNo, user_id: userId, plan_id: planId,
            amount: price, status: "pending", trade_no: "",
            created_at: timestamp, paid_at: ""
        })
    });
    if (!orderRes.ok) throw new Error("订单创建失败");

    // 支付路由(按设备+方式选网关):电脑端微信=虎皮椒扫码(失败回退 h5zhifu)；手机端微信=h5zhifu；支付宝未开通
    if (payType === "alipay") throw new Error("尚未开通支付宝支付，如实在需要请联系小红书官方账号「云吞吞在努力」");
    if (isMobile) return h5PlaceOrder(env, orderNo, plan, price, payType, userId);
    if (env.XUNHU_APP_SECRET) {
        try {
            const xh = await xunhuPlaceOrder(env, orderNo, plan.name, price, userId);
            return { orderNo, jumpUrl: xh.jumpUrl, qrUrl: xh.qrUrl, tradeNo: xh.tradeNo };
        } catch (e) {
            console.error("xunhuPlaceOrder error:", e.message);
        }
    }
    return h5PlaceOrder(env, orderNo, plan, price, payType, userId);
}

// h5zhifu 网关下单：open.h5zhifu.com/api/h5 → 返回 { orderNo, jumpUrl }（H5 收银台跳转，仅移动端可靠）
async function h5PlaceOrder(env, orderNo, plan, price, payType, userId) {
    const params = {
        app_id: Number(env.H5_APP_ID),
        out_trade_no: orderNo,
        description: plan.name,
        pay_type: payType === "wxpay" ? "wechat" : "alipay",
        amount: Math.round(parseFloat(price) * 100), // 单位：分（整数）
        attach: userId,
        notify_url: env.PAY_NOTIFY_URL,
    };
    params.sign = h5BuildSign(params, env.H5_APP_SECRET);

    // 网络失败/网关故障(非 2xx)按序切换备用节点；业务错误(2xx 但 code!==200)直接报错不切换
    let lastErr = null;
    const bases = env.PAY_API_URL ? [env.PAY_API_URL] : PAY_GATEWAY_BASES;
    for (const base of bases) {
        let payRes;
        try {
            payRes = await fetch(`${base}/api/h5`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(params),
                signal: AbortSignal.timeout(4000)
            });
        } catch (e) {
            lastErr = new Error(e.name === "TimeoutError" ? "支付网关响应超时，请稍后重试" : "支付网关连接失败");
            continue;
        }
        const payJson = await payRes.json().catch(() => ({}));
        if (payRes.ok && payJson.code === 200 && payJson.data && payJson.data.jump_url) {
            return { orderNo, jumpUrl: payJson.data.jump_url, tradeNo: payJson.data.trade_no || "" };
        }
        if (payRes.ok) throw new Error(payJson.msg || "支付网关返回异常");
        lastErr = new Error(`支付网关响应异常(HTTP ${payRes.status})`);
    }
    throw lastErr || new Error("支付网关连接失败");
}

// 公共发货：查单 → 幂等 → 金额校验(分) → 充值档发云币(首充双倍)/lifetime 开通会员 → PATCH 订单
async function settlePaidOrder(env, orderNo, tradeNo, amountCents) {
    const filter = encodeURIComponent(`order_no='${escapePocketBaseFilterValue(orderNo)}'`);
    const q = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${filter}`);
    if (!q.ok) return "fail";
    const data = await q.json();
    const order = (data.items || [])[0];
    if (!order) return "fail";
    if (order.status === "paid") return "success"; // 幂等：重复回调不重复发放

    const expectAmount = Math.round(parseFloat(order.amount) * 100);
    if (String(amountCents) !== String(expectAmount)) return "fail"; // 金额(分)校验防伪造

    const now = new Date().toISOString();
    const isLifetime = order.plan_id === "lifetime";
    const memberPlan = MEMBER_PLANS[order.plan_id];

    const plan = isLifetime ? LIFETIME_PLAN : (memberPlan || CHARGE_PLANS[order.plan_id]);
    if (!plan) return "fail";

    // 读当前余额（PocketBase 无原子自增，先读后写）
    const userRes = await pbAdminFetch(env, `/api/collections/users/records/${order.user_id}`);
    if (!userRes.ok) return "fail";
    const user = await userRes.json();

    const patch = {};
    let isFirst = false;
    if (isLifetime) {
        patch.membership_type = "lifetime";
        patch.membership_expires_at = LIFETIME_EXPIRY;
    } else if (memberPlan) {
        // 会员开通/续费：新到期 = max(现到期, 现在) + 时长，提前续费不吞时长
        const baseMs = Math.max(Date.now(), Date.parse(user.membership_expires_at || "") || 0);
        patch.membership_type = memberPlan.id;
        patch.membership_expires_at = new Date(baseMs + memberPlan.days * 86400000).toISOString();
    } else {
        // 首充判定：该用户除本订单外无已支付记录 → 双倍(基础×2)；否则 基础+赠送
        const paidFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(order.user_id)}'&&status='paid'&&id!='${order.id}'`);
        const pq = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${paidFilter}`);
        const pd = await pq.json().catch(() => ({}));
        isFirst = !(pd.items || []).length;
        patch.coins = Number(user.coins || 0) + (isFirst ? plan.base * 2 : plan.base + plan.bonus);
    }
    const patchRes = await pbAdminFetch(env, `/api/collections/users/records/${order.user_id}`, {
        method: "PATCH",
        body: JSON.stringify(patch)
    });
    if (!patchRes.ok) return "fail";

    // 余额变动快照(coin_ledger):before/after 落库留证;失败不影响发货
    const before = Number(user.coins || 0);
    if (isLifetime) {
        await logCoinLedger(env, order.user_id, orderNo, 0, before, before, "lifetime_membership");
    } else if (memberPlan) {
        await logCoinLedger(env, order.user_id, orderNo, 0, before, before, `membership_${memberPlan.id}`);
    } else {
        const delta = patch.coins - before;
        await logCoinLedger(env, order.user_id, orderNo, delta, before, patch.coins, isFirst ? "首充双倍到账" : "充值到账");
    }

    await pbAdminFetch(env, `/api/collections/pay_orders/records/${order.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "paid", trade_no: tradeNo || "", paid_at: now })
    });
    return "success";
}

// 回调原文留档(pay_notify_log):验签结果+原始报文,审计留证用;留档失败不影响主流程
async function logNotify(env, gateway, orderNo, raw, signValid, status, amount, tradeNo) {
    try {
        await pbAdminFetch(env, `/api/collections/pay_notify_log/records`, {
            method: "POST",
            body: JSON.stringify({
                gateway, order_no: String(orderNo || ""),
                raw: String(raw || "").slice(0, 8000),
                sign_valid: !!signValid,
                status: String(status || ""),
                amount: String(amount || ""),
                trade_no: String(tradeNo || "")
            })
        });
    } catch (e) {
        console.error("logNotify error:", e.message);
    }
}

// 余额变动快照(coin_ledger):before/after 落库留证;失败不影响主流程
async function logCoinLedger(env, userId, orderNo, delta, before, after, reason) {
    try {
        await pbAdminFetch(env, `/api/collections/coin_ledger/records`, {
            method: "POST",
            body: JSON.stringify({ user_id: String(userId || ""), order_no: String(orderNo || ""), delta, before, after, reason: String(reason || "") })
        });
    } catch (e) {
        console.error("logCoinLedger error:", e.message);
    }
}

// h5zhifu 回调处理：验签 → trade_status 校验 → 公共发货；原文留档(含验签失败)
async function handlePayNotify(env, params, raw = "") {
    try {
        const signValid = verifyH5Sign(params, env.H5_APP_SECRET);
        await logNotify(env, "h5zhifu", params.out_trade_no || "", raw, signValid, params.trade_status || "notify", params.amount || "", params.trade_no || "");
        if (!signValid) return "fail";
        // 回调文档参数表无 trade_status(能收到回调即已支付);旧版带该字段则校验,缺省放行
        if (params.trade_status && !["paid", "success"].includes(params.trade_status)) return "fail";
        return await settlePaidOrder(env, params.out_trade_no || "", params.trade_no || "", params.amount);
    } catch (e) {
        console.error("handlePayNotify error:", e.message);
        return "fail";
    }
}

// 虎皮椒回调处理：form 表单验签 → status=OD → 公共发货；回复 "success" 确认，否则网关重试 6 次
async function handleXunhuNotify(env, params, raw = "") {
    try {
        const signValid = verifyXunhuSign(params, env.XUNHU_APP_SECRET);
        await logNotify(env, "xunhu", params.trade_order_id || "", raw, signValid, String(params.status || ""), params.total_fee || "", params.transaction_id || params.open_order_id || "");
        if (!signValid) return "fail";
        // 退款等非支付事件：确认收到但不发货
        if (String(params.status) !== "OD") return "success";
        const amountCents = Math.round(parseFloat(String(params.total_fee || "0")) * 100);
        return await settlePaidOrder(env, params.trade_order_id || "", params.transaction_id || params.open_order_id || "", amountCents);
    } catch (e) {
        console.error("handleXunhuNotify error:", e.message);
        return "fail";
    }
}

// ==================== 6. 核心逻辑控制 ====================

async function authenticate(env, request) {
    const userAuthToken = request.headers.get("X-Auth-Token");
    if (!userAuthToken) return { error: errorResponse("请先登录", 401, null, "NOT_LOGGED_IN") };
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const authRes = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
        method: "POST",
        headers: { "Authorization": userAuthToken.startsWith("Bearer ") ? userAuthToken : `Bearer ${userAuthToken}` }
    });
    if (!authRes.ok) return { error: errorResponse("会话已过期", 401, null, "SESSION_EXPIRED") };
    const authData = await authRes.json();
    return { record: authData.record };
}

// ---- 语言文游 M4 gloss:点句翻译+难词释义合批(直调模型不落库、不进主站计费/配额;独立轻量候选链)----
const GLOSS_MAX_SENTENCES = 10;   // 前端亦按 ≤10 合批
const GLOSS_RATE_LIMIT_MS = 6000; // 单实例内存限频即可(与 POST_RATE_LIMIT_MS 同理)
const glossRateMap = new Map();
// 候选优先免费档(智谱 flash 系/NVIDIA oss),终兜底付费 glm-5.3-flash(与 MODEL_POOL 末位 tier 一致)
const GLOSS_MODEL_IDS = ["zp-glm-4.7-flash", "zp2-glm-4-flash", "zp-glm-4-flash", "zp-glm-4.5-air", "nv-gpt-oss-20b", "zp-glm-5.3-flash"];
const GLOSS_SYSTEM_PROMPT = [
    "You are a friendly English→Chinese tutor for a Chinese learner reading English game-story scenes.",
    "Task: for each numbered English sentence provide (a) a natural, fluent Chinese translation (zh) — not word-for-word literal; (b) 1-3 most valuable words/phrases for this learner to notice (prefer what an intermediate learner may not know; include phrasal verbs/idioms when present), each with a SHORT English explanation (en, under 20 words) and a short Chinese gloss (zh).",
    "Rules: w should be the base form when possible (breathed → breathe); keep multi-word phrases as-is. Do not translate character or place names — keep them as-is inside the translation.",
    'Reply ONLY with a single valid JSON object, no markdown fences, no extra text: {"items":[{"idx":0,"sentence":"exact input sentence","zh":"...","words":[{"w":"...","en":"...","zh":"..."}]}]}',
    '"idx" must match the input numbering; "sentence" must echo the input sentence exactly.'
].join("\n");
function cleanJsonText(s) {
    s = String(s || "").trim();
    if (s.startsWith("```")) s = s.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```\s*$/i, "").trim();
    const a = s.indexOf("{"), b = s.lastIndexOf("}");
    return a >= 0 && b > a ? s.slice(a, b + 1) : s;
}
async function callGlossModel(env, sentences) {
    const userMsg = "Sentences to translate:\n" + sentences.map((s, i) => `[${i}] ${s}`).join("\n");
    const candidates = GLOSS_MODEL_IDS.map((id) => MODEL_POOL.find((m) => m.id === id && m.enabled)).filter(Boolean);
    const errs = [];
    for (const t of candidates) {
        const apiKey = env[t.apiKeyEnv];
        if (!apiKey) { errs.push(t.id + ":nokey"); continue; }
        try {
            const res = await fetch((t.url || "").replace(/\/$/, "") + "/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: t.model,
                    temperature: 0.2,
                    max_tokens: Math.min(8000, Math.max(3000, sentences.length * 400)),
                    messages: [
                        { role: "system", content: GLOSS_SYSTEM_PROMPT },
                        { role: "user", content: userMsg }
                    ]
                }),
                signal: AbortSignal.timeout(45000)
            });
            if (!res.ok) { errs.push(t.id + ":http" + res.status); continue; }
            const data = await res.json().catch(() => ({}));
            const content = cleanJsonText(String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""));
            if (!content) { errs.push(t.id + ":empty"); continue; }
            const parsed = JSON.parse(content);
            const raw = Array.isArray(parsed.items) ? parsed.items : [];
            const slots = [];
            for (const it of raw) {
                const idx = Number(it && it.idx);
                if (!(idx >= 0 && idx < sentences.length)) continue;
                const words = (Array.isArray(it.words) ? it.words : []).slice(0, 5)
                    .map((wd) => ({
                        w: String(wd && (wd.w || wd.word) || "").trim().slice(0, 64),
                        en: String(wd && wd.en || "").trim().slice(0, 200),
                        zh: String(wd && wd.zh || "").trim().slice(0, 200)
                    })).filter((x) => x.w);
                slots[idx] = { sentence: sentences[idx], zh: String(it.zh || "").trim().slice(0, 600), words };
            }
            const items = [];
            for (let i = 0; i < sentences.length; i++) {
                const s = slots[i] || { sentence: sentences[i], zh: "", words: [] };
                if (s.words.length > 3) s.words = s.words.slice(0, 3); // 每句最多 3 个关键表达
                items.push(s);
            }
            if (items.some((x) => x.zh)) return { items };
            errs.push(t.id + ":nozh");
        } catch (e) { errs.push(t.id + ":err"); }
    }
    return { error: errorResponse("翻译服务暂时繁忙，稍后再试", 503, errs.join(","), "GLOSS_UNAVAILABLE") };
}

// ---- 语言文游 M5 recap:章末复盘生成(剧情→高频表达+仿写例句;直调模型不落库;收藏由前端写 lang_vocab)----
const RECAP_STORY_LIMIT = 8000;
const RECAP_RATE_LIMIT_MS = 6000;
const recapRateMap = new Map();
let bankCache = { t: 0, data: null }; // M6d1 五档考试词库内存缓存(单 isolate,10min TTL)
let langCardsCache = { t: 0, data: null }; // M6b 语言卡库内存缓存(单 isolate,60s TTL)
// M6d2 档位化:五档值域 + 旧 a/b/c 迁移(a→cet4/b→cet6/c→ky);空/未知返回 ""
const LANG_BANDS = ["hs", "cet4", "cet6", "ky", "toefl"];
const LANG_BAND_LEGACY = { a: "cet4", b: "cet6", c: "ky" };
const normLangBand = (v) => (LANG_BANDS.includes(v) ? v : (LANG_BAND_LEGACY[v] || ""));
const RECAP_MODEL_IDS = GLOSS_MODEL_IDS; // 同 gloss 候选链:免费档优先,付费 glm-5.3-flash 兜底
const RECAP_SYSTEM_PROMPT = [
    "You are an English-learning recap coach for a Chinese player who just finished a chapter of an English interactive story game.",
    "From the story excerpt, pick 3-6 high-value English expressions (phrases, sentence patterns, collocations, idioms — NOT single common words) worth remembering, tuned to the player band: hs = China senior-high syllabus level (simplest plain phrasings, everyday words only); cet4 = CET-4 level (plain everyday English); cet6 = CET-6 level (natural everyday English, a familiar idiom is fine); ky = postgrad-exam (考研) level (broad everyday English with moderate idiom); toefl = TOEFL level (richer idiomatic and lightly academic English).",
    "For each expression give: en (the expression itself), zh (short natural Chinese explanation), example (a short original English sentence using it — never copy story lines verbatim).",
    "Also write 2-3 short English sentences (writing) the player can imitate in the next chapter, each under 25 words, natural and story-flavored.",
    'Reply ONLY with a single valid JSON object, no markdown fences, no extra text: {"expressions":[{"en":"...","zh":"...","example":"..."}],"writing":["...","..."]}'
].join("\n");
async function callRecapModel(env, story, band) {
    const candidates = RECAP_MODEL_IDS.map((id) => MODEL_POOL.find((m) => m.id === id && m.enabled)).filter(Boolean);
    const errs = [];
    for (const t of candidates) {
        const apiKey = env[t.apiKeyEnv];
        if (!apiKey) { errs.push(t.id + ":nokey"); continue; }
        try {
            const res = await fetch((t.url || "").replace(/\/$/, "") + "/chat/completions", {
                method: "POST",
                headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({
                    model: t.model,
                    temperature: 0.4,
                    max_tokens: 4000,
                    messages: [
                        { role: "system", content: RECAP_SYSTEM_PROMPT },
                        { role: "user", content: `Player band: ${band || "cet6"}\n\nStory excerpt:\n${story}` }
                    ]
                }),
                signal: AbortSignal.timeout(45000)
            });
            if (!res.ok) { errs.push(t.id + ":http" + res.status); continue; }
            const data = await res.json().catch(() => ({}));
            const content = cleanJsonText(String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || ""));
            if (!content) { errs.push(t.id + ":empty"); continue; }
            const parsed = JSON.parse(content);
            const expressions = (Array.isArray(parsed.expressions) ? parsed.expressions : []).slice(0, 6)
                .map((x) => ({
                    en: String(x && x.en || "").trim().slice(0, 120),
                    zh: String(x && x.zh || "").trim().slice(0, 200),
                    example: String(x && x.example || "").trim().slice(0, 300)
                })).filter((x) => x.en);
            const writing = (Array.isArray(parsed.writing) ? parsed.writing : []).slice(0, 3)
                .map((s) => String(s || "").trim().slice(0, 300)).filter(Boolean);
            if (expressions.length || writing.length) return { expressions, writing };
            errs.push(t.id + ":emptyjson");
        } catch (e) { errs.push(t.id + ":err"); }
    }
    return { error: errorResponse("复盘生成失败，请稍后重试", 503, errs.join(","), "RECAP_UNAVAILABLE") };
}

export default {
    async fetch(request, env, ctx) {
        if (!isAllowedOrigin(request.headers.get("Origin"))) {
            return errorResponse("来源校验失败", 403, null, "FORBIDDEN_ORIGIN");
        }
        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

        const url = new URL(request.url);

        try {
            // ---- 路由：AI 对话（模型池自动路由 + 每日限额/会员校验）----
            if (url.pathname === "/chat/completions") {
                // 测试后门：MODEL_URL_OVERRIDE 为 JSON {"模型id":"http://mock"}，仅探针把模型指向本地 mock，生产不配置
                let modelUrlOverrides = null;
                try { modelUrlOverrides = env.MODEL_URL_OVERRIDE ? JSON.parse(env.MODEL_URL_OVERRIDE) : null; } catch (e) { modelUrlOverrides = null; }
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const record = auth.record;
                const userId = record.id;

                // 解析请求(body 只能消费一次,提前到免费额度/会员/云币校验之前)
                const bodyText = await request.text();
                const requestJson = safeJsonParse(bodyText);

                // 会员判定：会员到期自动回退免费用户（免费额度照常；membership_type 保留仅靠 expires_at 判定）
                const isMemberUser = isMember(record);
                // 三模式：免费模式（今日 50 次内，仅 NVIDIA 全部 + 硅基 sf-glm-4-9b，不扣币，成功后计数）
                //          / 云币模式（超限，全池路由，成功后按 token 扣币）/ 会员模式（不限次不扣币）
                const quotaDate = getFreeQuotaDateStr();
                const freeUsed = isMemberUser ? FREE_QUOTA_PER_DAY : await readFreeQuota(env, userId, quotaDate);
                const freeMode = !isMemberUser && freeUsed < FREE_QUOTA_PER_DAY;
                const freeExhausted = !isMemberUser && !freeMode;
                // 云币计费：成功后按实际 token 结算（输入 4 币/千、输出 12 币/千）；请求开始仅校验最低余额，失败不扣费；会员免扣
                if (freeExhausted) {
                    const coin = Number(record.coins || 0);
                    if (coin < TOKEN_COST_MIN) {
                        return errorResponse(`云币不足（AI 对话按 token 计费，余额至少需 ${TOKEN_COST_MIN} 云币），今日免费额度已用完，请充值云币或开通会员`, 402,
                            { coins: coin, minCost: TOKEN_COST_MIN }, "INSUFFICIENT_COIN");
                    }
                }

                const isStream = requestJson.stream === true;

                // 模型池路由：免费模式仅 NVIDIA 全部 + 硅基 sf-glm-4-9b，其余模式全池
                const today = getTodayStr();
                const usageMap = await readModelUsageMap(env, today);
                const pool = freeMode ? MODEL_POOL.filter(m => m.enabled && (m.id.startsWith("nv-") || m.id === "sf-glm-4-9b")) : MODEL_POOL;
                // 测试后门：model 传 "pool:<模型id>" 可指定池内模型（仅认证用户可用，探针/兼容性实测用）
                const forcedModel = requestJson.model && typeof requestJson.model === "string" && requestJson.model.indexOf("pool:") === 0
                    ? MODEL_POOL.find(m => m.id === requestJson.model.slice(5)) : null;
                const picked = forcedModel || pickModel(usageMap, today, isMemberUser, pool);
                if (!picked) {
                    return errorResponse(freeMode ? "免费模型暂时不可用，请稍后重试" : "今日全部模型配额已用尽，请明天再试", 429, null, "QUOTA_EXCEEDED");
                }
                const candidates = forcedModel ? [forcedModel] : [
                    picked,
                    ...pool.filter(m => m.enabled && m.id !== picked.id && (usageMap[m.id] || 0) < m.dailyCap)
                        .sort((a, b) => a.tier - b.tier)
                ];

                // 逐候选转发：非 2xx / 网络异常 → 换下一个（每个候选完整超时,不截断慢模型;
                // 全挂场景首次判定可能较长,但失败模型即熔断,后续请求 <1s 直接跳过,前端 90s 读超时兜底）
                let aiResponse = null;
                let usedModel = null;
                let upstreamNonStream = false; // 上游是否已被转为非流式(决定回吐方式)
                const attempts = []; // 诊断:记录每个候选的尝试结果(模型:状态:耗时ms)
                for (const target of candidates) {
                    const attemptStart = Date.now();
                    if (await isModelInCooldown(target.id)) { attempts.push(`${target.id}:cooldown`); continue; } // 熔断期内跳过,不重走失败链
                    const apiKey = env[target.apiKeyEnv];
                    if (!apiKey) { attempts.push(`${target.id}:nokey`); continue; }
                    const base = (modelUrlOverrides?.[target.id] || target.url).replace(/\/$/, "");
                    // 上游限流门控:并发/速率超限拿不到令牌 → 换候选(避免自触发 1302/1305)
                    // 免费模式用 400ms 快速判定:16 候选最坏 8s×N 拖到 128s,缩短到 ~6.4s,全忙立刻转 429 排队反馈
                    if (!(await gateAcquire(target.apiKeyEnv, target.id, freeMode ? 400 : undefined))) { attempts.push(`${target.id}:busy`); continue; }
                    let resp = null;
                    let respStatus = 0;
                    try {
                        // 429(账户/模型限流)可恢复:尊重 Retry-After 短等待后同模型重试 1 次,不触发熔断
                        // 网络抖动也重试 1 次;超时/其他错误直接换候选
                        // 流式坏模型两档:STREAM_NO_JSON 剥 format 保持流式(讯飞系实测可行);STREAM_BROKEN 强制非流式(实测零输出)
                        const converted = isStream && STREAM_BROKEN.includes(target.id);
                        for (let retry = 0; retry <= 1; retry++) {
                            const controller = new AbortController();
                            const timeoutMs = converted ? 120000 : (isStream ? 15000 : 120000); // 流式仅等响应头(15s),body 透传由前端控制;慢模型快速 fallback
                            const timeout = setTimeout(() => controller.abort(), timeoutMs);
                            try {
                                const payload = { ...requestJson, model: target.model };
                                if (isStream && STREAM_NO_JSON.includes(target.id)) delete payload.response_format;
                                if (converted) { payload.stream = false; upstreamNonStream = true; }
                                // Qwen3 系/Qwen3.5/GLM-Z1/DeepSeek-R1 默认思考模式(reasoning 占 87% token,耗时 28-37s),强制关闭提速 ~20 倍
                                if (["sf-qwen3-8b", "sf-qwen3.5-4b", "sf-glm-z1-9b", "sf-r1-qwen3-8b"].includes(target.id)) payload.enable_thinking = false;
                                // 注意：不修改请求体其它字段（如 stream_options），部分上游模型不支持会报错或改变输出行为
                                const r = await fetch(`${base}/chat/completions`, {
                                    method: "POST",
                                    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
                                    body: JSON.stringify(payload),
                                    signal: controller.signal
                                });
                                clearTimeout(timeout);
                                resp = r;
                                respStatus = r.status;
                                if (r.status === 429) {
                                    const bodyPreview = (await r.text()).slice(0, 60).replace(/\s+/g, " ");
                                    if (retry === 0) {
                                        const ra = parseRetryAfterMs(r);
                                        if (ra !== null && ra <= 2000) {
                                            attempts.push(`${target.id}:429:${Date.now() - attemptStart}ms [${bodyPreview}] → 等 ${ra}ms 重试`);
                                            await sleep(ra + Math.floor(Math.random() * 100)); // Retry-After + 抖动防惊群
                                            continue;
                                        }
                                    }
                                    attempts.push(`${target.id}:429:${Date.now() - attemptStart}ms [${bodyPreview}]`); // 限流可恢复:30s 短熔断后换候选,避免下个请求白试
                                    await setModelCooldown(target.id, MODEL_429_COOLDOWN_MS);
                                    resp = null;
                                    break;
                                }
                                break;
                            } catch (e) {
                                clearTimeout(timeout);
                                if (retry === 0 && !controller.signal.aborted) continue; // 网络抖动重试 1 次,超时不重试
                                attempts.push(`${target.id}:err:${Date.now() - attemptStart}ms`);
                                resp = null;
                                break;
                            }
                        }
                    } finally {
                        gateRelease(target.apiKeyEnv, target.id);
                    }
                    if (!resp) continue;
                    attempts.push(`${target.id}:${respStatus}:${Date.now() - attemptStart}ms`);
                    if (respStatus >= 400) {
                        const bodyPreview = (await resp.text()).slice(0, 80).replace(/\s+/g, " ");
                        attempts[attempts.length - 1] += ` [${bodyPreview}]`;
                    }
                    if (resp.ok) {
                        await clearModelCooldown(target.id); // 成功即解除熔断
                        aiResponse = resp;
                        usedModel = target;
                        break;
                    }
                    await setModelCooldown(target.id);
                    console.warn(`model ${target.id} failed (${respStatus}), fallback next`);
                }
                if (!aiResponse) {
                    // 免费模式并发/限流占满 → 立即返回排队状态(不等满 8s×候选),失败不扣额度,前端 3s 轮询重试;
                    // 云币/会员保持 503,由既有 fetchWithRetry 兜底
                    if (freeMode) {
                        freeQueueSeen.set(userId, Date.now());
                        const queueLen = freeQueueLen();
                        const resp = errorResponse("AI 模型当前繁忙，已进入排队，请稍候自动重试", 429, { queueLen }, "QUEUE_BUSY");
                        return new Response(resp.body, {
                            status: 429,
                            headers: { ...Object.fromEntries(resp.headers.entries()), "X-Queue-Len": String(queueLen), "Retry-After": "3" }
                        });
                    }
                    return errorResponse("AI 服务暂时不可用，请稍后重试", 503, null, "POOL_UNAVAILABLE");
                }

                // 成功后才计模型级配额（会员绕过 dailyCap 不挤压免费用户；云币在成功后按 token 结算，失败不扣费；
                // 免费模式成功后计个人免费额度,第 50 次用完即转云币模式）
                ctx.waitUntil((async () => {
                    try {
                        if (!isMemberUser) await bumpModelUsage(env, usedModel.id, today);
                        if (freeMode) await bumpFreeQuota(env, userId, quotaDate);
                    } catch (e) {
                        console.error("usage bump failed:", e.message);
                    }
                })());

                const diagHeaders = {
                    "X-Model-Used": usedModel.id,
                    "X-Model-Attempts": attempts.join("|"),
                    ...(freeExhausted ? { "X-Free-Exhausted": "1" } : {})
                };
                if (isStream) {
                    // 流式坏模型:上游已按非流式返回,读完整 content 组装单块 SSE(打字机整卡显示,前端 finishStreaming 整卡替换)
                    if (STREAM_BROKEN.includes(usedModel.id) && upstreamNonStream) {
                        const encoder = new TextEncoder();
                        const text = await aiResponse.text();
                        let outText = "";
                        let convNote = `len=${text.length}`;
                        try {
                            const j = JSON.parse(text);
                            outText = j?.choices?.[0]?.message?.content || "";
                            convNote += ` parsed=${j.choices?.[0]?.message?.role || "?"}`;
                        } catch (e) { outText = text; convNote += " raw-fallback"; } // 解析失败:原样回吐,前端兜底解析
                        convNote += ` out=${outText.length} nl=${(outText.match(/\n/g) || []).length}`;
                        const body = new ReadableStream({
                            start(controller) {
                                if (outText) {
                                    // 上游非流式 content 可能是带真实换行的格式化 JSON,直接塞 SSE data 行会断行 → 压成空格(JSON 语义不变)
                                    const safe = outText.replace(/\r?\n/g, " ");
                                    convNote += ` safe=${safe.length} safenl=${(safe.match(/\n/g) || []).length}`;
                                    const chunk = JSON.stringify({ choices: [{ delta: { content: safe }, index: 0 }] });
                                    controller.enqueue(encoder.encode(`data: ${chunk}\n\n`));
                                }
                                controller.enqueue(encoder.encode("data: [DONE]\n\n"));
                                controller.close();
                                if (freeExhausted) {
                                    const inputTokens = estimateInputTokens(requestJson.messages);
                                    const outputTokens = estimateTokens(outText);
                                    ctx.waitUntil(settleTokenDeduction(env, userId, record, inputTokens, outputTokens)
                                        .catch(e => console.error("settle token deduction failed:", e.message)));
                                }
                            }
                        });
                        return new Response(body, {
                            headers: { ...corsHeaders(), ...diagHeaders, "X-Convert": convNote, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
                        });
                    }
                    // token 计费：透传转发 SSE 并统计输出字符（不做任何请求体/响应体修改，仅按字符估算 token）；
                    // 仅流完整结束时结算扣费，客户端中断/上游断流视为失败不扣（玩家重试时不会重复计费）
                    const reader = aiResponse.body.getReader();
                    const decoder = new TextDecoder("utf-8");
                    const encoder = new TextEncoder();
                    let tail = "";
                    let outText = "";
                    const settle = () => {
                        if (freeExhausted) {
                            const inputTokens = estimateInputTokens(requestJson.messages);
                            const outputTokens = estimateTokens(outText);
                            ctx.waitUntil(settleTokenDeduction(env, userId, record, inputTokens, outputTokens)
                                .catch(e => console.error("settle token deduction failed:", e.message)));
                        }
                    };
                    const stream = new ReadableStream({
                        async pull(controller) {
                            try {
                                const { done, value } = await reader.read();
                                if (done) { settle(); controller.close(); return; }
                                tail += decoder.decode(value, { stream: true });
                                const lines = tail.split("\n");
                                tail = lines.pop() || "";
                                let out = "";
                                for (const line of lines) {
                                    if (line.startsWith("data: ")) {
                                        const data = line.slice(6);
                                        if (data !== "[DONE]") {
                                            try {
                                                const p = JSON.parse(data);
                                                const delta = p.choices?.[0]?.delta || {};
                                                if (delta.content) outText += delta.content;
                                            } catch (e) { /* 非 JSON 行原样转发 */ }
                                        }
                                    }
                                    out += line + "\n";
                                }
                                if (out) controller.enqueue(encoder.encode(out));
                            } catch (e) {
                                controller.error(e);
                            }
                        },
                        cancel() { /* 客户端中断：视为失败不结算，重试不重复扣费 */ }
                    });
                    return new Response(stream, {
                        headers: { ...corsHeaders(), ...diagHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
                    });
                }
                // 非流式：校验 choices[0].message.content 为合法 JSON，失败则同模型重试 ≤2 次（前端有降级兜底）
                let resJson = null;
                try { resJson = await aiResponse.json(); } catch (e) { resJson = null; }
                const isGoodJson = () => {
                    const c = resJson?.choices?.[0]?.message?.content;
                    if (typeof c !== "string") return false;
                    try { JSON.parse(c); return true; } catch (e) { return false; }
                };
                for (let i = 0; i < 2 && !isGoodJson(); i++) {
                    const retryPayload = { ...requestJson, model: usedModel.model };
                    retryPayload.messages = [
                        ...(requestJson.messages || []),
                        { role: "user", content: "你上一次的回复内容不是合法 JSON。请仅输出一个合法 JSON 对象，不要任何解释、围栏或多余字符。" }
                    ];
                    const retryBase = (modelUrlOverrides?.[usedModel.id] || usedModel.url).replace(/\/$/, "");
                    const ctrl = new AbortController();
                    const to = setTimeout(() => ctrl.abort(), 120000);
                    try {
                        const resp = await fetch(`${retryBase}/chat/completions`, {
                            method: "POST",
                            headers: { "Authorization": `Bearer ${env[usedModel.apiKeyEnv]}`, "Content-Type": "application/json" },
                            body: JSON.stringify(retryPayload),
                            signal: ctrl.signal
                        });
                        if (resp.ok) resJson = await resp.json();
                    } catch (e) {
                        console.warn(`non-stream JSON retry error: ${e.message}`);
                    }
                    clearTimeout(to);
                }
                // 成功 → 按字符估算 token 结算扣费（仅云币模式）；失败不扣费
                if (freeExhausted && resJson) {
                    const inputTokens = estimateInputTokens(requestJson.messages);
                    const outputTokens = estimateTokens(resJson?.choices?.[0]?.message?.content ?? "");
                    await settleTokenDeduction(env, userId, record, inputTokens, outputTokens)
                        .catch(e => console.error("settle token deduction failed:", e.message));
                }
                return new Response(JSON.stringify(resJson ?? { error: "AI 响应解析失败" }), {
                    headers: { ...corsHeaders(), ...diagHeaders, "Content-Type": "application/json" }
                });
            }

            // ---- 路由：云币余额与会员状态 ----
            if (url.pathname === "/api/usage" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                const isMem = isMember(r);
                const quotaDate = getFreeQuotaDateStr();
                const freeUsed = isMem ? FREE_QUOTA_PER_DAY : await readFreeQuota(env, r.id, quotaDate);
                return new Response(JSON.stringify({
                    isMember: isMem,
                    membershipType: r.membership_type || "",
                    membershipExpiresAt: r.membership_expires_at || "",
                    memberDaysLeft: memberDaysLeft(r),
                    coins: Number(r.coins || 0),
                    pricing: { inputPerK: TOKEN_PRICE_INPUT, outputPerK: TOKEN_PRICE_OUTPUT, minCost: TOKEN_COST_MIN },
                    unlockCost: UNLOCK_COST,
                    // 会员不限量用 -1 表示（避免 Infinity 序列化为 null）；remaining 按普通对话约 10 币/轮粗估
                    remaining: isMem ? -1 : Math.floor(Number(r.coins || 0) / 10),
                    // 免费额度只给布尔态（前端不展示数量），仅用于耗尽提示
                    freeQuotaExhausted: !isMem && freeUsed >= FREE_QUOTA_PER_DAY
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：邮箱验证码（发送/注册，自建 SMTP 代理中转；验证码仅存服务端）----
            const EMAIL_CODE_TTL_MIN = 5;          // 验证码有效期(分钟)
            const EMAIL_SEND_COOLDOWN_MS = 60000;  // 同邮箱发送冷却
            const MAIL_API = env.MAIL_API || "http://mail.blupure.cn/mail/send"; // 自建代理(47.238.246.167 nginx→9527, 163 双邮箱轮询)
            const MAIL_TOKEN = env.MAIL_TOKEN || "yt_mail_2026_a9Kx7QmZ";
            const buildMailHtml = (purpose, code) => `
                <div style="max-width:480px;margin:0 auto;padding:24px;font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;">
                    <div style="background:linear-gradient(135deg,#7c3aed,#4f46e5);border-radius:12px;padding:20px 24px;color:#fff;">
                        <div style="font-size:18px;font-weight:700;">云吞吞文游</div>
                        <div style="font-size:12px;opacity:.85;margin-top:4px;">每一次选择，都将书写独一无二的人生</div>
                    </div>
                    <div style="padding:24px 8px;">
                        <p style="font-size:14px;color:#333;line-height:1.8;margin:0;">你好！${purpose === "reset" ? "我们收到了你的密码重置请求" : "欢迎来到云吞吞文游"}，你的验证码是：</p>
                        <div style="font-size:32px;font-weight:800;letter-spacing:8px;color:#4f46e5;margin:16px 0;text-align:center;">${code}</div>
                        <p style="font-size:13px;color:#666;line-height:1.8;margin:0;">验证码 <b>5 分钟</b>内有效，${purpose === "reset" ? "如非本人操作请忽略此邮件" : "请勿泄露给他人"}。</p>
                    </div>
                    <div style="border-top:1px solid #eee;padding-top:12px;font-size:12px;color:#999;text-align:center;">云吞吞文游 · bitlife.blupure.cn · 遇见另一个自己</div>
                </div>`;

            if (url.pathname === "/api/auth/send-code" && request.method === "POST") {
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const purpose = body.purpose === "reset" ? "reset" : "register";
                const email = String(body.email || "").trim().toLowerCase();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 255) {
                    return errorResponse("邮箱格式不正确", 400, null, "INVALID_EMAIL");
                }
                // 存在性分流: 注册=邮箱必须未注册; 重置=邮箱必须已注册
                const dupQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const dupD = await dupQ.json().catch(() => ({}));
                const exists = (dupD.items || []).length > 0;
                if (purpose === "register" && exists) return errorResponse("该邮箱已注册，可直接登录", 400, null, "EMAIL_EXISTS");
                if (purpose === "reset" && !exists) return errorResponse("该邮箱未注册", 400, null, "EMAIL_NOT_FOUND");
                // 冷却限频
                const recQ = await pbAdminFetch(env, `/api/collections/email_codes/records?perPage=1&sort=-created_at&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const recD = await recQ.json().catch(() => ({}));
                const last = (recD.items || [])[0];
                if (last && Date.now() - Date.parse(last.created_at || 0) < EMAIL_SEND_COOLDOWN_MS) {
                    const wait = Math.max(1, Math.ceil((EMAIL_SEND_COOLDOWN_MS - (Date.now() - Date.parse(last.created_at || 0))) / 1000));
                    return errorResponse(`发送太频繁，${wait} 秒后再试`, 429, { retryAfter: wait }, "TOO_FREQUENT");
                }
                // 生成验证码并调用自建 SMTP 代理投递(验证码不回传, 仅存 PB)
                const code = String(Math.floor(100000 + Math.random() * 900000));
                const mailRes = await fetch(MAIL_API, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        token: MAIL_TOKEN,
                        to: email,
                        subject: purpose === "reset" ? "【云吞吞文游】重置密码验证码" : "【云吞吞文游】注册验证码",
                        html: buildMailHtml(purpose, code)
                    }),
                    // 15s 兜底:CF→自建代理公网链路抖动时快速失败,避免前端等到 20s 超时
                    signal: AbortSignal.timeout(15000)
                }).catch(() => null);
                let mailOk = false;
                if (mailRes) { try { const d = await mailRes.json(); mailOk = !!(d && d.ok === true); } catch (e) {} }
                if (!mailOk) {
                    return errorResponse("邮件服务繁忙，请稍后再试", 502, null, "MAIL_SERVICE_DOWN");
                }
                // 作废旧码(防堆积/防旧码复用)
                const oldQ = await pbAdminFetch(env, `/api/collections/email_codes/records?perPage=10&sort=-created_at&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const oldD = await oldQ.json().catch(() => ({}));
                for (const o of (oldD.items || []).filter(x => !x.used)) {
                    await pbAdminFetch(env, `/api/collections/email_codes/records/${o.id}`, {
                        method: "PATCH", body: JSON.stringify({ used: true })
                    }).catch(() => {});
                }
                // 存新码
                const save = await pbAdminFetch(env, `/api/collections/email_codes/records`, {
                    method: "POST",
                    body: JSON.stringify({ email, code, purpose, expires_at: new Date(Date.now() + EMAIL_CODE_TTL_MIN * 60000).toISOString(), used: false })
                });
                if (!save.ok) return errorResponse("验证码保存失败，请重试", 500, null, "CODE_SAVE_FAILED");
                return new Response(JSON.stringify({ sent: true }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            if (url.pathname === "/api/auth/register" && request.method === "POST") {
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const email = String(body.email || "").trim().toLowerCase();
                const code = String(body.code || "").trim();
                const password = String(body.password || "");
                const username = String(body.username || "").trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("邮箱格式不正确", 400, null, "INVALID_EMAIL");
                if (!/^\d{6}$/.test(code)) return errorResponse("验证码格式不正确", 400, null, "INVALID_CODE");
                if (password.length < 8) return errorResponse("密码至少需要8位", 400, null, "WEAK_PASSWORD");
                if (username && !/^[a-zA-Z0-9_-]{3,30}$/.test(username)) return errorResponse("用户名需为3-30位字母/数字/下划线", 400, null, "INVALID_USERNAME");
                // 校验验证码(未用+未过期+用途匹配)
                const q = await pbAdminFetch(env, `/api/collections/email_codes/records?perPage=10&sort=-created_at&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const d = await q.json().catch(() => ({}));
                const items = d.items || [];
                const row = items.find(x => !x.used && x.purpose === "register" && x.code === code && Date.parse(x.expires_at || 0) > Date.now());
                if (!row) {
                    // 细分原因: 过期/重发作废/输错,避免笼统"错误或已过期"误导
                    const my = items.find(x => x.purpose === "register" && x.code === code);
                    if (my) {
                        if (my.used) return errorResponse("你最近重新发送过验证码，旧码已失效，请使用最新邮件中的验证码", 400, null, "CODE_STALE");
                        if (Date.parse(my.expires_at || 0) <= Date.now()) return errorResponse("验证码已过期，请重新获取", 400, null, "CODE_EXPIRED");
                    }
                    // 无该码记录(输错或过旧被截断): 最新码已被作废时多半是拿旧码提交
                    const latest = items.find(x => x.purpose === "register");
                    if (latest && latest.used) return errorResponse("你最近重新发送过验证码，旧码已失效，请使用最新邮件中的验证码", 400, null, "CODE_STALE");
                    return errorResponse("验证码不正确，请核对后重试", 400, null, "CODE_WRONG");
                }
                // 先标记已用(防并发重放)
                await pbAdminFetch(env, `/api/collections/email_codes/records/${row.id}`, {
                    method: "PATCH", body: JSON.stringify({ used: true })
                }).catch(() => {});
                // 邮箱查重(unique 索引兜底)
                const dupQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const dupD = await dupQ.json().catch(() => ({}));
                if ((dupD.items || []).length) return errorResponse("该邮箱已注册，可直接登录", 400, null, "EMAIL_EXISTS");
                // 建号
                const createRes = await pbAdminFetch(env, `/api/collections/users/records`, {
                    method: "POST",
                    body: JSON.stringify({
                        email, password, passwordConfirm: password, emailVisibility: true, verified: true,
                        // 注册填写的昵称直接落库,"我的"页面才有初始昵称
                        ...(username ? { username, nickname: username } : {})
                    })
                });
                if (!createRes.ok) {
                    const msg = (await createRes.json().catch(() => ({})))?.message || "注册失败，请重试";
                    return errorResponse(String(msg).slice(0, 100), 400, null, "REGISTER_FAILED");
                }
                // 签发 token
                const loginRes = await fetch(`${(env.PB_URL || "").replace(/\/$/, "")}/api/collections/users/auth-with-password`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identity: email, password })
                });
                const loginData = await loginRes.json().catch(() => ({}));
                if (!loginData.token) return errorResponse("注册成功，请直接登录", 200, null, "");
                return new Response(JSON.stringify({ token: loginData.token, record: loginData.record }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            if (url.pathname === "/api/auth/reset-password" && request.method === "POST") {
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const email = String(body.email || "").trim().toLowerCase();
                const code = String(body.code || "").trim();
                const password = String(body.password || "");
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return errorResponse("邮箱格式不正确", 400, null, "INVALID_EMAIL");
                if (!/^\d{6}$/.test(code)) return errorResponse("验证码格式不正确", 400, null, "INVALID_CODE");
                if (password.length < 8) return errorResponse("密码至少需要8位", 400, null, "WEAK_PASSWORD");
                // 校验重置码(未用+未过期+用途 reset)
                const q = await pbAdminFetch(env, `/api/collections/email_codes/records?perPage=10&sort=-created_at&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const d = await q.json().catch(() => ({}));
                const items = d.items || [];
                const row = items.find(x => !x.used && x.purpose === "reset" && x.code === code && Date.parse(x.expires_at || 0) > Date.now());
                if (!row) {
                    const my = items.find(x => x.purpose === "reset" && x.code === code);
                    if (my) {
                        if (my.used) return errorResponse("你最近重新发送过验证码，旧码已失效，请使用最新邮件中的验证码", 400, null, "CODE_STALE");
                        if (Date.parse(my.expires_at || 0) <= Date.now()) return errorResponse("验证码已过期，请重新获取", 400, null, "CODE_EXPIRED");
                    }
                    const latest = items.find(x => x.purpose === "reset");
                    if (latest && latest.used) return errorResponse("你最近重新发送过验证码，旧码已失效，请使用最新邮件中的验证码", 400, null, "CODE_STALE");
                    return errorResponse("验证码不正确，请核对后重试", 400, null, "CODE_WRONG");
                }
                await pbAdminFetch(env, `/api/collections/email_codes/records/${row.id}`, {
                    method: "PATCH", body: JSON.stringify({ used: true })
                }).catch(() => {});
                // 找到用户并改密
                const uQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${encodeURIComponent(`email='${escapePocketBaseFilterValue(email)}'`)}`);
                const uD = await uQ.json().catch(() => ({}));
                const user = (uD.items || [])[0];
                if (!user) return errorResponse("该邮箱未注册", 400, null, "EMAIL_NOT_FOUND");
                const upd = await pbAdminFetch(env, `/api/collections/users/records/${user.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ password, passwordConfirm: password })
                });
                if (!upd.ok) return errorResponse("密码重置失败，请重试", 500, null, "RESET_FAILED");
                // 自动登录
                const loginRes = await fetch(`${(env.PB_URL || "").replace(/\/$/, "")}/api/collections/users/auth-with-password`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identity: email, password })
                });
                const loginData = await loginRes.json().catch(() => ({}));
                if (!loginData.token) return errorResponse("密码已重置，请重新登录", 200, null, "");
                return new Response(JSON.stringify({ token: loginData.token, record: loginData.record }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- debug：cover KV 内容查看（排查写入问题时用，平时无流量）----
            if (url.pathname === "/api/cover/kvlist") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                try {
                    const res = await env.COVER_CACHE.list({ limit: 1000 });
                    return new Response(JSON.stringify({ count: res.keys.length, keys: res.keys.map(k => k.name) }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                } catch (e) {
                    return new Response(JSON.stringify({ error: String(e).slice(0, 200) }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
            }

            // ---- 路由：AI 封面按需生成（首页展示位；Agnes Image 2.1 Flash 免费 4:3 优先 → SILICONFLOW 512 兜底；非 consume 免登录读缓存 + 内存 3 分钟 + KV 7 天缓存）----
            if (url.pathname === "/api/cover/generate" && request.method === "POST") {
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const prompt = String(body.prompt || "").slice(0, 200).trim();
                if (!prompt) return errorResponse("缺少 prompt", 400, null, "INVALID_PROMPT");
                // consume=true:自建卡付费生成(100 云币);KV(u:{userId}:cv:{prompt})仅为同一用户同提示词防重复扣费(生成成功后前端保存即入卡数据 coverUrl,数据库永久持有)
                const consume = body.consume === true;
                const COVER_COST = 100;
                const now = Date.now();
                // 非 consume(官方卡读取):免登录直接查缓存——KV 预生成封面是公开数据,token 过期/未登录也应能命中(否则首页封面因 401 全空白)
                if (!consume) {
                    const cacheKey = "cv:" + prompt;
                    const hit = coverCache.get(cacheKey);
                    if (hit && now - hit.ts < 180000) {
                        return new Response(JSON.stringify({ image: hit.image }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                    }
                    let kvImage = "";
                    try { kvImage = (await env.COVER_CACHE.get(cacheKey)) || ""; } catch (e) {}
                    if (kvImage) {
                        coverCache.set(cacheKey, { image: kvImage, ts: now });
                        return new Response(JSON.stringify({ image: kvImage }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                    }
                    // 官方卡自动生成通道已关闭(2026-08-26):仅预生成脚本(pregen_cover.mjs 带 X-Cover-Pregen 匹配 COVER_PREGEN_KEY)可生成官方卡封面,
                    // 普通请求(含前端 ensure 读缓存)未命中直接 404 由前端占位,不再免费触发模型调用;自建卡 consume 路径不受影响
                    const isPregen = !!env.COVER_PREGEN_KEY && String(request.headers.get("X-Cover-Pregen") || "") === env.COVER_PREGEN_KEY;
                    if (!isPregen) return errorResponse("封面未预生成", 404, null, "COVER_NOT_READY");
                }
                // 走到生成路径才鉴权:consume(扣币)必须登录;pregen(官方卡未命中补生成)确认操作者
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const cacheKey = consume ? "u:" + auth.record.id + ":cv:" + prompt : "cv:" + prompt;
                const hit = coverCache.get(cacheKey);
                if (hit && now - hit.ts < 180000) {
                    return new Response(JSON.stringify({ image: hit.image }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                // KV 持久缓存(7 天):命中直接返回,省出图额度
                let kvImage = "";
                try { kvImage = (await env.COVER_CACHE.get(cacheKey)) || ""; } catch (e) {}
                if (kvImage) {
                    coverCache.set(cacheKey, { image: kvImage, ts: now });
                    return new Response(JSON.stringify({ image: kvImage }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                const agnesKey = env.AGNES_KEY;
                const sfKey = env.SILICONFLOW_KEY;
                if (!agnesKey && !sfKey) return errorResponse("图像生成服务未配置", 500, null, "IMG_KEY_MISSING");
                // provider:"siliconflow" 强制跳过 Agnes 直接走 SF（预生成脚本避 503 队列满用）
                const forceSF = body.provider === "siliconflow";
                let image = "";
                let genErr = ""; // 诊断透出(Agnes/SF 原始错误),生产响应多一个字段无副作用
                // 1) Agnes 免费模型优先：agnes-image-2.1-flash（官方文档 Token Plan 表列名，wiki.agnes-ai.com），1K + ratio 4:3（1152x864 横版封面）。
                //    实测 b64_json/return_base64 输出路径服务端挂起(>240s 无响应),URL 输出 ~11s 正常 → 出图后下载转 base64(前端 dataURL 永久有效)
                if (agnesKey && !forceSF) {
                    // 503 "text image queue is full" 为临时队列满:等 3s 重试 2 次
                    for (let attempt = 0; attempt < 3 && !image; attempt++) {
                        const ac = new AbortController();
                        const timer = setTimeout(() => ac.abort("agnes timeout"), 90000);
                        try {
                            const r = await fetch("https://apihub.agnes-ai.com/v1/images/generations", {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${agnesKey}` },
                                body: JSON.stringify({ model: "agnes-image-2.1-flash", prompt, size: "1K", ratio: "4:3", extra_body: { response_format: "url" } }),
                                signal: ac.signal
                            });
                            const d = await r.json().catch(() => ({}));
                            const imgUrl = d?.data?.[0]?.url;
                            if (imgUrl) {
                                const dl = new AbortController();
                                const dlTimer = setTimeout(() => dl.abort("download timeout"), 30000);
                                try {
                                    const dlRes = await fetch(imgUrl, { signal: dl.signal });
                                    const buf = await dlRes.arrayBuffer();
                                    const b64 = toBase64(new Uint8Array(buf));
                                    if (b64) image = `data:image/png;base64,${b64}`;
                                } catch (e) { genErr += "agnes download " + String(e).slice(0, 60) + "; "; }
                                clearTimeout(dlTimer);
                            } else {
                                if (r.status === 503 && attempt < 2) { genErr += `agnes queue full retry(${attempt + 1}); `; }
                                else genErr += `agnes status=${r.status} body=${JSON.stringify(d).slice(0, 150)}; `;
                                await new Promise(res => setTimeout(res, 3000));
                            }
                        } catch (e) { genErr += "agnes fetch " + String(e).slice(0, 80) + "; "; }
                        clearTimeout(timer);
                    }
                }
                // 2) SILICONFLOW 降级兜底（Agnes 失败/未配置/空数据，30s 超时）——Kolors 免费文生图模型
                //    实测 SF 返回 {images:[{url:s3临时链接}]} 而非 b64_json → url 分支下载转 base64
                if (!image && sfKey) {
                    const ac = new AbortController();
                    const timer = setTimeout(() => ac.abort("sf timeout"), 30000);
                    try {
                        const r = await fetch("https://api.siliconflow.cn/v1/images/generations", {
                            method: "POST",
                            headers: { "Content-Type": "application/json", "Authorization": `Bearer ${sfKey}` },
                            body: JSON.stringify({ model: "Kwai-Kolors/Kolors", prompt, image_size: "1152x864", batch_size: 1, response_format: "url" }),
                            signal: ac.signal
                        });
                        const d = await r.json().catch(() => ({}));
                        const b64 = d?.images?.[0]?.b64_json || d?.data?.[0]?.b64_json;
                        const imgUrl = d?.images?.[0]?.url || d?.data?.[0]?.url;
                        if (b64) image = `data:image/jpeg;base64,${b64}`;
                        else if (imgUrl) {
                            const dl = new AbortController();
                            const dlTimer = setTimeout(() => dl.abort("sf download timeout"), 30000);
                            try {
                                const dlRes = await fetch(imgUrl, { signal: dl.signal });
                                const buf = await dlRes.arrayBuffer();
                                const b = toBase64(new Uint8Array(buf));
                                if (b) image = `data:image/png;base64,${b}`;
                            } catch (e) { genErr += "sf download " + String(e).slice(0, 60) + "; "; }
                            clearTimeout(dlTimer);
                        } else genErr += `sf status=${r.status} body=${JSON.stringify(d).slice(0, 150)}; `;
                    } catch (e) { genErr += "sf fetch " + String(e).slice(0, 80) + "; "; }
                    clearTimeout(timer);
                }
                if (!image) return errorResponse("图像生成失败", 502, { genErr }, "IMG_GEN_EMPTY");
                // 付费生成:余额校验 + 成功后才扣费(与 token 结算同款 PATCH 原子写)
                if (consume) {
                    const coin = Number(auth.record.coins || 0);
                    if (coin < COVER_COST) return errorResponse(`云币不足（AI 封面需 ${COVER_COST} 云币）`, 402, { coins: coin, cost: COVER_COST }, "INSUFFICIENT_COIN");
                    try {
                        const upd = await pbAdminFetch(env, `/api/collections/users/records/${auth.record.id}`, {
                            method: "PATCH", body: JSON.stringify({ coins: coin - COVER_COST })
                        });
                        if (upd.ok) auth.record.coins = coin - COVER_COST;
                    } catch (e) {}
                }
                coverCache.set(cacheKey, { image, ts: now });
                try {
                    await env.COVER_CACHE.put(cacheKey, image, { expirationTtl: 7 * 24 * 3600 });
                    const back = await env.COVER_CACHE.get(cacheKey);
                    if (back === image) genErr += "kv-readback-OK; ";
                    else genErr += "kv-readback-MISMATCH got=" + String(back || "").length + "; ";
                }
                catch (e) { genErr += "kv put " + String(e).slice(0, 150) + "; "; }
                return new Response(JSON.stringify({ image, cost: consume ? COVER_COST : 0, genErr: genErr || undefined }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：解锁剧本卡（官方卡免费；社区卡按作者定价 unlock_price，0=免费；终身会员免费；幂等）----
            if (url.pathname === "/api/cards/unlock" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                // 幂等：已解锁直接返回成功
                const exFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'`);
                const exQ = await pbAdminFetch(env, `/api/collections/unlocks/records?perPage=1&skipTotal=true&filter=${exFilter}`);
                const exD = await exQ.json().catch(() => ({}));
                if ((exD.items || []).length) {
                    return new Response(JSON.stringify({ unlocked: true, already: true, coins: Number(r.coins || 0) }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                // 官方卡（不在社区集合）→ 免费；社区卡按 unlock_price 扣费
                const commFilter = encodeURIComponent(`id='${escapePocketBaseFilterValue(cardId)}'`);
                const commQ = await pbAdminFetch(env, `/api/collections/community_cards/records?perPage=1&skipTotal=true&filter=${commFilter}`);
                const commD = await commQ.json().catch(() => ({}));
                const commCard = (commD.items || [])[0];
                const price = commCard ? Math.max(0, Number(commCard.unlock_price || 0)) : 0;
                // 本周半价卡（与列表 halfOff 同一判定：付费卡中 play_count 最高）→ 实付半价 ceil(price/2)
                let payPrice = price;
                if (commCard && price > 0) {
                    const weekFilter = encodeURIComponent(`status='approved'&&unlock_price>0`);
                    const wq = await pbAdminFetch(env, `/api/collections/community_cards/records?perPage=1&sort=-play_count&filter=${weekFilter}&fields=id`);
                    const wd = await wq.json().catch(() => ({}));
                    if ((wd.items || [])[0]?.id === cardId) payPrice = Math.ceil(price / 2);
                }
                let coin = Number(r.coins || 0);
                if (!isMember(r) && payPrice > 0) {
                    if (coin < payPrice) {
                        return errorResponse(`云币不足（解锁需 ${payPrice} 云币）`, 402, { coins: coin, cost: payPrice }, "INSUFFICIENT_COIN");
                    }
                    coin -= payPrice;
                    const dedRes = await pbAdminFetch(env, `/api/collections/users/records/${r.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ coins: coin })
                    });
                    if (!dedRes.ok) return errorResponse("扣费失败，请重试", 500, null, "COIN_DEDUCT_FAILED");
                }
                const unlockRes = await pbAdminFetch(env, `/api/collections/unlocks/records`, {
                    method: "POST",
                    body: JSON.stringify({ user_id: r.id, card_id: cardId, created_at: new Date().toISOString() })
                });
                if (!unlockRes.ok) return errorResponse("解锁记录写入失败", 500, null, "UNLOCK_FAILED");
                // 付费社区卡解锁分成：作者（非本人）获得实付价一半（至少 1 币）；免费卡不分成分成
                if (unlockRes.ok && commCard && commCard.author_id && commCard.author_id !== r.id && payPrice > 0) {
                    const aFilter = encodeURIComponent(`id='${escapePocketBaseFilterValue(commCard.author_id)}'`);
                    const aQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${aFilter}`);
                    const aD = await aQ.json().catch(() => ({}));
                    const author = (aD.items || [])[0];
                    if (author) {
                        const reward = Math.max(1, Math.floor(payPrice / 2));
                        await pbAdminFetch(env, `/api/collections/users/records/${author.id}`, {
                            method: "PATCH", body: JSON.stringify({ coins: Number(author.coins || 0) + reward })
                        });
                        await pbAdminFetch(env, `/api/collections/community_cards/records/${commCard.id}`, {
                            method: "PATCH", body: JSON.stringify({ unlock_count: Number(commCard.unlock_count || 0) + 1 })
                        });
                    }
                }
                return new Response(JSON.stringify({ unlocked: true, free: payPrice <= 0, coins: coin }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：用户已解锁卡列表 ----
            if (url.pathname === "/api/cards/unlocked" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const filter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(auth.record.id)}'`);
                const q = await pbAdminFetch(env, `/api/collections/unlocks/records?perPage=200&skipTotal=true&filter=${filter}&fields=card_id`);
                const d = await q.json().catch(() => ({}));
                return new Response(JSON.stringify({ cards: (d.items || []).map(i => i.card_id) }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：云存档槽位解锁（一次性 200 币/槽，按用户×剧本；幂等）----
            if (url.pathname === "/api/saves/unlock" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const slotIndex = Number(body.slot_index);
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                if (![1, 2, 3].includes(slotIndex)) return errorResponse("无效槽位", 400, null, "INVALID_SLOT");
                const lockFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&slot_index=${slotIndex}`);
                const exQ = await pbAdminFetch(env, `/api/collections/cloud_save_unlocks/records?perPage=1&skipTotal=true&filter=${lockFilter}`);
                const exD = await exQ.json().catch(() => ({}));
                if ((exD.items || []).length) {
                    return new Response(JSON.stringify({ unlocked: true, already: true, coins: Number(r.coins || 0) }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                const price = CLOUD_SLOT_PRICE;
                let coin = Number(r.coins || 0);
                if (coin < price) {
                    return errorResponse(`云币不足（解锁需 ${price} 云币）`, 402, { coins: coin, cost: price }, "INSUFFICIENT_COIN");
                }
                coin -= price;
                const dedRes = await pbAdminFetch(env, `/api/collections/users/records/${r.id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ coins: coin })
                });
                if (!dedRes.ok) return errorResponse("扣费失败，请重试", 500, null, "COIN_DEDUCT_FAILED");
                const unlockRes = await pbAdminFetch(env, `/api/collections/cloud_save_unlocks/records`, {
                    method: "POST",
                    body: JSON.stringify({ user_id: r.id, card_id: cardId, slot_index: slotIndex, created_at: new Date().toISOString() })
                });
                if (!unlockRes.ok) return errorResponse("解锁记录写入失败", 500, null, "UNLOCK_FAILED");
                return new Response(JSON.stringify({ unlocked: true, coins: coin }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：角色卡聊天解锁（200 云币/张；终身会员免费；幂等）----
            if (url.pathname === "/api/char-chat/unlocked" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                const cardId = String(url.searchParams.get("cardId") || url.searchParams.get("card_id") || "").trim();
                const npcId = String(url.searchParams.get("npcId") || url.searchParams.get("npc_id") || "").trim();
                if (!cardId || !npcId) return errorResponse("缺少 cardId/npcId", 400, null, "INVALID_PARAM");
                const filter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&npc_id='${escapePocketBaseFilterValue(npcId)}'`);
                const q = await pbAdminFetch(env, `/api/collections/char_chat_unlocks/records?perPage=1&skipTotal=true&filter=${filter}`);
                const d = await q.json().catch(() => ({}));
                return new Response(JSON.stringify({ unlocked: !!((d.items || [])[0]) }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }
            if (url.pathname === "/api/char-chat/unlock" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.cardId || body.card_id || "").trim();
                const npcId = String(body.npcId || body.npc_id || "").trim();
                if (!cardId || !npcId) return errorResponse("缺少 cardId/npcId", 400, null, "INVALID_PARAM");
                const lockFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&npc_id='${escapePocketBaseFilterValue(npcId)}'`);
                const exQ = await pbAdminFetch(env, `/api/collections/char_chat_unlocks/records?perPage=1&skipTotal=true&filter=${lockFilter}`);
                const exD = await exQ.json().catch(() => ({}));
                if ((exD.items || []).length) {
                    return new Response(JSON.stringify({ unlocked: true, already: true, coins: Number(r.coins || 0) }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                const price = CHAR_CHAT_UNLOCK_PRICE;
                let coin = Number(r.coins || 0);
                const free = isMember(r);
                if (!free && coin < price) {
                    return errorResponse(`云币不足（解锁需 ${price} 云币）`, 402, { coins: coin, cost: price }, "INSUFFICIENT_COIN");
                }
                if (!free) {
                    coin -= price;
                    const dedRes = await pbAdminFetch(env, `/api/collections/users/records/${r.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ coins: coin })
                    });
                    if (!dedRes.ok) return errorResponse("扣费失败，请重试", 500, null, "COIN_DEDUCT_FAILED");
                }
                const unlockRes = await pbAdminFetch(env, `/api/collections/char_chat_unlocks/records`, {
                    method: "POST",
                    body: JSON.stringify({ user_id: r.id, card_id: cardId, npc_id: npcId, created_at: new Date().toISOString() })
                });
                if (!unlockRes.ok) return errorResponse("解锁记录写入失败", 500, null, "UNLOCK_FAILED");
                return new Response(JSON.stringify({ unlocked: true, free, coins: coin }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：角色卡聊天记录云存档（仅已解锁者可读写，跟随账户跨设备）----
            if (url.pathname === "/api/char-chat/messages" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                const cardId = String(url.searchParams.get("cardId") || url.searchParams.get("card_id") || "").trim();
                const npcId = String(url.searchParams.get("npcId") || url.searchParams.get("npc_id") || "").trim();
                if (!cardId || !npcId) return errorResponse("缺少 cardId/npcId", 400, null, "INVALID_PARAM");
                const filter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&npc_id='${escapePocketBaseFilterValue(npcId)}'`);
                const q = await pbAdminFetch(env, `/api/collections/person_card_chats_v1/records?perPage=1&skipTotal=true&filter=${filter}&fields=messages`);
                const d = await q.json().catch(() => ({}));
                const rec = (d.items || [])[0];
                let messages = [];
                if (rec) {
                    if (typeof rec.messages === "string") { try { messages = JSON.parse(rec.messages); } catch (e) {} }
                    else if (Array.isArray(rec.messages)) messages = rec.messages;
                }
                return new Response(JSON.stringify({ messages }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }
            if (url.pathname === "/api/char-chat/messages" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.cardId || body.card_id || "").trim();
                const npcId = String(body.npcId || body.npc_id || "").trim();
                const messages = Array.isArray(body.messages) ? body.messages.slice(-100) : [];
                if (!cardId || !npcId) return errorResponse("缺少 cardId/npcId", 400, null, "INVALID_PARAM");
                const msgStr = JSON.stringify(messages);
                if (msgStr.length > 2000000) return errorResponse("聊天记录过大", 400, null, "DATA_TOO_LARGE");
                const lockFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&npc_id='${escapePocketBaseFilterValue(npcId)}'`);
                const lockQ = await pbAdminFetch(env, `/api/collections/char_chat_unlocks/records?perPage=1&skipTotal=true&filter=${lockFilter}`);
                const lockD = await lockQ.json().catch(() => ({}));
                if (!(lockD.items || []).length) return errorResponse("该角色卡未解锁", 403, null, "CHAT_LOCKED");
                const upsFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&npc_id='${escapePocketBaseFilterValue(npcId)}'`);
                const upsQ = await pbAdminFetch(env, `/api/collections/person_card_chats_v1/records?perPage=1&skipTotal=true&filter=${upsFilter}&fields=id`);
                const upsD = await upsQ.json().catch(() => ({}));
                const existing = (upsD.items || [])[0];
                let res;
                if (existing) {
                    res = await pbAdminFetch(env, `/api/collections/person_card_chats_v1/records/${existing.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ messages: msgStr, updated_at: new Date().toISOString() })
                    });
                } else {
                    res = await pbAdminFetch(env, `/api/collections/person_card_chats_v1/records`, {
                        method: "POST",
                        body: JSON.stringify({ user_id: r.id, card_id: cardId, npc_id: npcId, messages: msgStr, created_at: new Date().toISOString() })
                    });
                }
                if (!res.ok) return errorResponse("聊天记录保存失败", 500, null, "CHAT_SAVE_FAILED");
                return new Response(JSON.stringify({ ok: true, count: messages.length }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：云存档 写入（data="__DELETE__" 表示删除该槽）----
            if (url.pathname === "/api/saves" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const slotIndex = Number(body.slot_index);
                const data = typeof body.data === "string" ? body.data : "";
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                if (![1, 2, 3].includes(slotIndex)) return errorResponse("无效槽位", 400, null, "INVALID_SLOT");
                if (data.length > 2000000) return errorResponse("存档数据过大", 400, null, "DATA_TOO_LARGE");
                const lockFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&slot_index=${slotIndex}`);
                const lockQ = await pbAdminFetch(env, `/api/collections/cloud_save_unlocks/records?perPage=1&skipTotal=true&filter=${lockFilter}`);
                const lockD = await lockQ.json().catch(() => ({}));
                if (!(lockD.items || []).length) return errorResponse("该槽位未解锁", 403, null, "SLOT_LOCKED");
                const upsFilter = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&slot_index=${slotIndex}`);
                const upsQ = await pbAdminFetch(env, `/api/collections/cloud_saves/records?perPage=1&skipTotal=true&filter=${upsFilter}&fields=id`);
                const upsD = await upsQ.json().catch(() => ({}));
                const existing = (upsD.items || [])[0];
                if (data === "__DELETE__") {
                    if (existing) await pbAdminFetch(env, `/api/collections/cloud_saves/records/${existing.id}`, { method: "DELETE" });
                    return new Response(JSON.stringify({ ok: true, deleted: true }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                if (!data) return errorResponse("存档数据为空", 400, null, "EMPTY_DATA");
                let res;
                if (existing) {
                    res = await pbAdminFetch(env, `/api/collections/cloud_saves/records/${existing.id}`, {
                        method: "PATCH",
                        body: JSON.stringify({ data })
                    });
                } else {
                    res = await pbAdminFetch(env, `/api/collections/cloud_saves/records`, {
                        method: "POST",
                        body: JSON.stringify({ user_id: r.id, card_id: cardId, slot_index: slotIndex, data, created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                    });
                }
                if (!res.ok) return errorResponse("云端保存失败", 500, null, "SAVE_FAILED");
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：云存档 读取（含解锁状态 + 余额）----
            if (url.pathname === "/api/saves" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const r = auth.record;
                const cardId = String(url.searchParams.get("card_id") || "").trim();
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(r.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'`);
                const [sQ, uQ] = await Promise.all([
                    pbAdminFetch(env, `/api/collections/cloud_saves/records?perPage=10&skipTotal=true&filter=${f}&sort=slot_index`),
                    pbAdminFetch(env, `/api/collections/cloud_save_unlocks/records?perPage=10&skipTotal=true&filter=${f}&sort=slot_index`)
                ]);
                const sD = await sQ.json().catch(() => ({}));
                const uD = await uQ.json().catch(() => ({}));
                const slots = {};
                (sD.items || []).forEach((i) => { slots[Number(i.slot_index)] = { data: i.data, updated_at: i.updated_at }; });
                const unlocks = {};
                (uD.items || []).forEach((i) => { unlocks[Number(i.slot_index)] = true; });
                return new Response(JSON.stringify({ card_id: cardId, unlocks, slots, coins: Number(r.coins || 0) }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：聚合登录(QQ/微信) ①获取跳转地址 ----
            if (url.pathname === "/api/social/login" && request.method === "GET") {
                const type = String(url.searchParams.get("type") || "").toLowerCase();
                if (!["qq", "wx"].includes(type)) return errorResponse("不支持的登录方式", 400, null, "INVALID_SOCIAL_TYPE");
                const appid = env.MAPAY_APPID || "";
                const appkey = env.MAPAY_APPKEY || "";
                if (!appid || !appkey) return errorResponse("第三方登录暂未开通", 503, null, "SOCIAL_NOT_CONFIGURED");
                // 页面托管在 GitHub Pages(bitlife.blupure.cn),API worker 在 ai.blupure.cn:
                // redirect_uri 必须固定为页面域名(mapay 回调白名单只认它),不能用请求自身 host
                const redirectUri = "https://bitlife.blupure.cn/?social_cb=1";
                const q = new URLSearchParams({ act: "login", appid, appkey, type, redirect_uri: redirectUri });
                const res = await fetch(`${env.MAPAY_API_URL || "https://login.mapay.cn"}/connect.php?${q}`);
                const data = await res.json().catch(() => null);
                if (!data || data.code !== 0) return errorResponse(data?.msg || "获取登录地址失败", 502, null, "SOCIAL_LOGIN_FAILED");
                return new Response(JSON.stringify({ url: data.url }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：聚合登录 ②授权回调换 token（appkey 仅服务端使用）----
            if (url.pathname === "/api/social/login" && request.method === "POST") {
                const appid = env.MAPAY_APPID || "";
                const appkey = env.MAPAY_APPKEY || "";
                if (!appid || !appkey) return errorResponse("第三方登录暂未开通", 503, null, "SOCIAL_NOT_CONFIGURED");
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const type = String(body.type || "").toLowerCase();
                const code = String(body.code || "").trim();
                if (!["qq", "wx"].includes(type)) return errorResponse("不支持的登录方式", 400, null, "INVALID_SOCIAL_TYPE");
                if (!code) return errorResponse("缺少授权码", 400, null, "INVALID_SOCIAL_CODE");
                const q = new URLSearchParams({ act: "callback", appid, appkey, type, code });
                const res = await fetch(`${env.MAPAY_API_URL || "https://login.mapay.cn"}/connect.php?${q}`);
                const data = await res.json().catch(() => null);
                if (!data || data.code !== 0) return errorResponse(data?.msg || "登录失败，请重试", 502, null, "SOCIAL_CALLBACK_FAILED");
                const uid = String(data.social_uid || "").trim();
                if (!uid) return errorResponse("未获取到第三方身份", 502, null, "SOCIAL_UID_MISSING");
                // 昵称/头像多字段容错:微信回调字段名(headimgurl/name)与 mapay 标准字段(faceimg/nickname)不一致
                const socialName = String(data.nickname || data.name || "").trim().slice(0, 30);
                const socialFace = String(data.faceimg || data.headimgurl || data.avatar || "").trim().slice(0, 500);
                const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
                // 查已有绑定(自动建号账号,首登后复用)
                const filter = encodeURIComponent(`social_uid='${escapePocketBaseFilterValue(uid)}'`);
                const q2 = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${filter}`);
                const d2 = await q2.json().catch(() => ({}));
                let user = (d2.items || [])[0];
                let password = "";
                // 规范用户名: s_{type}_{uid净化} (pattern ^[a-zA-Z0-9_-]+$, 截断30)
                const cleanUid = uid.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24);
                const username = `s_${type}_${cleanUid || Math.random().toString(36).slice(2, 8)}`;
                if (!user) {
                    // 自动建号:内部邮箱+随机密码(存 social_pwd 供后续 auth-with-password 签发 token)
                    const email = `social_${cleanUid}@social.mapay`;
                    let s = "";
                    for (let i = 0; i < 16; i++) s += "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)];
                    password = s;
                    const createRes = await pbAdminFetch(env, `/api/collections/users/records`, {
                        method: "POST",
                        body: JSON.stringify({
                            email, username, password, passwordConfirm: password, emailVisibility: false,
                            social_uid: uid, social_pwd: password,
                            nickname: socialName,
                            faceimg: socialFace
                        })
                    });
                    if (!createRes.ok) return errorResponse("账号创建失败，请重试", 500, null, "SOCIAL_CREATE_FAILED");
                    const created = await createRes.json().catch(() => ({}));
                    user = created;
                } else {
                    password = String(user.social_pwd || "");
                    const patch = {};
                    if (socialName || socialFace) {
                        patch.nickname = socialName;
                        patch.faceimg = socialFace;
                    }
                    // 存量社交用户无 username, 首次回来时补齐(条件唯一索引兼容空值)
                    if (!user.username) patch.username = username;
                    if (Object.keys(patch).length) {
                        await pbAdminFetch(env, `/api/collections/users/records/${user.id}`, {
                            method: "PATCH", body: JSON.stringify(patch)
                        }).catch(() => {});
                    }
                }
                if (!password) return errorResponse("账号异常，请联系管理员", 500, null, "SOCIAL_ACCOUNT_BROKEN");
                const loginRes = await fetch(`${pbUrl}/api/collections/users/auth-with-password`, {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ identity: user.email, password })
                });
                const loginData = await loginRes.json().catch(() => ({}));
                if (!loginRes.ok || !loginData.token) return errorResponse("登录失败，请重试", 502, null, "SOCIAL_TOKEN_FAILED");
                return new Response(JSON.stringify({ token: loginData.token, record: loginData.record }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：社区卡上传（status=pending 待审核）----
            if (url.pathname === "/api/cards/community" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const title = String(body.title || "").trim();
                const data = body.data;
                if (!title || !data || typeof data !== "object") return errorResponse("缺少标题或卡数据", 400, null, "INVALID_COMMUNITY_CARD");
                const record = {
                    title: title.slice(0, 60),
                    category: String(body.category || "").slice(0, 20),
                    theme: String(body.theme || "").slice(0, 20),
                    data,
                    author_id: auth.record.id,
                    status: "pending",
                    unlock_price: Math.max(0, Math.min(500, Number(body.unlock_price) || 0)),
                    play_count: 0,
                    earned_plays: 0,
                    unlock_count: 0,
                    daily_plays: {},
                    created_at: new Date().toISOString()
                };
                const createRes = await pbAdminFetch(env, `/api/collections/community_cards/records`, {
                    method: "POST", body: JSON.stringify(record)
                });
                if (!createRes.ok) return errorResponse("上传失败", 500, null, "COMMUNITY_UPLOAD_FAILED");
                const created = await createRes.json().catch(() => ({}));
                return new Response(JSON.stringify({ id: created.id, status: "pending" }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：社区卡列表/详情/我的（GET）----
            if (url.pathname === "/api/cards/community" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const cardId = url.searchParams.get("id") || "";
                const mine = url.searchParams.get("mine") === "1";
                if (cardId) {
                    // 详情（下载）：非本人下载计入 play_count
                    const q = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                    if (!q.ok) return errorResponse("社区卡不存在", 404, null, "COMMUNITY_CARD_NOT_FOUND");
                    const card = await q.json().catch(() => ({}));
                    const status = Array.isArray(card.status) ? card.status[0] : card.status;
                    if (status !== "approved" && card.author_id !== auth.record.id) {
                        return errorResponse("社区卡不可见", 404, null, "COMMUNITY_CARD_NOT_FOUND");
                    }
                    if (card.author_id !== auth.record.id) {
                        await pbAdminFetch(env, `/api/collections/community_cards/records/${card.id}`, {
                            method: "PATCH", body: JSON.stringify({ play_count: Number(card.play_count || 0) + 1 })
                        });
                    }
                    const author = await pbGetUser(env, card.author_id);
                    return new Response(JSON.stringify({ ...card, data: card.data, author_name: author.nickname || "" }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                const filter = mine
                    ? encodeURIComponent(`author_id='${escapePocketBaseFilterValue(auth.record.id)}'`)
                    : encodeURIComponent(`status='approved'`);
                // 发现页最热榜按 play_count 倒序;缺省保持 -created 向后兼容
                const sort = url.searchParams.get("sort") === "play_count" ? "-play_count" : "-created";
                const q = await pbAdminFetch(env, `/api/collections/community_cards/records?perPage=200&sort=${sort}&filter=${filter}`);
                const d = await q.json().catch(() => ({}));
                // 本周半价卡：play_count 最高的付费卡（unlock_price>0），仅社区广场列表标记
                let halfOffId = "";
                if (!mine) {
                    const weekFilter = encodeURIComponent(`status='approved'&&unlock_price>0`);
                    const wq = await pbAdminFetch(env, `/api/collections/community_cards/records?perPage=1&sort=-play_count&filter=${weekFilter}&fields=id`);
                    const wd = await wq.json().catch(() => ({}));
                    halfOffId = (wd.items || [])[0]?.id || "";
                }
                const items = (d.items || []).map(c => {
                    const status = Array.isArray(c.status) ? c.status[0] : c.status;
                    return {
                        id: c.id, title: c.title, category: c.category, theme: c.theme,
                        author_id: c.author_id, status,
                        unlock_price: Number(c.unlock_price || 0),
                        halfOff: c.id === halfOffId,
                        play_count: Number(c.play_count || 0),
                        earned_plays: Number(c.earned_plays || 0),
                        unlock_count: Number(c.unlock_count || 0),
                        created_at: c.created_at
                    };
                });
                await attachAuthorNames(env, items);
                return new Response(JSON.stringify({ items }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：游玩计佣（社区卡作者 30 币/轮，防刷单卡单用户每日 10 轮）----
            if (url.pathname === "/api/play/report" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                const q = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                const d = await q.json().catch(() => ({}));
                if (!q.ok || !d.id) {
                    // 官方卡/本地未上传卡：不计佣；官方卡游玩数入库(card_plays, 详情页聚合展示)
                    await pbAdminFetch(env, `/api/collections/card_plays/records`, {
                        method: "POST",
                        body: JSON.stringify({ card_id: cardId, user_id: auth.record.id, created_at: new Date().toISOString() })
                    }).catch(() => {});
                    // M6b:语言卡(lang_cards)命中则累计 play_count,便于上架后看数据
                    try {
                        const lq = await pbAdminFetch(env, `/api/collections/lang_cards/records/${encodeURIComponent(cardId)}`);
                        const ld = await lq.json().catch(() => ({}));
                        if (ld && ld.id) {
                            await pbAdminFetch(env, `/api/collections/lang_cards/records/${ld.id}`, {
                                method: "PATCH", body: JSON.stringify({ play_count: Number(ld.play_count || 0) + 1 })
                            });
                            if (langCardsCache.data) langCardsCache = { t: 0, data: null }; // 计数刷新后失效缓存
                        }
                    } catch (e) {}
                    return new Response(JSON.stringify({ ok: true, rewarded: false }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                if (!d.author_id || d.author_id === auth.record.id) {
                    return new Response(JSON.stringify({ ok: true, rewarded: false, self: true }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                const today = new Date(Date.now() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
                let daily = {};
                try { daily = (typeof d.daily_plays === "object" && d.daily_plays) ? d.daily_plays : JSON.parse(d.daily_plays || "{}"); } catch (e) { daily = {}; }
                const todayCount = Number(daily[today] || 0);
                const patched = { play_count: Number(d.play_count || 0) + 1 };
                if (todayCount < COMMUNITY_DAILY_PLAY_LIMIT) {
                    daily[today] = todayCount + 1;
                    patched.daily_plays = daily;
                    patched.earned_plays = Number(d.earned_plays || 0) + 1;
                    const aFilter = encodeURIComponent(`id='${escapePocketBaseFilterValue(d.author_id)}'`);
                    const aQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=1&skipTotal=true&filter=${aFilter}`);
                    const aD = await aQ.json().catch(() => ({}));
                    const author = (aD.items || [])[0];
                    if (author) {
                        await pbAdminFetch(env, `/api/collections/users/records/${author.id}`, {
                            method: "PATCH", body: JSON.stringify({ coins: Number(author.coins || 0) + COMMUNITY_REWARD_PER_PLAY })
                        });
                    }
                }
                await pbAdminFetch(env, `/api/collections/community_cards/records/${d.id}`, {
                    method: "PATCH", body: JSON.stringify(patched)
                });
                return new Response(JSON.stringify({ ok: true, rewarded: todayCount < COMMUNITY_DAILY_PLAY_LIMIT }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：社区动态流 feed（GET，含作者/引用卡/点赞状态/前2条评论）----
            if (url.pathname === "/api/feed" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const perPage = Math.min(Math.max(Number(url.searchParams.get("perPage") || 20), 1), 50);
                const page = Math.max(1, Number(url.searchParams.get("page") || 1));
                const q = await pbAdminFetch(env, `/api/collections/posts/records?perPage=${perPage}&page=${page}&sort=-created`);
                const d = await q.json().catch(() => ({}));
                const postItems = d.items || [];
                const meId = auth.record.id;
                // feed 装配改为批量 join:CF 单次调用子请求上限 50,逐帖 join 在 perPage≥10 时直接 500
                const postIds = postItems.map(p => p.id).filter(Boolean);
                const cardIds = [...new Set(postItems.map(p => (p.card_id || "").trim()).filter(Boolean))];
                const postsAuthorIds = [...new Set(postItems.map(p => (p.author_id || "").trim()).filter(Boolean))];
                const allAuthorIds = new Set(postsAuthorIds);
                const orChain = (ids, field) => [...ids].map(id => `${field}='${escapePocketBaseFilterValue(id)}'`).join("||");

                const usersMap = {};
                const commentsMap = new Map();
                const likedByMeSet = new Set();
                const followingSet = new Set();
                const cardMap = {};
                const usersLoadedIds = new Set();

                // 按 id 批量拉记录(60 个/块防 URL 超长),返回行数组
                const batchFetch = async (coll, field, ids, fields) => {
                    const out = [];
                    for (let i = 0; i < ids.length; i += 60) {
                        const chunk = ids.slice(i, i + 60);
                        const url = `/api/collections/${coll}/records?perPage=200&skipTotal=true&fields=${fields}&filter=${encodeURIComponent(orChain(chunk, field))}`;
                        const r = await pbAdminFetch(env, url);
                        const rd = await r.json().catch(() => ({}));
                        out.push(...(rd.items || []));
                    }
                    return out;
                };
                // 增量拉用户:后续并入的评论作者也补齐,已请求过的 id 不重复拉
                const loadUsers = async () => {
                    const pending = [...allAuthorIds].filter(id => !usersLoadedIds.has(id));
                    if (!pending.length) return;
                    for (const id of pending) usersLoadedIds.add(id);
                    const us = await batchFetch("users", "id", pending, "id,nickname,faceimg");
                    for (const u of us) usersMap[u.id] = u;
                };
                await loadUsers();
                if (postIds.length) {
                    // 评论:全页帖子一次拉回,按帖取时间升序前 2;评论作者并入用户集合
                    const cms = await batchFetch("post_comments", "post_id", postIds, "id,post_id,user_id,content,created_at");
                    cms.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
                    for (const cm of cms) {
                        const list = commentsMap.get(cm.post_id) || [];
                        if (list.length < 2) {
                            list.push(cm);
                            commentsMap.set(cm.post_id, list);
                            if (cm.user_id) allAuthorIds.add(cm.user_id);
                        }
                    }
                    await loadUsers();
                    // 我赞过的本页帖子
                    if (meId) {
                        const lUrl = `/api/collections/post_likes/records?perPage=200&skipTotal=true&fields=post_id&filter=${encodeURIComponent(`user_id='${escapePocketBaseFilterValue(meId)}'&&(${orChain(postIds, "post_id")})`)}`;
                        const lr = await pbAdminFetch(env, lUrl);
                        const lrd = await lr.json().catch(() => ({}));
                        for (const x of (lrd.items || [])) likedByMeSet.add(x.post_id);
                        // 我关注了哪些帖子作者(仅统计帖作者,不含评论作者)
                        const authorIds = postsAuthorIds.filter(id => id !== meId);
                        if (authorIds.length) {
                            const fUrl = `/api/collections/follows/records?perPage=200&skipTotal=true&fields=user_id&filter=${encodeURIComponent(`follower_id='${escapePocketBaseFilterValue(meId)}'&&(${orChain(authorIds, "user_id")})`)}`;
                            const fr = await pbAdminFetch(env, fUrl);
                            const frd = await fr.json().catch(() => ({}));
                            for (const x of (frd.items || [])) followingSet.add(x.user_id);
                        }
                    }
                }
                if (cardIds.length) {
                    const cards = await batchFetch("community_cards", "id", cardIds, "id,title");
                    for (const c of cards) cardMap[c.id] = String(c.title || "");
                }
                const items = postItems.map(p => {
                    const u = usersMap[p.author_id] || {};
                    const comments = (commentsMap.get(p.id) || []).map(cm => {
                        const cu = usersMap[cm.user_id] || {};
                        return { id: cm.id, content: cm.content, created_at: cm.created_at, author: { id: cm.user_id, nickname: cu.nickname || "", faceimg: cu.faceimg || "" } };
                    });
                    return {
                        id: p.id,
                        content: String(p.content || ""),
                        card_id: p.card_id || "",
                        card_title: cardMap[p.card_id] || "",
                        image_data: String(p.image_data || ""),
                        author: u.id ? { id: u.id, nickname: u.nickname || "", faceimg: u.faceimg || "" } : { id: p.author_id },
                        following: !!u.id && u.id !== meId && followingSet.has(u.id),
                        likes_count: Number(p.likes_count || 0),
                        comments_count: Number(p.comments_count || 0),
                        liked_by_me: likedByMeSet.has(p.id),
                        comments,
                        created_at: p.created_at
                    };
                });
                return new Response(JSON.stringify({ items, total: d.totalItems || 0 }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

const CAT_OF = {"la_01":"恋爱","la_02":"恋爱","la_03":"恋爱","la_04":"恋爱","la_05":"恋爱","abo_01":"ABO","abo_02":"ABO","abo_03":"ABO","abo_04":"ABO","abo_05":"ABO","yin_01":"乙女","yin_02":"乙女","yin_03":"乙女","yin_04":"乙女","yin_05":"乙女","zc_01":"职场","zc_02":"职场","zc_03":"职场","zc_04":"职场","zc_05":"职场","xx_01":"修仙","xx_02":"修仙","xx_03":"修仙","xx_04":"修仙","xx_05":"修仙","cy_01":"穿越","cy_02":"穿越","cy_03":"穿越","cy_04":"穿越","cy_05":"穿越","ds_01":"都市","ds_02":"都市","ds_03":"都市","ds_04":"都市","ds_05":"都市","wxl_01":"无限流","wxl_02":"无限流","wxl_03":"无限流","wxl_04":"无限流","wxl_05":"无限流","ms_01":"末世","ms_02":"末世","ms_03":"末世","ms_04":"末世","ms_05":"末世","jy_01":"经营","jy_02":"经营","jy_03":"经营","jy_04":"经营","jy_05":"经营","kh_01":"科幻","kh_02":"科幻","kh_03":"科幻","kh_04":"科幻","kh_05":"科幻","xy_01":"悬疑","xy_02":"悬疑","xy_03":"悬疑","xy_04":"悬疑","xy_05":"悬疑","pt_01":"跑团","pt_02":"跑团","pt_03":"跑团","pt_04":"跑团","pt_05":"跑团","qh_01":"奇幻","qh_02":"奇幻","qh_03":"奇幻","qh_04":"奇幻","qh_05":"奇幻","ls_01":"历史","ls_02":"历史","ls_03":"历史","ls_04":"历史","ls_05":"历史","gd_01":"宫斗","gd_02":"宫斗","gd_03":"宫斗","gd_04":"宫斗","gd_05":"宫斗","zt_01":"种田","zt_02":"种田","zt_03":"种田","zt_04":"种田","zt_05":"种田","nz_01":"女尊","nz_02":"女尊","nz_03":"女尊","nz_04":"女尊","nz_05":"女尊","xyx_01":"校园","xyx_02":"校园","xyx_03":"校园","xyx_04":"校园","xyx_05":"校园","yl_01":"娱乐圈","yl_02":"娱乐圈","yl_03":"娱乐圈","yl_04":"娱乐圈","yl_05":"娱乐圈","rw_01":"人外","rw_02":"人外","rw_03":"人外","rw_04":"人外","rw_05":"人外","tr_01":"同人","tr_02":"同人","tr_03":"同人","tr_04":"同人","tr_05":"同人","zb_01":"主播","zb_02":"主播","zb_03":"主播","zb_04":"主播","zb_05":"主播"};

            // ---- 路由：官方卡历史热度榜（轮播动态展示，GET /api/game/hot?limit=7；匿名可用）----
            if (url.pathname === "/api/game/hot" && request.method === "GET") {
                const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 7), 1), 20);
                const filter = encodeURIComponent(`card_id~'scenario_preset'`);
                const counts = new Map();
                let page = 1;
                while (page <= 50) {
                    const q = await pbAdminFetch(env, `/api/collections/card_plays/records?perPage=200&page=${page}&fields=card_id,created&filter=${filter}`);
                    const d = await q.json().catch(() => ({}));
                    const items = d.items || [];
                    items.forEach((r) => { const k = String(r.card_id || ""); if (k) counts.set(k, (counts.get(k) || 0) + 1); });
                    if (items.length < 200) break;
                    page++;
                }
                const top = [...counts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, limit)
                    .map(([id, plays]) => ({ id, plays, category: CAT_OF[String(id).replace(/^scenario_preset_/, "")] || "" }));
                return new Response(JSON.stringify(top), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：作品详情聚合（热度/作者/打赏榜/角色人气，GET /api/game/detail?id=）----
            if (url.pathname === "/api/game/detail" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const cardId = url.searchParams.get("id") || "";
                if (!cardId) return errorResponse("缺少 id", 400, null, "INVALID_CARD");
                const q = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                let card = null;
                if (q.ok) card = await q.json().catch(() => ({}));
                if (!card || !card.id) {
                    // 官方卡（平台预制，不在 community_cards）: 计数走 card_plays/card_likes/card_collects 通用集合
                    card = { id: cardId, title: "官方卡", author_id: "" };
                } else {
                    const status = Array.isArray(card.status) ? card.status[0] : card.status;
                    if (status !== "approved" && card.author_id !== auth.record.id) {
                        return errorResponse("作品不可见", 404, null, "CARD_NOT_FOUND");
                    }
                }
                let author = { id: card.author_id || "" };
                if (card.author_id) {
                    const aQ = await pbAdminFetch(env, `/api/collections/users/records/${encodeURIComponent(card.author_id)}`);
                    const aD = await aQ.json().catch(() => ({}));
                    if (aD && aD.id) author = { id: aD.id, nickname: aD.nickname || "", faceimg: aD.faceimg || "" };
                }
                const cardFilter = `card_id='${escapePocketBaseFilterValue(cardId)}'`;
                // 游玩数: 官方卡从 card_plays 聚合, 社区卡读卡字段
                let playCount = Number(card.play_count || 0);
                if (!card.author_id) {
                    const pQ = await pbAdminFetch(env, `/api/collections/card_plays/records?perPage=1&filter=${encodeURIComponent(cardFilter)}`);
                    const pD = await pQ.json().catch(() => ({}));
                    playCount = Number(pD.totalItems || 0);
                }
                // 点赞/收藏计数（perPage=1 + totalItems 拿总数，不落卡字段，PB schema 无需改动）
                const lQ = await pbAdminFetch(env, `/api/collections/card_likes/records?perPage=1&filter=${encodeURIComponent(cardFilter)}`);
                const lD = await lQ.json().catch(() => ({}));
                const likesCount = Number(lD.totalItems || 0);
                const lMy = await pbAdminFetch(env, `/api/collections/card_likes/records?perPage=1&skipTotal=true&filter=${encodeURIComponent(`${cardFilter}&&user_id='${escapePocketBaseFilterValue(auth.record.id)}'`)}`);
                const lMyD = await lMy.json().catch(() => ({}));
                const likedByMe = (lMyD.items || []).length > 0;
                const cQ = await pbAdminFetch(env, `/api/collections/card_collects/records?perPage=1&filter=${encodeURIComponent(cardFilter)}`);
                const cD = await cQ.json().catch(() => ({}));
                const collectsCount = Number(cD.totalItems || 0);
                const cMy = await pbAdminFetch(env, `/api/collections/card_collects/records?perPage=1&skipTotal=true&filter=${encodeURIComponent(`${cardFilter}&&user_id='${escapePocketBaseFilterValue(auth.record.id)}'`)}`);
                const cMyD = await cMy.json().catch(() => ({}));
                const collectedByMe = (cMyD.items || []).length > 0;
                // 打赏榜（按用户聚合 sum(amount)，role_id 为空的是打赏）/ 角色人气（role_id 非空=送笔芯，计数）
                const dQ = await pbAdminFetch(env, `/api/collections/donations/records?perPage=200&sort=-created&filter=${encodeURIComponent(cardFilter)}`);
                const dD = await dQ.json().catch(() => ({}));
                const dItems = dD.items || [];
                const byUser = new Map();
                const roleHot = {};
                for (const d of dItems) {
                    const amt = Number(d.amount || 0);
                    if (d.role_id) {
                        // 批9.12：与前端 roleIdOf 同款清洗，杜绝同角色多 key 计数错位
                        const rid = roleIdOf({ id: d.role_id });
                        roleHot[rid] = Number(roleHot[rid] || 0) + 1;
                    } else {
                        const u = byUser.get(d.user_id) || { user_id: d.user_id, amount: 0 };
                        u.amount += amt;
                        byUser.set(d.user_id, u);
                    }
                }
                const topDonors = [...byUser.values()].sort((a, b) => b.amount - a.amount).slice(0, 20);
                const donors = await Promise.all(topDonors.map(async (u) => {
                    let userInfo = { id: u.user_id || "" };
                    if (u.user_id) {
                        const uQ = await pbAdminFetch(env, `/api/collections/users/records/${encodeURIComponent(u.user_id)}`);
                        const uD = await uQ.json().catch(() => ({}));
                        if (uD && uD.id) userInfo = { id: uD.id, nickname: uD.nickname || "", faceimg: uD.faceimg || "" };
                    }
                    return { amount: u.amount, user: userInfo };
                }));
                return new Response(JSON.stringify({
                    id: card.id, title: card.title, category: card.category || "", theme: card.theme || "",
                    play_count: playCount, created_at: card.created_at || "",
                    author, likes_count: likesCount, liked_by_me: likedByMe,
                    collects_count: collectsCount, collected_by_me: collectedByMe,
                    donors, role_hot: roleHot,
                    data: card.data || null
                }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：作品点赞/收藏（POST /api/game/like | /api/game/collect，5 秒限 1 次）----
            async function toggleCardMark(env, auth, body, collection) {
                const cardId = String(body.card_id || "").trim();
                const on = body.value !== false;
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                const now = Date.now();
                if (now - (postRateMap.get(collection + ":" + auth.record.id) || 0) < LIKE_RATE_LIMIT_MS) {
                    return errorResponse("操作太频繁，请稍后再试", 429, null, "TOO_FREQUENT");
                }
                postRateMap.set(collection + ":" + auth.record.id, now);
                // 官方卡不在 community_cards(404 放行, 计数走通用集合), 社区卡直接按 card_id 标记
                const filter = encodeURIComponent(`card_id='${escapePocketBaseFilterValue(cardId)}'&&user_id='${escapePocketBaseFilterValue(auth.record.id)}'`);
                const fQ = await pbAdminFetch(env, `/api/collections/${collection}/records?perPage=1&skipTotal=true&filter=${filter}`);
                const fD = await fQ.json().catch(() => ({}));
                const existing = (fD.items || [])[0];
                if (on && !existing) {
                    await pbAdminFetch(env, `/api/collections/${collection}/records`, {
                        method: "POST",
                        body: JSON.stringify({ card_id: cardId, user_id: auth.record.id, created_at: new Date().toISOString() })
                    });
                } else if (!on && existing) {
                    await pbAdminFetch(env, `/api/collections/${collection}/records/${existing.id}`, { method: "DELETE" });
                }
                const tQ = await pbAdminFetch(env, `/api/collections/${collection}/records?perPage=1&filter=${encodeURIComponent(`card_id='${escapePocketBaseFilterValue(cardId)}'`)}`);
                const tD = await tQ.json().catch(() => ({}));
                return new Response(JSON.stringify({ ok: true, count: Number(tD.totalItems || 0) }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }
            if (url.pathname === "/api/game/like" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                return toggleCardMark(env, auth, body, "card_likes");
            }
            if (url.pathname === "/api/game/collect" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                return toggleCardMark(env, auth, body, "card_collects");
            }
            // ---- 路由：我的点赞/收藏 id 列表（GET /api/game/my-marks）----
            if (url.pathname === "/api/game/my-marks" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(auth.record.id)}'`);
                const [cQ, lQ] = await Promise.all([
                    pbAdminFetch(env, `/api/collections/card_collects/records?perPage=200&skipTotal=true&filter=${f}&fields=card_id`),
                    pbAdminFetch(env, `/api/collections/card_likes/records?perPage=200&skipTotal=true&filter=${f}&fields=card_id`)
                ]);
                const cd = await cQ.json().catch(() => ({}));
                const ld = await lQ.json().catch(() => ({}));
                return new Response(JSON.stringify({
                    collects: (cd.items || []).map(x => x.card_id),
                    likes: (ld.items || []).map(x => x.card_id)
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：打赏作者（POST /api/game/donate；档位 1/5/10 云币直入作者账户，每日同作者限 1 次）----
            if (url.pathname === "/api/game/donate" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const roleId = String(body.role_id || "").trim();
                let amount = Number(body.amount || 0);
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                if (roleId) return errorResponse("角色点赞请走 /api/characters/like", 400, null, "USE_LIKE_ENDPOINT");
                if (![1, 5, 10].includes(amount)) {
                    return errorResponse("打赏档位仅支持 1/5/10 云币", 400, null, "INVALID_AMOUNT");
                }
                const now = Date.now();
                if (now - (postRateMap.get("donate:" + auth.record.id) || 0) < DONATE_RATE_LIMIT_MS) {
                    return errorResponse("操作太频繁，请稍后再试", 429, null, "TOO_FREQUENT");
                }
                postRateMap.set("donate:" + auth.record.id, now);
                const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                let card = null;
                if (cQ.ok) card = await cQ.json().catch(() => ({}));
                if (!card || !card.id) {
                    // 官方卡无作者可收，不支持打赏（爱心点赞走 /api/characters/like）
                    return errorResponse("官方作品暂不支持打赏，可在详情页点赞支持喜欢的角色", 400, null, "OFFICIAL_NO_DONATE");
                } else if (card.author_id === auth.record.id) {
                    return errorResponse("不能给自己的作品打赏", 400, null, "SELF_DONATE");
                }
                // 批9.12：每日同一用户对同一作者限 1 次（author_id 维度）
                const today = getTodayStr();
                const dupQ = await pbAdminFetch(env, `/api/collections/donations/records?perPage=1&filter=${encodeURIComponent(`user_id='${escapePocketBaseFilterValue(auth.record.id)}'&&author_id='${escapePocketBaseFilterValue(card.author_id)}'&&created>='${today} 00:00:00'`)}`);
                const dupD = await dupQ.json().catch(() => ({}));
                if ((dupD.items || []).length > 0) {
                    return errorResponse("今天已打赏过该作者，明天再来吧", 429, null, "DAILY_DONATE_LIMIT");
                }
                const myCoins = Number(auth.record.coins || 0);
                if (myCoins < amount) return errorResponse("云币不足，请先充值", 402, null, "INSUFFICIENT_COINS");
                await pbAdminFetch(env, `/api/collections/users/records/${auth.record.id}`, {
                    method: "PATCH", body: JSON.stringify({ coins: myCoins - amount })
                });
                const aQ = await pbAdminFetch(env, `/api/collections/users/records/${encodeURIComponent(card.author_id)}`);
                const aD = await aQ.json().catch(() => ({}));
                if (aD && aD.id) {
                    await pbAdminFetch(env, `/api/collections/users/records/${aD.id}`, {
                        method: "PATCH", body: JSON.stringify({ coins: Number(aD.coins || 0) + amount })
                    });
                }
                await pbAdminFetch(env, `/api/collections/donations/records`, {
                    method: "POST",
                    body: JSON.stringify({
                        card_id: cardId, user_id: auth.record.id, author_id: card.author_id,
                        amount, role_id: roleId || "", created_at: new Date().toISOString()
                    })
                });
                return new Response(JSON.stringify({ ok: true, coins: myCoins - amount }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：人物卡爱心点赞/取消（POST /api/characters/like；每日每角色限 1 次，可再点取消）----
            if (url.pathname === "/api/characters/like" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const roleId = roleIdOf({ id: body.role_id || "" }); // 与前端 roleIdOf 同款清洗，避免同角色多 key
                if (!cardId || !roleId) return errorResponse("缺少 card_id / role_id", 400, null, "INVALID_CHAR");
                const now = Date.now();
                if (now - (postRateMap.get("likechar:" + auth.record.id) || 0) < LIKE_RATE_LIMIT_MS) {
                    return errorResponse("操作太频繁，请稍后再试", 429, null, "TOO_FREQUENT");
                }
                postRateMap.set("likechar:" + auth.record.id, now);
                const today = getTodayStr();
                const q = await pbAdminFetch(env, `/api/collections/donations/records?perPage=5&filter=${encodeURIComponent(`user_id='${escapePocketBaseFilterValue(auth.record.id)}'&&card_id='${escapePocketBaseFilterValue(cardId)}'&&role_id='${escapePocketBaseFilterValue(roleId)}'&&created>='${today} 00:00:00'`)}`);
                const d = await q.json().catch(() => ({}));
                const exist = (d.items || [])[0];
                if (exist && exist.id) {
                    // 已点赞 → 取消
                    await pbAdminFetch(env, `/api/collections/donations/records/${exist.id}`, { method: "DELETE" });
                    return new Response(JSON.stringify({ ok: true, liked: false }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                let authorId = "";
                const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                if (cQ.ok) {
                    const cD = await cQ.json().catch(() => ({}));
                    if (cD && cD.id) authorId = String(cD.author_id || "");
                }
                await pbAdminFetch(env, `/api/collections/donations/records`, {
                    method: "POST",
                    body: JSON.stringify({
                        card_id: cardId, user_id: auth.record.id, author_id: authorId,
                        amount: 0, role_id: roleId, created_at: new Date().toISOString()
                    })
                });
                return new Response(JSON.stringify({ ok: true, liked: true }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：发帖（POST /api/posts，30 秒限 1 帖）----
            if (url.pathname === "/api/posts" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const content = String(body.content || "").trim().slice(0, 500);
                if (!content) return errorResponse("内容不能为空", 400, null, "EMPTY_POST");
                const hit = checkBanned(content);
                if (hit) return errorResponse(`内容包含违禁词「${hit}」，请修改后重发`, 400, null, "BANNED_WORD");
                const now = Date.now();
                if (now - (postRateMap.get(auth.record.id) || 0) < POST_RATE_LIMIT_MS) {
                    return errorResponse("发帖太频繁，请稍后再试", 429, null, "POST_TOO_FREQUENT");
                }
                postRateMap.set(auth.record.id, now);
                const imageData = String(body.image_data || "").slice(0, 400000); // 帖图 base64，前端已压到 ~640px/JPEG
                const record = {
                    content,
                    author_id: auth.record.id,
                    card_id: String(body.card_id || "").trim().slice(0, 64),
                    image_data: imageData,
                    likes_count: 0,
                    comments_count: 0,
                    created_at: new Date().toISOString()
                };
                const res = await pbAdminFetch(env, `/api/collections/posts/records`, { method: "POST", body: JSON.stringify(record) });
                if (!res.ok) return errorResponse("发帖失败", 500, null, "POST_CREATE_FAILED");
                const created = await res.json().catch(() => ({}));
                return new Response(JSON.stringify({ id: created.id }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：点赞/取消点赞（POST /api/posts/like，5 秒限 1 次）----
            if (url.pathname === "/api/posts/like" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const postId = String(body.post_id || "");
                const like = body.like !== false;
                if (!postId) return errorResponse("缺少 post_id", 400, null, "INVALID_POST");
                const now = Date.now();
                if (now - (postRateMap.get("like:" + auth.record.id) || 0) < LIKE_RATE_LIMIT_MS) {
                    return errorResponse("操作太频繁，请稍后再试", 429, null, "LIKE_TOO_FREQUENT");
                }
                postRateMap.set("like:" + auth.record.id, now);
                const pQ = await pbAdminFetch(env, `/api/collections/posts/records/${encodeURIComponent(postId)}`);
                const pD = await pQ.json().catch(() => ({}));
                if (!pD || !pD.id) return errorResponse("帖子不存在", 404, null, "POST_NOT_FOUND");
                const filter = encodeURIComponent(`post_id='${escapePocketBaseFilterValue(postId)}'&&user_id='${escapePocketBaseFilterValue(auth.record.id)}'`);
                const lQ = await pbAdminFetch(env, `/api/collections/post_likes/records?perPage=1&skipTotal=true&filter=${filter}`);
                const lD = await lQ.json().catch(() => ({}));
                const existing = (lD.items || [])[0];
                if (like && !existing) {
                    await pbAdminFetch(env, `/api/collections/post_likes/records`, { method: "POST", body: JSON.stringify({ post_id: postId, user_id: auth.record.id, created_at: new Date().toISOString() }) });
                    await pbAdminFetch(env, `/api/collections/posts/records/${postId}`, { method: "PATCH", body: JSON.stringify({ likes_count: Number(pD.likes_count || 0) + 1 }) });
                } else if (!like && existing) {
                    await pbAdminFetch(env, `/api/collections/post_likes/records/${existing.id}`, { method: "DELETE" });
                    await pbAdminFetch(env, `/api/collections/posts/records/${postId}`, { method: "PATCH", body: JSON.stringify({ likes_count: Math.max(0, Number(pD.likes_count || 0) - 1) }) });
                }
                return new Response(JSON.stringify({ ok: true, liked: like }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：评论（POST 发表 / GET 列表 /api/posts/comments）----
            if (url.pathname === "/api/posts/comments" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const postId = String(body.post_id || "");
                const content = String(body.content || "").trim().slice(0, 200);
                if (!postId || !content) return errorResponse("参数不完整", 400, null, "INVALID_COMMENT");
                const hit = checkBanned(content);
                if (hit) return errorResponse(`评论包含违禁词「${hit}」，请修改后重发`, 400, null, "BANNED_WORD");
                const pQ = await pbAdminFetch(env, `/api/collections/posts/records/${encodeURIComponent(postId)}`);
                const pD = await pQ.json().catch(() => ({}));
                if (!pD || !pD.id) return errorResponse("帖子不存在", 404, null, "POST_NOT_FOUND");
                await pbAdminFetch(env, `/api/collections/post_comments/records`, { method: "POST", body: JSON.stringify({ post_id: postId, user_id: auth.record.id, content, created_at: new Date().toISOString() }) });
                await pbAdminFetch(env, `/api/collections/posts/records/${postId}`, { method: "PATCH", body: JSON.stringify({ comments_count: Number(pD.comments_count || 0) + 1 }) });
                return new Response(JSON.stringify({ ok: true }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }
            if (url.pathname === "/api/posts/comments" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const postId = String(url.searchParams.get("post_id") || "");
                if (!postId) return errorResponse("缺少 post_id", 400, null, "INVALID_POST");
                const q = await pbAdminFetch(env, `/api/collections/post_comments/records?perPage=100&sort=created&filter=${encodeURIComponent(`post_id='${escapePocketBaseFilterValue(postId)}'`)}`);
                const d = await q.json().catch(() => ({}));
                const cms = d.items || [];
                // 批量拉评论作者(逐条 join 会撞 CF 单次 50 子请求上限)
                const cAuthorIds = [...new Set(cms.map(cm => cm.user_id).filter(Boolean))];
                const cUsers = {};
                if (cAuthorIds.length) {
                    const orC = cAuthorIds.map(id => `id='${escapePocketBaseFilterValue(id)}'`).join("||");
                    const uQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=200&skipTotal=true&fields=id,nickname,faceimg&filter=${encodeURIComponent(orC)}`);
                    const uD = await uQ.json().catch(() => ({}));
                    for (const u of (uD.items || [])) cUsers[u.id] = u;
                }
                const items = cms.map(cm => {
                    const cu = cUsers[cm.user_id] || {};
                    return { id: cm.id, content: cm.content, created_at: cm.created_at, author: { id: cm.user_id, nickname: cu.nickname || "", faceimg: cu.faceimg || "" } };
                });
                return new Response(JSON.stringify({ items }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：关注/取关（POST /api/follows，切换）----
            if (url.pathname === "/api/follows" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const userId = String(body.user_id || "");
                if (!userId) return errorResponse("缺少 user_id", 400, null, "INVALID_USER");
                if (userId === auth.record.id) return errorResponse("不能关注自己", 400, null, "SELF_FOLLOW");
                const filter = encodeURIComponent(`follower_id='${escapePocketBaseFilterValue(auth.record.id)}'&&user_id='${escapePocketBaseFilterValue(userId)}'`);
                const fQ = await pbAdminFetch(env, `/api/collections/follows/records?perPage=1&skipTotal=true&filter=${filter}`);
                const fD = await fQ.json().catch(() => ({}));
                const existing = (fD.items || [])[0];
                if (existing) {
                    await pbAdminFetch(env, `/api/collections/follows/records/${existing.id}`, { method: "DELETE" });
                    return new Response(JSON.stringify({ ok: true, following: false }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                await pbAdminFetch(env, `/api/collections/follows/records`, { method: "POST", body: JSON.stringify({ follower_id: auth.record.id, user_id: userId, created_at: new Date().toISOString() }) });
                return new Response(JSON.stringify({ ok: true, following: true }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：作品讨论区发评论/回复（POST /api/game/reviews，5 秒限 1 次）----
            if (url.pathname === "/api/game/reviews" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const content = String(body.content || "").trim().slice(0, 200);
                if (!cardId || !content) return errorResponse("参数不完整", 400, null, "INVALID_REVIEW");
                const hit = checkBanned(content);
                if (hit) return errorResponse(`评论包含违禁词「${hit}」，请修改后重发`, 400, null, "BANNED_WORD");
                const now = Date.now();
                if (now - (postRateMap.get("review:" + auth.record.id) || 0) < DONATE_RATE_LIMIT_MS) {
                    return errorResponse("评论太频繁，请稍后再试", 429, null, "REVIEW_TOO_FREQUENT");
                }
                postRateMap.set("review:" + auth.record.id, now);
                // 论坛=当前剧本评论区,官方剧本卡是前端本地数据(不在 community_cards 集合),卡查不到不拦截
                const res = await pbAdminFetch(env, `/api/collections/reviews/records`, {
                    method: "POST",
                    body: JSON.stringify({
                        card_id: cardId,
                        user_id: auth.record.id,
                        content,
                        parent_id: String(body.parent_id || "").slice(0, 64),
                        created_at: new Date().toISOString()
                    })
                });
                if (!res.ok) return errorResponse("评论失败", 500, null, "REVIEW_CREATE_FAILED");
                const created = await res.json().catch(() => ({}));
                return new Response(JSON.stringify({ ok: true, id: created.id }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：讨论区列表（GET /api/game/reviews?card_id=xx 嵌套回复 | ?recent=1 全站论坛流）----
            if (url.pathname === "/api/game/reviews" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                if (url.searchParams.get("recent") === "1") {
                    const q = await pbAdminFetch(env, `/api/collections/reviews/records?perPage=30&sort=-created`);
                    const d = await q.json().catch(() => ({}));
                    const items = await Promise.all((d.items || []).map(async (r) => {
                        let cardTitle = "";
                        if (r.card_id) {
                            const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(r.card_id)}`);
                            const cD = await cQ.json().catch(() => ({}));
                            if (cD && cD.id) cardTitle = String(cD.title || "");
                        }
                        return { id: r.id, card_id: r.card_id || "", card_title: cardTitle, content: String(r.content || ""), created_at: r.created_at, author: await pbGetUser(env, r.user_id) };
                    }));
                    return new Response(JSON.stringify({ items }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
                const cardId = String(url.searchParams.get("card_id") || "");
                if (!cardId) return errorResponse("缺少 card_id", 400, null, "INVALID_CARD");
                const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
                const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 20), 1), 50);
                const q = await pbAdminFetch(env, `/api/collections/reviews/records?perPage=${limit}&page=${Math.floor(offset / limit) + 1}&sort=created&filter=${encodeURIComponent(`card_id='${escapePocketBaseFilterValue(cardId)}'`)}`);
                const d = await q.json().catch(() => ({}));
                const all = await Promise.all((d.items || []).map(async (r) => ({
                    id: r.id, parent_id: r.parent_id || "", content: String(r.content || ""), created_at: r.created_at, author: await pbGetUser(env, r.user_id)
                })));
                const tops = all.filter((r) => !r.parent_id);
                const repliesOf = (pid) => all.filter((r) => r.parent_id === pid);
                const items = tops.map((t) => {
                    const reps = repliesOf(t.id);
                    return { ...t, replies: reps, extra_replies: Math.max(0, reps.length - 3) };
                });
                return new Response(JSON.stringify({ items, total: d.totalItems || 0 }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 路由：收藏/取消收藏人物卡（POST /api/characters/favorite，5 秒限 1 次）----
            if (url.pathname === "/api/characters/favorite" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const cardId = String(body.card_id || "").trim();
                const characterId = String(body.character_id || "").trim();
                const on = body.value !== false;
                if (!cardId || !characterId) return errorResponse("参数不完整", 400, null, "INVALID_CHARACTER");
                const now = Date.now();
                if (now - (postRateMap.get("charfav:" + auth.record.id) || 0) < LIKE_RATE_LIMIT_MS) {
                    return errorResponse("操作太频繁，请稍后再试", 429, null, "TOO_FREQUENT");
                }
                postRateMap.set("charfav:" + auth.record.id, now);
                // 官方卡不在 community_cards：404 时放行（与打赏放行策略一致，仅校验角色 ID）
                const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                if (!cQ.ok && !characterId) return errorResponse("作品不存在", 404, null, "CARD_NOT_FOUND");
                const filter = encodeURIComponent(`card_id='${escapePocketBaseFilterValue(cardId)}'&&character_id='${escapePocketBaseFilterValue(characterId)}'&&user_id='${escapePocketBaseFilterValue(auth.record.id)}'`);
                const fQ = await pbAdminFetch(env, `/api/collections/character_favorites/records?perPage=1&skipTotal=true&filter=${filter}`);
                const fD = await fQ.json().catch(() => ({}));
                const existing = (fD.items || [])[0];
                if (on && !existing) {
                    await pbAdminFetch(env, `/api/collections/character_favorites/records`, { method: "POST", body: JSON.stringify({ card_id: cardId, character_id: characterId, user_id: auth.record.id, created_at: new Date().toISOString() }) });
                    return new Response(JSON.stringify({ ok: true, favorited: true }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                if (!on && existing) {
                    await pbAdminFetch(env, `/api/collections/character_favorites/records/${existing.id}`, { method: "DELETE" });
                }
                return new Response(JSON.stringify({ ok: true, favorited: false }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：我的收藏人物卡（GET /api/characters/favorites）----
            if (url.pathname === "/api/characters/favorites" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const q = await pbAdminFetch(env, `/api/collections/character_favorites/records?perPage=200&sort=-created&filter=${encodeURIComponent(`user_id='${escapePocketBaseFilterValue(auth.record.id)}'`)}`);
                const d = await q.json().catch(() => ({}));
                const items = await Promise.all((d.items || []).map(async (f) => {
                    const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(f.card_id)}`);
                    const cD = await cQ.json().catch(() => ({}));
                    const npc = cD && cD.id ? npcOfCard(cD.data, f.character_id) : null;
                    return {
                        card_id: f.card_id, card_title: (cD && cD.id) ? String(cD.title || "") : "", character_id: f.character_id,
                        name: npc ? String(npc.name || "") : "", role: npc ? String(npc.role || npc.relation || "") : "",
                        created_at: f.created_at
                    };
                }));
                return new Response(JSON.stringify({ items }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 语言文游 LangPlay：学习档案 / 生词本（GET|PUT /api/lang/profile、GET|POST /api/lang/vocab、PUT /api/lang/vocab/status）----
            if (url.pathname === "/api/lang/profile" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'`);
                const pQ = await pbAdminFetch(env, `/api/collections/lang_profiles/records?perPage=1&skipTotal=true&filter=${f}`);
                const pD = await pQ.json().catch(() => ({}));
                const rec = (pD.items || [])[0];
                return new Response(JSON.stringify({
                    profile: rec ? {
                        lang: String(rec.lang || "en"), band: normLangBand(String(rec.band || "")), immersion: String(rec.immersion || ""),
                        created_at: rec.created_at || "", updated_at: rec.updated_at || ""
                    } : null
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            if (url.pathname === "/api/lang/profile" && request.method === "PUT") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const body = await request.json().catch(() => ({}));
                const lang = String(body.lang || "en").slice(0, 8);
                const band = normLangBand(body.band); // 五档值域;旧 a/b/c 也映射写入
                const immersion = ["progressive", "full"].includes(body.immersion) ? String(body.immersion) : "";
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'`);
                const q = await pbAdminFetch(env, `/api/collections/lang_profiles/records?perPage=1&skipTotal=true&filter=${f}`);
                const d = await q.json().catch(() => ({}));
                const exist = (d.items || [])[0];
                const data = { user_id: uid, lang };
                if (band) data.band = band;
                if (immersion) data.immersion = immersion;
                let out = {};
                if (exist) {
                    const r = await pbAdminFetch(env, `/api/collections/lang_profiles/records/${exist.id}`, { method: "PATCH", body: JSON.stringify(data) });
                    out = await r.json().catch(() => ({}));
                } else {
                    const r = await pbAdminFetch(env, `/api/collections/lang_profiles/records`, { method: "POST", body: JSON.stringify(data) });
                    out = await r.json().catch(() => ({}));
                }
                return new Response(JSON.stringify({ ok: true, profile: { lang: String(out.lang || lang), band: normLangBand(String(out.band || "")), immersion: String(out.immersion || ""), updated_at: out.updated_at || "" } }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }
            if (url.pathname === "/api/lang/vocab" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const status = String(url.searchParams.get("status") || "");
                let f = `user_id='${escapePocketBaseFilterValue(uid)}'`;
                if (status === "0" || status === "1" || status === "2") f += `&&status=${status}`;
                const q = await pbAdminFetch(env, `/api/collections/lang_vocab/records?perPage=200&sort=-created&filter=${encodeURIComponent(f)}`);
                const d = await q.json().catch(() => ({}));
                const items = (d.items || []).map((i) => ({
                    id: i.id, lang: String(i.lang || "en"), type: String(i.type || "word"), term: String(i.term || ""),
                    gloss_en: String(i.gloss_en || ""), gloss_zh: String(i.gloss_zh || ""), origin: String(i.origin || ""),
                    status: Number(i.status || 0), created_at: i.created_at || ""
                }));
                return new Response(JSON.stringify({ items, total: items.length }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            if (url.pathname === "/api/lang/vocab" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const body = await request.json().catch(() => ({}));
                const term = String(body.term || "").trim().slice(0, 64);
                if (!term) return errorResponse("缺少生词内容", 400, null, "INVALID_TERM");
                const lang = String(body.lang || "en").slice(0, 8);
                const type = body.type === "expression" ? "expression" : "word";
                const data = {
                    user_id: uid, lang, type, term,
                    gloss_en: String(body.gloss_en || "").slice(0, 500),
                    gloss_zh: String(body.gloss_zh || "").slice(0, 500),
                    origin: String(body.origin || "").slice(0, 200)
                };
                const dupF = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'&&term='${escapePocketBaseFilterValue(term)}'`);
                const dupQ = await pbAdminFetch(env, `/api/collections/lang_vocab/records?perPage=1&skipTotal=true&filter=${dupF}`);
                const dupD = await dupQ.json().catch(() => ({}));
                const dup = (dupD.items || [])[0];
                if (dup) {
                    // 已存在：只补空缺释义，不动 status
                    const patch = {};
                    if (!dup.gloss_en && data.gloss_en) patch.gloss_en = data.gloss_en;
                    if (!dup.gloss_zh && data.gloss_zh) patch.gloss_zh = data.gloss_zh;
                    if (Object.keys(patch).length) await pbAdminFetch(env, `/api/collections/lang_vocab/records/${dup.id}`, { method: "PATCH", body: JSON.stringify(patch) }).catch(() => {});
                    return new Response(JSON.stringify({ ok: true, existed: true, id: dup.id }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                const r = await pbAdminFetch(env, `/api/collections/lang_vocab/records`, { method: "POST", body: JSON.stringify(data) });
                if (!r.ok) return errorResponse("生词保存失败", 500, null, "VOCAB_CREATE_FAILED");
                const created = await r.json().catch(() => ({}));
                return new Response(JSON.stringify({ ok: true, existed: false, id: created.id }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            if (url.pathname === "/api/lang/vocab/status" && request.method === "PUT") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const body = await request.json().catch(() => ({}));
                const vid = String(body.id || "");
                const status = Number(body.status);
                if (!vid) return errorResponse("缺少记录 id", 400, null, "INVALID_ID");
                if (![0, 1, 2].includes(status)) return errorResponse("状态值不合法（0/1/2）", 400, null, "INVALID_STATUS");
                const q = await pbAdminFetch(env, `/api/collections/lang_vocab/records/${vid}`);
                const d = await q.json().catch(() => ({}));
                if (!d.id || d.user_id !== uid) return errorResponse("记录不存在", 404, null, "NOT_FOUND");
                await pbAdminFetch(env, `/api/collections/lang_vocab/records/${vid}`, { method: "PATCH", body: JSON.stringify({ status }) });
                return new Response(JSON.stringify({ ok: true, id: vid, status }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            // M9E:生词删除(仅本人记录;lang_vocab 为 admin-only 集合,worker 代删)
            if (url.pathname === "/api/lang/vocab" && request.method === "DELETE") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const vid = String(url.searchParams.get("id") || "");
                if (!vid) return errorResponse("缺少记录 id", 400, null, "INVALID_ID");
                const q = await pbAdminFetch(env, `/api/collections/lang_vocab/records/${vid}`);
                const d = await q.json().catch(() => ({}));
                if (!d.id || d.user_id !== uid) return errorResponse("记录不存在", 404, null, "NOT_FOUND");
                await pbAdminFetch(env, `/api/collections/lang_vocab/records/${vid}`, { method: "DELETE" });
                return new Response(JSON.stringify({ ok: true, id: vid }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            // ---- 排行榜:学习时长上报(PUT /api/lang/study)----
            // 客户端每 ~60s 上报累计秒;单次 ≤600s;同一北京自然日 cap 14400s(4h)防挂机刷榜
            if (url.pathname === "/api/lang/study" && request.method === "PUT") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const body = await request.json().catch(() => ({}));
                const add = Math.min(600, Math.max(1, Math.floor(Number(body.seconds) || 0)));
                const lang = String(body.lang || "en").slice(0, 8);
                const day = getTodayStr();
                const CAP = 14400;
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'&&lang='${escapePocketBaseFilterValue(lang)}'&&day='${day}'`);
                const q = await pbAdminFetch(env, `/api/collections/lang_study_days/records?perPage=1&skipTotal=true&filter=${f}`);
                const d = await q.json().catch(() => ({}));
                const exist = (d.items || [])[0];
                let secs = add;
                if (exist) {
                    secs = Math.min(CAP, (Number(exist.seconds) || 0) + add);
                    await pbAdminFetch(env, `/api/collections/lang_study_days/records/${exist.id}`, { method: "PATCH", body: JSON.stringify({ seconds: secs }) });
                } else {
                    const r = await pbAdminFetch(env, `/api/collections/lang_study_days/records`, { method: "POST", body: JSON.stringify({ user_id: uid, lang, day, seconds: secs }) });
                    if (!r.ok) return errorResponse("学习时长上报失败", 500, null, "STUDY_SAVE_FAILED");
                }
                return new Response(JSON.stringify({ ok: true, day_seconds: secs }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            // ---- 排行榜:日/周/月学习时长 Top100(GET /api/lang/leaderboard?span=&lang=)----
            // 聚合 lang_study_days(按 user_id),并列同秒同 rank(跳跃式);登录时可带 me(自己秒数+名次,未进 100 也可显示)
            if (url.pathname === "/api/lang/leaderboard" && request.method === "GET") {
                const span = url.searchParams.get("span") === "week" || url.searchParams.get("span") === "month" ? url.searchParams.get("span") : "day";
                const lang = String(url.searchParams.get("lang") || "en").slice(0, 8);
                const start = getCnSliceStart(span);
                const today = getTodayStr();
                const f = encodeURIComponent(`lang='${escapePocketBaseFilterValue(lang)}'&&day>='${start}'&&day<='${today}'`);
                const agg = {};
                let page = 1;
                for (;;) {
                    const q = await pbAdminFetch(env, `/api/collections/lang_study_days/records?perPage=500&page=${page}&fields=user_id,seconds&filter=${f}`);
                    const d = await q.json().catch(() => ({}));
                    const items = d.items || [];
                    for (const it of items) agg[it.user_id] = (agg[it.user_id] || 0) + Number(it.seconds || 0);
                    if (items.length < 500 || !d.page || page >= (d.totalPages || page)) break;
                    page++;
                }
                const rows = Object.keys(agg).map((uid) => ({ uid, sec: agg[uid] }))
                    .sort((a, b) => b.sec - a.sec || (a.uid < b.uid ? -1 : 1));
                const ranks = {};
                let lastSec = -1, lastRank = 0;
                rows.forEach((r, i) => { if (r.sec !== lastSec) { lastRank = i + 1; lastSec = r.sec; } ranks[r.uid] = lastRank; });
                const top = rows.slice(0, 100);
                const userMap = {};
                if (top.length) {
                    const orC = top.map((r) => `id='${escapePocketBaseFilterValue(r.uid)}'`).join("||");
                    const uQ = await pbAdminFetch(env, `/api/collections/users/records?perPage=200&skipTotal=true&fields=id,nickname,username,faceimg&filter=${encodeURIComponent(orC)}`);
                    const uD = await uQ.json().catch(() => ({}));
                    for (const u of (uD.items || [])) userMap[u.id] = u;
                }
                const items = top.map((r) => ({
                    user_id: r.uid, rank: ranks[r.uid],
                    nickname: String((userMap[r.uid] && (userMap[r.uid].nickname || userMap[r.uid].username)) || "").slice(0, 30),
                    faceimg: String((userMap[r.uid] && userMap[r.uid].faceimg) || "").slice(0, 500),
                    seconds: r.sec
                }));
                let me = null;
                try {
                    const auth = await authenticate(env, request);
                    if (auth && auth.record && agg[auth.record.id]) {
                        const mid = auth.record.id;
                        me = { user_id: mid, seconds: agg[mid], rank: ranks[mid] };
                    }
                } catch (e) {}
                return new Response(JSON.stringify({ span, lang, start, items, me }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由:M6d5 词库进度词测(GET|PUT /api/lang/progress?band=x;lang_bank_progress 私有集合)----
            // GET:拉该档全量词态(weak 隔章重测/learned 出池用);PUT:词测批量提交 ok/fail
            if (url.pathname === "/api/lang/progress" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const band = normLangBand(url.searchParams.get("band"));
                if (!band) return errorResponse("无效档位", 400, null, "INVALID_BAND");
                const f = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'&&band='${band}'`);
                const q = await pbAdminFetch(env, `/api/collections/lang_bank_progress/records?perPage=200&sort=word&filter=${f}`);
                const d = await q.json().catch(() => ({}));
                const items = (d.items || []).map((i) => ({
                    word: String(i.word || ""), state: ["seen", "weak", "learned"].includes(String(i.state)) ? String(i.state) : "seen",
                    ok_count: Number(i.ok_count || 0), fail_count: Number(i.fail_count || 0), updated_at: i.updated_at || ""
                }));
                return new Response(JSON.stringify({ items, total: items.length }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }
            if (url.pathname === "/api/lang/progress" && request.method === "PUT") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const body = await request.json().catch(() => ({}));
                const band = normLangBand(body.band);
                if (!band) return errorResponse("无效档位", 400, null, "INVALID_BAND");
                const raws = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
                const items = [];
                for (const r of raws) {
                    const word = String((r && r.word) || "").trim().toLowerCase();
                    if (!word || !/^[a-z][a-z0-9'-]*$/.test(word) || word.length > 40) continue;
                    items.push({ word, ok: !!r.ok });
                }
                if (!items.length) return errorResponse("没有可提交的词", 400, null, "INVALID_ITEMS");
                const out = [];
                for (const it of items) {
                    const wf = encodeURIComponent(`user_id='${escapePocketBaseFilterValue(uid)}'&&band='${band}'&&word='${escapePocketBaseFilterValue(it.word)}'`);
                    const q = await pbAdminFetch(env, `/api/collections/lang_bank_progress/records?perPage=1&skipTotal=true&filter=${wf}`);
                    const d = await q.json().catch(() => ({}));
                    const rec = (d.items || [])[0];
                    let state, okc, flc;
                    if (rec) {
                        okc = Number(rec.ok_count || 0); flc = Number(rec.fail_count || 0);
                        if (it.ok) { okc += 1; state = "learned"; }   // 答对:任意态 → learned(weak 再对 1 次即掌握)
                        else { flc += 1; state = "weak"; }             // 答错:回炉 weak(learned 答错也降)
                        await pbAdminFetch(env, `/api/collections/lang_bank_progress/records/${rec.id}`, { method: "PATCH", body: JSON.stringify({ state, ok_count: okc, fail_count: flc, updated_at: new Date().toISOString() }) }).catch(() => {});
                    } else {
                        state = it.ok ? "learned" : "weak";
                        okc = it.ok ? 1 : 0; flc = it.ok ? 0 : 1;
                        const cr = await pbAdminFetch(env, "/api/collections/lang_bank_progress/records", { method: "POST", body: JSON.stringify({ user_id: uid, band, word: it.word, state, ok_count: okc, fail_count: flc, updated_at: new Date().toISOString() }) });
                        const cd = await cr.json().catch(() => ({}));
                        if (!cd.id) continue;   // 建失败(如并发已建)跳过,下次提交再收敛
                    }
                    out.push({ word: it.word, state });
                }
                return new Response(JSON.stringify({ ok: true, items: out }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由:语言文游 M4 点句翻译合批(POST /api/lang/gloss,直调模型不落库;同句重复由前端内存缓存兜住)----
            if (url.pathname === "/api/lang/gloss" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const now = Date.now();
                if (now - (glossRateMap.get(uid) || 0) < GLOSS_RATE_LIMIT_MS) {
                    return errorResponse("翻译有点快，歇一下再点吧", 429, null, "GLOSS_TOO_FREQUENT");
                }
                // M7c:日配额检查(不计数,调用成功后才 bump)
                if ((await langAuxUsed(env, uid, "gloss", isMember(auth.record))) < 0) {
                    return errorResponse("今天的点译次数用完啦，明天 08:00 刷新；开通会员可点更多", 429, null, "GLOSS_DAILY_LIMIT");
                }
                const body = await request.json().catch(() => ({}));
                const raw = Array.isArray(body.sentences) ? body.sentences : [];
                const sentences = [];
                for (let i = 0; i < raw.length && sentences.length < GLOSS_MAX_SENTENCES; i++) {
                    const s = String(raw[i] || "").replace(/\s+/g, " ").trim().slice(0, 300);
                    if (s) sentences.push(s);
                }
                if (!sentences.length) return errorResponse("没有可翻译的句子", 400, null, "INVALID_SENTENCES");
                glossRateMap.set(uid, now);
                const out = await callGlossModel(env, sentences);
                if (out.error) return out.error;
                await langAuxBump(env, uid, "gloss");
                return new Response(JSON.stringify({ ok: true, items: out.items }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由:语言文游 M5 章末复盘(POST /api/lang/recap;剧情+档位→高频表达+仿写例句,直调模型)----
            if (url.pathname === "/api/lang/recap" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const uid = auth.record.id;
                const now = Date.now();
                if (now - (recapRateMap.get(uid) || 0) < RECAP_RATE_LIMIT_MS) {
                    return errorResponse("刚生成过，先看看这份吧", 429, null, "RECAP_TOO_FREQUENT");
                }
                if ((await langAuxUsed(env, uid, "recap", isMember(auth.record))) < 0) {
                    return errorResponse("今天的复盘次数用完啦，明天 08:00 刷新；开通会员可复盘更多", 429, null, "RECAP_DAILY_LIMIT");
                }
                const body = await request.json().catch(() => ({}));
                const story = String(body.story || "").replace(/\s+/g, " ").trim().slice(0, RECAP_STORY_LIMIT);
                if (story.length < 200) return errorResponse("剧情内容太少，还没法复盘", 400, null, "RECAP_STORY_TOO_SHORT");
                const band = normLangBand(body.band) || "cet6"; // 五档;旧 a/b/c 读侧迁移
                recapRateMap.set(uid, now);
                const out = await callRecapModel(env, story, band);
                if (out.error) return out.error;
                await langAuxBump(env, uid, "recap");
                return new Response(JSON.stringify({ ok: true, expressions: out.expressions, writing: out.writing }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由:M6d1 五档考试词库(GET /api/lang/bank?band=hs|cet4|cet6|ky|toefl;公开只读;内存缓存 10min)----
            if (url.pathname === "/api/lang/bank" && request.method === "GET") {
                const band = String(url.searchParams.get("band") || "").trim();
                if (!["hs", "cet4", "cet6", "ky", "toefl"].includes(band)) {
                    return errorResponse("无效档位", 400, null, "INVALID_BAND");
                }
                const nowMs = Date.now();
                if (bankCache.t > nowMs - 600000 && bankCache.data && bankCache.data[band]) {
                    const hit = bankCache.data[band];
                    return new Response(JSON.stringify({ ok: true, band: hit.band, total: hit.total, items: hit.items }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                try {
                    const q = await pbAdminFetch(env, "/api/collections/lang_banks/records?perPage=200");
                    const d = await q.json().catch(() => ({}));
                    const groups = {};
                    for (const r of d.items || []) {
                        if (!r || !r.band) continue;
                        (groups[r.band] = groups[r.band] || []).push(r);
                    }
                    for (const b of Object.keys(groups)) {
                        groups[b].sort((x, y) => (x.part || 0) - (y.part || 0));
                        let items = [];
                        let total = 0;
                        for (const r of groups[b]) {
                            if (Array.isArray(r.items)) items = items.concat(r.items);
                            total = Number(r.total || 0) || total;
                        }
                        groups[b] = { band: b, total, items };
                    }
                    bankCache = { t: nowMs, data: groups };
                    const out = groups[band];
                    if (!out) return errorResponse("该档词库不存在", 404, null, "BANK_NOT_FOUND");
                    return new Response(JSON.stringify({ ok: true, band: out.band, total: out.total, items: out.items }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                } catch (e) {
                    return errorResponse("词库服务暂不可用", 503, null, "BANK_UNAVAILABLE");
                }
            }

            // ---- 路由：M6b 语言卡官方库（GET /api/lang/cards?lang=en&band=cet6；公开只读 online；内存缓存 60s）----
            // 返回记录即前端卡对象（text/data.structured 平铺），播放与词库档位直接可用
            if (url.pathname === "/api/lang/cards" && request.method === "GET") {
                const lang = String(url.searchParams.get("lang") || "en").trim();
                const band = String(url.searchParams.get("band") || "").trim();
                const nowMs = Date.now();
                if (langCardsCache.t > nowMs - 60000 && langCardsCache.data) {
                    let items = langCardsCache.data.filter((c) => c.lang === lang && (!band || c.band === band));
                    return new Response(JSON.stringify({ ok: true, items }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                }
                try {
                    const q = await pbAdminFetch(env, `/api/collections/lang_cards/records?perPage=200&sort=order&filter=${encodeURIComponent(`status='online' && lang='${lang}'`)}`);
                    const d = await q.json().catch(() => ({}));
                    const items = (d.items || [])
                        .filter((r) => r && r.data && typeof r.data === "object")
                        .map((r) => ({
                            id: r.id,
                            title: String(r.title || ""),
                            title_zh: String(r.title_zh || ""),
                            lang: String(r.lang || lang),
                            band: String(r.band || "cet4"),
                            category: String(r.category || ""),
                            category_zh: String(r.category_zh || ""),
                            theme: String(r.theme || ""),
                            cover: String(r.cover || ""),
                            sourceType: "official",
                            text: String(r.data.text || ""),
                            structured: r.data.structured || {},
                            play_count: Number(r.play_count || 0),
                            unlock_count: Number(r.unlock_count || 0)
                        }))
                        .filter((c) => c.title && c.text && c.structured && typeof c.structured === "object");
                    langCardsCache = { t: nowMs, data: items };
                    const out = items.filter((c) => c.lang === lang && (!band || c.band === band));
                    return new Response(JSON.stringify({ ok: true, items: out }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
                } catch (e) {
                    return errorResponse("语言卡库服务暂不可用", 503, null, "LANG_CARDS_UNAVAILABLE");
                }
            }

            // ---- 路由：热聊人物卡榜（GET /api/characters/hot，送笔芯人气 + 收藏数聚合）----
            if (url.pathname === "/api/characters/hot" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const dQ = await pbAdminFetch(env, `/api/collections/donations/records?perPage=200&sort=-created&filter=${encodeURIComponent(`role_id!=''`)}`);
                const dD = await dQ.json().catch(() => ({}));
                const roleHot = new Map();
                for (const d of dD.items || []) {
                    if (!d.role_id) continue;
                    // 批9.12：role_id 清洗后聚合，杜绝同角色多 key 导致计数错位
                    const rid = roleIdOf({ id: d.role_id });
                    const k = (d.card_id || "") + "::" + rid;
                    roleHot.set(k, (roleHot.get(k) || 0) + 1);
                }
                const fQ = await pbAdminFetch(env, `/api/collections/character_favorites/records?perPage=200&sort=-created`);
                const fD = await fQ.json().catch(() => ({}));
                const favCount = new Map();
                for (const f of fD.items || []) {
                    const k = (f.card_id || "") + "::" + (f.character_id || "");
                    favCount.set(k, (favCount.get(k) || 0) + 1);
                }
                // 批9.12：只返回有互动（爱心/收藏）的角色；官方剧本 NPC 由前端补充展示
                const keys = new Set([...roleHot.keys(), ...favCount.keys()]);
                const cardCache = new Map();
                const hotList = [];
                for (const k of keys) {
                    const [cardId, characterId] = k.split("::");
                    let card = cardCache.get(cardId);
                    if (!card && cardId) {
                        const cQ = await pbAdminFetch(env, `/api/collections/community_cards/records/${encodeURIComponent(cardId)}`);
                        const cD = await cQ.json().catch(() => ({}));
                        card = (cD && cD.id) ? cD : null;
                        cardCache.set(cardId, card);
                    }
                    const npc = card ? npcOfCard(card.data, characterId) : null;
                    hotList.push({
                        card_id: cardId, character_id: characterId,
                        card_title: card ? String(card.title || "") : "",
                        name: npc ? String(npc.name || characterId) : characterId,
                        role: npc ? String(npc.role || npc.relation || "") : "",
                        pens: roleHot.get(k) || 0,
                        favs: favCount.get(k) || 0
                    });
                }
                const top = hotList.sort((a, b) => (b.pens * 2 + b.favs) - (a.pens * 2 + a.favs)).slice(0, 20);
                return new Response(JSON.stringify({ items: top }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            // ---- 诊断路由:回显 Secrets key 指纹(sha256 前 12 位),核对 CF Secrets 是否真的生效 ----
            if (url.pathname === "/api/diag/key" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const fp = async (s) => {
                    if (!s) return null;
                    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
                    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 12);
                };
                return new Response(JSON.stringify({
                    CHATANYWHERE_KEY: await fp(env.CHATANYWHERE_KEY),
                    CHATANYWHERE_KEY_LEN: env.CHATANYWHERE_KEY ? env.CHATANYWHERE_KEY.length : 0,
                    ZHIPU_KEY: await fp(env.ZHIPU_KEY),
                    SILICONFLOW_KEY: await fp(env.SILICONFLOW_KEY)
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：创建支付订单 ----
            if (url.pathname === "/api/pay/create" && request.method === "POST") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                let body = {};
                try { body = await request.json(); } catch (e) {}
                const planId = String(body.planId || "");
                const payType = ["alipay", "wxpay"].includes(body.payType) ? body.payType : "alipay";
                if (!CHARGE_PLANS[planId] && !MEMBER_PLANS[planId] && planId !== "lifetime") return errorResponse("无效的充值档位", 400, null, "INVALID_PLAN");
                const ua = request.headers.get("user-agent") || "";
                const isMobile = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(ua);
                try {
                    const { orderNo, jumpUrl, qrUrl } = await createPayOrder(env, auth.record.id, planId, payType, isMobile);
                    return new Response(JSON.stringify({ orderNo, jumpUrl, qrUrl }), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                } catch (e) {
                    return errorResponse("创建订单失败：" + e.message, 502, null, "PAY_CREATE_FAILED");
                }
            }

            // ---- 路由：终身会员限时优惠状态（GET 查询 / POST 首次打开充值页计时）----
            if (url.pathname === "/api/pay/offer") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                if (request.method === "POST") {
                    const existing = await env.COVER_CACHE.get("offer:" + auth.record.id).catch(() => null);
                    if (!existing) await env.COVER_CACHE.put("offer:" + auth.record.id, String(Date.now())).catch(() => {});
                }
                const offer = await getLifetimeOffer(env, auth.record.id);
                return new Response(JSON.stringify({
                    active: offer.active,
                    startedAt: offer.startedAt,
                    price: offer.active ? LIFETIME_PLAN.price : LIFETIME_REGULAR_PRICE
                }), { headers: { ...corsHeaders(), "Content-Type": "application/json" } });
            }

            // ---- 路由：支付回调（易支付异步通知，GET/POST 均可）----
            if (url.pathname === "/api/pay/notify") {
                let params;
                let raw = "";
                if (request.method === "POST") {
                    const text = await request.text();
                    raw = text;
                    // h5zhifu 回调文档为 application/json;兼容易支付旧版表单格式——先 JSON 后表单
                    try {
                        const obj = JSON.parse(text);
                        params = (obj && typeof obj === "object" && !Array.isArray(obj)) ? obj : {};
                    } catch (e) {
                        try { params = Object.fromEntries(new URLSearchParams(text)); }
                        catch (e2) { params = {}; }
                    }
                } else {
                    params = Object.fromEntries(url.searchParams);
                    raw = new URLSearchParams(params).toString();
                }
                const result = await handlePayNotify(env, params, raw);
                return new Response(result, { headers: corsHeaders() }); // "success"/"fail" 纯文本
            }

            // ---- 路由：虎皮椒支付回调（form 表单 POST，回复纯文本 success/fail）----
            if (url.pathname === "/api/xunhu/notify" && request.method === "POST") {
                const text = await request.text();
                let params = {};
                try { params = Object.fromEntries(new URLSearchParams(text)); } catch (e) {}
                const result = await handleXunhuNotify(env, params, text);
                return new Response(result, { headers: corsHeaders() });
            }

            // ---- 路由：查询订单状态（前端轮询兜底）----
            if (url.pathname === "/api/pay/status" && request.method === "GET") {
                const auth = await authenticate(env, request);
                if (auth.error) return auth.error;
                const orderNo = url.searchParams.get("out_trade_no") || "";
                if (!orderNo) return errorResponse("缺少订单号", 400, null, "INVALID_ORDER");
                const filter = encodeURIComponent(`order_no='${escapePocketBaseFilterValue(orderNo)}'`);
                const q = await pbAdminFetch(env, `/api/collections/pay_orders/records?perPage=1&skipTotal=true&filter=${filter}`);
                if (!q.ok) return errorResponse("查询订单失败", 500, null, "ORDER_QUERY_FAILED");
                const data = await q.json();
                const order = (data.items || [])[0];
                if (!order || order.user_id !== auth.record.id) return errorResponse("订单不存在", 404, null, "INVALID_ORDER");
                let status = Array.isArray(order.status) ? order.status[0] : order.status; // PocketBase JSON 字段可能返回数组
                // 只查本地订单状态（H5 网关查询接口严禁轮询，500 次/天黑名单）
                return new Response(JSON.stringify({ status, outTradeNo: orderNo, planId: order.plan_id || "" }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            return errorResponse("Not Found", 404);

        } catch (e) {
            return errorResponse("Worker Error", 500, e.message);
        }
    },
    // 社区动态 30 天自动清理：每天 04:10 UTC（北京时间 12:10）删除 created 超过 30 天的动态及其点赞/评论
    // seed 预制动态（seed 字段非空）永久保留，不入清理
    async scheduled(event, env, ctx) {
        const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
        const filter = encodeURIComponent(`created<'${cutoff}' && seed=''`);
        let deleted = 0;
        try {
            while (true) {
                const q = await pbAdminFetch(env, `/api/collections/posts/records?perPage=200&page=1&filter=${filter}&fields=id`);
                const d = await q.json().catch(() => ({}));
                const items = d.items || [];
                if (!items.length) break;
                for (const p of items) {
                    for (const coll of ["post_likes", "post_comments"]) {
                        const f = encodeURIComponent(`post_id='${escapePocketBaseFilterValue(p.id)}'`);
                        const lq = await pbAdminFetch(env, `/api/collections/${coll}/records?perPage=200&filter=${f}&fields=id`);
                        const ld = await lq.json().catch(() => ({}));
                        for (const r of ld.items || []) {
                            await pbAdminFetch(env, `/api/collections/${coll}/records/${r.id}`, { method: "DELETE" });
                        }
                    }
                    await pbAdminFetch(env, `/api/collections/posts/records/${p.id}`, { method: "DELETE" });
                    deleted++;
                }
            }
            console.log(`post-cleanup done deleted=${deleted} at=${cutoff}`);
        } catch (e) {
            console.error("post-cleanup error:", e && e.message);
        }
    }
};
