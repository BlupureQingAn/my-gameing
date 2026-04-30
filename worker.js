// ==================== 1. 配置中心 ====================
const CLOUD_CARD_CONFIGS = {
    free: {
        primary: { 
            url: "https://integrate.api.nvidia.com/v1", 
            apiKeyEnv: "NVIDIA_KEY", 
            model: "qwen/qwen3.5-122b-a10b" 
        },
        backup: { 
            url: "https://api.siliconflow.cn/v1", 
            apiKeyEnv: "SILICONFLOW_KEY", 
            model: "Qwen/Qwen2.5-7B-Instruct" 
        },
        priceInput: 0, 
        priceOutput: 0
    },
    silver: { 
        url: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_KEY",
        model: "deepseek-chat",
        priceInput: 0.00015,  
        priceOutput: 0.00030 
    },
    gold: { 
        url: "https://api.deepseek.com/v1",
        apiKeyEnv: "DEEPSEEK_KEY",
        model: "deepseek-reasoner",
        priceInput: 0.0015, 
        priceOutput: 0.0030 
    }
};

// ==================== 2. 工具函数 ====================

function corsHeaders() {
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Auth-Token, X-Cloud-Card-Id",
        "Access-Control-Max-Age": "86400",
    };
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

function countTokens(text) {
    if (!text) return 0;
    let tokens = 0;
    for (let i = 0; i < text.length; i++) {
        const charCode = text.charCodeAt(i);
        tokens += (charCode > 255) ? 0.8 : 0.3;
    }
    return Math.ceil(tokens);
}

function errorResponse(msg, status = 500, detail = null) {
    return new Response(JSON.stringify({ error: msg, detail }), {
        status,
        headers: { ...corsHeaders(), "Content-Type": "application/json" }
    });
}

// ==================== 3. 数据库服务层 ====================

async function getAdminToken(env) {
    const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
    const credentials = { identity: env.PB_ADMIN_EMAIL, password: env.PB_ADMIN_PASSWORD };
    
    // 尝试新版超级用户接口
    const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
        keepalive: true
    });
    
    if (res.ok) return (await res.json()).token;

    // 尝试老版本接口
    const resOld = await fetch(`${pbUrl}/api/collections/admins/auth-with-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials),
        keepalive: true
    });
    
    if (resOld.ok) return (await resOld.json()).token;
    throw new Error("PocketBase 身份验证失败");
}

async function updateBalance(env, userId, newBalance, maxRetries = 3) {
    const pbUrl = env.PB_URL.replace(/\/$/, "");
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const adminToken = await getAdminToken(env);
            const res = await fetch(`${pbUrl}/api/collections/users/records/${userId}`, {
                method: "PATCH",
                headers: {
                    "Authorization": `Bearer ${adminToken}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ coins: newBalance }),
                keepalive: true // 极其重要：确保后台任务在连接断开后继续完成
            });
            if (res.ok) return; // 成功，退出
            const errText = await res.text().catch(() => "");
            console.error(`更新余额失败 (attempt ${attempt}/${maxRetries}): HTTP ${res.status} ${errText}`);
        } catch (e) {
            console.error(`更新余额异常 (attempt ${attempt}/${maxRetries}):`, e.message);
        }
        if (attempt < maxRetries) {
            // 指数退避：500ms, 1000ms
            await new Promise(r => setTimeout(r, 500 * attempt));
        }
    }
    console.error(`更新余额最终失败，用户 ${userId}，目标余额 ${newBalance}`);
}

// ==================== 4. 核心逻辑控制 ====================

