#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
修复所有残留的 !config.key / !apiConfig.key 检查，
以及 buildHeaders 中已无用的自定义 API 分支
"""
with open("index.html", encoding="utf-8") as f:
    content = f.read()

original_len = len(content)

# ── 1. NPC 对话的 apiConfig 检查 ─────────────────────────────────────────────
content = content.replace(
    'if (apiConfig.blocked || !apiConfig.upstreamUrl || !apiConfig.key || !apiConfig.model) {\n                throw new Error("未配置可用 AI-API，无法进行 NPC 对话。");\n            }',
    'if (apiConfig.blocked || !apiConfig.model) {\n                throw new Error("请先在设置页选择云卡，无法进行 NPC 对话。");\n            }'
)

# ── 2. buildInitPlan 的 apiConfig 检查 ───────────────────────────────────────
content = content.replace(
    'if (apiConfig.blocked || !apiConfig.upstreamUrl || !apiConfig.key || !apiConfig.model) {\n                throw new Error("未配置可用 AI-API，无法进行开局初始化解析。");\n            }',
    'if (apiConfig.blocked || !apiConfig.model) {\n                throw new Error("请先在设置页选择云卡，无法进行开局初始化解析。");\n            }'
)

# ── 3. InitIntroService 的 apiConfig 检查 ────────────────────────────────────
content = content.replace(
    '            if (!apiConfig.upstreamUrl || !apiConfig.key || !apiConfig.model) return;',
    '            if (!apiConfig.model) return;'
)

# ── 4. ChatService.requestAI 的 config 检查 ──────────────────────────────────
content = content.replace(
    '            if (!config.upstreamUrl || !config.key || !config.model) {\n                NoticeModalService.showInfo({ title: "配置不完整", descHtml: "请先配置上游 API URL、API Key 和模型名。" });\n                return;\n            }',
    '            if (!config.model) {\n                NoticeModalService.showInfo({ title: "配置不完整", descHtml: "请先在设置页选择云卡。" });\n                return;\n            }'
)

# ── 5. buildHeaders: 移除自定义 API 分支（现在只有云卡模式）────────────────────
import re
old_build_headers = re.search(
    r'function buildHeaders\(config\) \{.*?\}(?=\s*function buildExtraBody)',
    content,
    flags=re.DOTALL
)
if old_build_headers:
    new_build_headers = '''function buildHeaders(config) {
            // 云卡模式：key 由 Worker 注入，前端只传云卡 ID 和用户 token
            return {
                "Content-Type": "application/json",
                "X-Cloud-Card-Id": config.cloudCard?.id || "free",
                "X-Auth-Token": AuthService.getToken()
            };
        }'''
    content = content[:old_build_headers.start()] + new_build_headers + content[old_build_headers.end():]
    print("buildHeaders 已简化")
else:
    print("WARNING: buildHeaders 未找到")

# ── 6. 移除 buildDirectFetchUrl（云卡模式不直连）────────────────────────────
content = re.sub(
    r'\s*function buildDirectFetchUrl\(config\) \{[^}]+\}',
    '',
    content
)

print(f"原始大小: {original_len} 字符")
print(f"修改后大小: {len(content)} 字符")
print(f"减少: {original_len - len(content)} 字符")

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("检查修复完成")