export default {
    async fetch(request, env, ctx) {
        if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders() });

        const url = new URL(request.url);

        try {
            // 路由：AI 对话
            if (url.pathname === "/chat/completions") {
                const cloudCardId = request.headers.get("X-Cloud-Card-Id") || "free";
                const userAuthToken = request.headers.get("X-Auth-Token");
                const cardConfig = CLOUD_CARD_CONFIGS[cloudCardId];

                if (!cardConfig) return errorResponse("无效的云卡 ID", 400);

                // 1. 所有云卡都需要登录
                if (!userAuthToken) return errorResponse("请先登录", 401);
                const pbUrl = (env.PB_URL || "").replace(/\/$/, "");
                const authRes = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
                    method: "POST",
                    headers: { "Authorization": userAuthToken.startsWith("Bearer ") ? userAuthToken : `Bearer ${userAuthToken}` }
                });
                if (!authRes.ok) return errorResponse("会话已过期", 401);
                const authData = await authRes.json();
                const userId = authData.record.id;
                const userCoins = Number(authData.record.coins || 0);

                // 付费卡才检查余额
                if ((cardConfig.priceInput > 0 || cardConfig.priceOutput > 0) && userCoins <= 0) {
                    return errorResponse("余额不足，请充值", 402);
                }

                // 2. 解析请求
                const bodyText = await request.text();
                let requestJson = safeJsonParse(bodyText);
                const isStream = requestJson.stream === true;
                const inputTokens = countTokens(JSON.stringify(requestJson.messages));

                // 3. 定义下游调用逻辑 (带超时控制)
                const callAI = async (target) => {
                    const apiKey = target.apiKey || env[target.apiKeyEnv];
                    const base = target.url.replace(/\/$/, "");
                    
                    const controller = new AbortController();
                    // 流式请求：60s 超时保护连接建立阶段，连接成功后清除（流传输由 Cloudflare 30s CPU 限制兜底）
                    // 非流式请求：120s 等待完整响应（初始化解析等大模型完整响应场景）
                    const timeoutMs = isStream ? 60000 : 120000;
                    const timeout = setTimeout(() => controller.abort(), timeoutMs);

                    try {
                        const payload = { ...requestJson, model: target.model };
                        const response = await fetch(`${base}/chat/completions`, {
                            method: "POST",
                            headers: { 
                                "Authorization": `Bearer ${apiKey}`, 
                                "Content-Type": "application/json" 
                            },
                            body: JSON.stringify(payload),
                            signal: controller.signal
                        });
                        // 连接建立后清除超时：流式响应由客户端读取，非流式响应已完整返回
                        clearTimeout(timeout);
                        return response;
                    } catch (e) {
                        clearTimeout(timeout);
                        throw e;
                    }
                };

                // 4. 执行调用与重试（primary 超时也触发 backup）
                let aiResponse;
                if (cloudCardId === "free") {
                    try {
                        aiResponse = await callAI(cardConfig.primary);
                        if (!aiResponse.ok) throw new Error(`primary ${aiResponse.status}`);
                    } catch (primaryErr) {
                        console.warn("free primary 失败，切换 backup:", primaryErr.message);
                        try {
                            aiResponse = await callAI(cardConfig.backup);
                            if (!aiResponse.ok) {
                                console.warn("free backup 也返回非 2xx:", aiResponse.status);
                            }
                        } catch (backupErr) {
                            return errorResponse("服务暂时不可用，请稍后重试", 503, backupErr.message);
                        }
                    }
                } else {
                    aiResponse = await callAI(cardConfig);
                }
                if (!aiResponse.ok) {
                    return new Response(await aiResponse.text(), { status: aiResponse.status, headers: corsHeaders() });
                }

                // 5. 计费响应处理
                if (isStream) {
                    const isPaidCard = cardConfig.priceInput > 0 || cardConfig.priceOutput > 0;
                    if (isPaidCard) {
                        const [clientStream, billingStream] = aiResponse.body.tee();
                        ctx.waitUntil(processStreamingBilling(env, userId, userCoins, cardConfig, inputTokens, billingStream));
                        return new Response(clientStream, {
                            headers: { ...corsHeaders(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
                        });
                    } else {
                        return new Response(aiResponse.body, {
                            headers: { ...corsHeaders(), "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }
                        });
                    }
                } else {
                    const resJson = await aiResponse.json();
                    if (cardConfig.priceInput > 0 || cardConfig.priceOutput > 0) {
                        const outTokens = resJson.usage?.completion_tokens || countTokens(resJson.choices[0]?.message?.content || "");
                        const cost = (inputTokens * cardConfig.priceInput) + (outTokens * cardConfig.priceOutput) + 0.001;
                        ctx.waitUntil(updateBalance(env, userId, Math.max(0, userCoins - cost)));
                    }
                    return new Response(JSON.stringify(resJson), {
                        headers: { ...corsHeaders(), "Content-Type": "application/json" }
                    });
                }
            }

            // 路由：卡密兑换
            if (url.pathname === "/api/redeem" && request.method === "POST") {
                const userAuthToken = request.headers.get("X-Auth-Token");
                if (!userAuthToken) return errorResponse("请先登录", 401);
                const { code } = await request.json();
                if (!code) return errorResponse("请输入卡密", 400);
                // 严格校验：只允许字母和数字，防止 filter 注入
                if (!/^[A-Za-z0-9]{1,32}$/.test(code)) return errorResponse("卡密格式无效", 400);

                const adminToken = await getAdminToken(env);
                const pbUrl = env.PB_URL.replace(/\/$/, "");

                const authRes = await fetch(`${pbUrl}/api/collections/users/auth-refresh`, {
                    method: "POST",
                    headers: { "Authorization": userAuthToken.startsWith("Bearer ") ? userAuthToken : `Bearer ${userAuthToken}` }
                });
                if (!authRes.ok) return errorResponse("权限验证失败", 401);
                const userData = await authRes.json();

                const cdkQuery = await fetch(`${pbUrl}/api/collections/cdks/records?filter=(code='${encodeURIComponent(code)}'%26%26used=false)`, {
                    headers: { "Authorization": `Bearer ${adminToken}` }
                });
                const cdkData = await cdkQuery.json();

                if (!cdkData.items.length) return errorResponse("卡密无效或已使用", 400);
                const cdk = cdkData.items[0];

                // 先标记卡密已使用（防止并发重复兑换）
                const markRes = await fetch(`${pbUrl}/api/collections/cdks/records/${cdk.id}`, {
                    method: "PATCH",
                    headers: { "Authorization": `Bearer ${adminToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ used: true, used_by: userData.record.id }),
                });
                if (!markRes.ok) return errorResponse("卡密兑换失败，请重试", 500);

                // 再加余额（用数据库当前值做增量，避免覆盖并发写入）
                const latestUserRes = await fetch(`${pbUrl}/api/collections/users/records/${userData.record.id}`, {
                    headers: { "Authorization": `Bearer ${adminToken}` }
                });
                const latestUser = await latestUserRes.json();
                await fetch(`${pbUrl}/api/collections/users/records/${userData.record.id}`, {
                    method: "PATCH",
                    headers: { "Authorization": `Bearer ${adminToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ coins: (latestUser.coins || 0) + cdk.value }),
                    keepalive: true
                });

                return new Response(JSON.stringify({ success: true, addedCoins: cdk.value }), {
                    headers: { ...corsHeaders(), "Content-Type": "application/json" }
                });
            }

            return errorResponse("Not Found", 404);

        } catch (e) {
            return errorResponse("Worker Error", 500, e.message);
        }
    }
};

// ==================== 5. 异步流计费核心 (已增强兼容性) ====================

async function processStreamingBilling(env, userId, oldBalance, cardConfig, inputTokens, responseStream) {
    const reader = responseStream.getReader();
    const decoder = new TextDecoder();
    let totalOutputTokens = 0;
    let remainder = ""; // 处理被截断的 SSE 行

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = remainder + decoder.decode(value, { stream: true });
            const lines = chunk.split("\n");
            
            // 最后一项可能不完整，存入 remainder 等待下一块
            remainder = lines.pop() || "";

            for (let line of lines) {
                line = line.trim();
                if (!line || line === "data: [DONE]") continue;
                if (line.startsWith("data: ")) {
                    try {
                        const json = JSON.parse(line.substring(6));
                        const delta = json.choices?.[0]?.delta || {};
                        
                        // --- 关键修改点：同时统计 content 和 reasoning_content ---
                        const content = delta.content || "";
                        const reasoning = delta.reasoning_content || ""; // DeepSeek R1 专用字段
                        
                        if (content || reasoning) {
                            // 增量统计 Token，确保思维链产生的消耗也被计算
                            totalOutputTokens += countTokens(content + reasoning);
                        }
                        // -------------------------------------------------------
                        
                    } catch (e) {
                        // 忽略行解析错误
                    }
                }
            }
        }

        // 处理最后剩余的 remainder
        if (remainder.startsWith("data: ") && remainder !== "data: [DONE]") {
            try {
                const json = JSON.parse(remainder.substring(6));
                const delta = json.choices?.[0]?.delta || {};
                const content = delta.content || "";
                const reasoning = delta.reasoning_content || "";
                if (content || reasoning) {
                    totalOutputTokens += countTokens(content + reasoning);
                }
            } catch (e) {}
        }

        const finalOutputTokens = totalOutputTokens || 1;
        // 计算总成本：(输入Token * 进价) + (输出总Token * 出价) + 固定手续费
        const cost = (inputTokens * cardConfig.priceInput) + (finalOutputTokens * cardConfig.priceOutput) + 0.001;
        
        // 打印日志以便在 Cloudflare 控制台调试 (可选)
        console.log(`用户 ${userId} 计费详情: 输入 ${inputTokens}, 输出 ${finalOutputTokens}, 扣费 ${cost.toFixed(6)}`);

        await updateBalance(env, userId, Math.max(0, oldBalance - cost));
        
    } catch (e) {
        console.error("流计费异常停止:", e.message);
    } finally {
        reader.releaseLock();
    }
}