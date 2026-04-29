#!/usr/bin/env python3
# -*- coding: utf-8 -*-
with open("index.html", encoding="utf-8") as f:
    content = f.read()

# ── 修复 1：purgeCardRuntimeData 的 try 块结构破损 ────────────────────────────
# 正则把 "// 4) 删除卡片级 API..." 那段删掉时，连带删掉了 try 的闭合 }，
# 留下了 "} catch (e) {" 悬空
bad1 = (
    '                    StorageService.writeJson(AppConfig.storageKeys.scenarioPlayMetaMap, playMetaMap);\n'
    '                } catch (e) {\n'
    '            }\n'
    '        }\n'
    '        function createCard()'
)
good1 = (
    '                    StorageService.writeJson(AppConfig.storageKeys.scenarioPlayMetaMap, playMetaMap);\n'
    '                }\n'
    '\n'
    '                // 5) 删除卡片级 ChatPolicy 映射\n'
    '                const policyMap = StorageService.readJson(AppConfig.storageKeys.scenarioChatPolicyMap, {});\n'
    '                if (policyMap && typeof policyMap === "object" && policyMap[id]) {\n'
    '                    delete policyMap[id];\n'
    '                    StorageService.writeJson(AppConfig.storageKeys.scenarioChatPolicyMap, policyMap);\n'
    '                }\n'
    '            } catch (e) {\n'
    '            }\n'
    '        }\n'
    '        function createCard()'
)
if bad1 in content:
    content = content.replace(bad1, good1, 1)
    print("修复 1：purgeCardRuntimeData try 块 ✓")
else:
    print("修复 1：未找到目标，跳过")

# ── 修复 2：formatRequestError 残留片段 + buildFetchUrl 重复残留 ───────────────
bad2 = (
    '        }` : "网络错误";\n'
    '            const base = `[${phaseLabel}] ${endpointLabel} 失败：${statusText}`;\n'
    '            const hint = err?.message ? `\\n原因：${err.message}` : "";\n'
    '            const detail = err?.responseSnippet ? `\\n响应片段：${err.responseSnippet}` : "";\n'
    '            return `${base}${hint}${detail}`.trim();\n'
    '        }\n'
    '        function normalizeUrl(url) {\n'
    '            const value = String(url || "").trim();\n'
    '            return value.endsWith("/") ? value.slice(0, -1) : value;\n'
    '        }\n'
    '        function buildFetchUrl() {\n'
    '            const proxyBase = normalizeUrl(AppConfig.proxy.baseUrl);\n'
    '            return `${proxyBase}/chat/completions`;\n'
    '        }/chat/completions`;\n'
    '        }\n'
)
good2 = (
    '        function normalizeUrl(url) {\n'
    '            const value = String(url || "").trim();\n'
    '            return value.endsWith("/") ? value.slice(0, -1) : value;\n'
    '        }\n'
    '        function buildFetchUrl() {\n'
    '            const proxyBase = normalizeUrl(AppConfig.proxy.baseUrl);\n'
    '            return `${proxyBase}/chat/completions`;\n'
    '        }\n'
)
if bad2 in content:
    content = content.replace(bad2, good2, 1)
    print("修复 2：formatRequestError 残留 + buildFetchUrl 重复 ✓")
else:
    print("修复 2：未找到目标，尝试分步修复...")
    # 分步：先修 formatRequestError 残留
    bad2a = (
        '        }` : "网络错误";\n'
        '            const base = `[${phaseLabel}] ${endpointLabel} 失败：${statusText}`;\n'
        '            const hint = err?.message ? `\\n原因：${err.message}` : "";\n'
        '            const detail = err?.responseSnippet ? `\\n响应片段：${err.responseSnippet}` : "";\n'
        '            return `${base}${hint}${detail}`.trim();\n'
        '        }\n'
    )
    if bad2a in content:
        content = content.replace(bad2a, '', 1)
        print("  分步 2a：formatRequestError 残留 ✓")
    else:
        print("  分步 2a：未找到")

    # 再修 buildFetchUrl 重复
    bad2b = (
        '            return `${proxyBase}/chat/completions`;\n'
        '        }/chat/completions`;\n'
        '        }\n'
    )
    good2b = (
        '            return `${proxyBase}/chat/completions`;\n'
        '        }\n'
    )
    if bad2b in content:
        content = content.replace(bad2b, good2b, 1)
        print("  分步 2b：buildFetchUrl 重复 ✓")
    else:
        print("  分步 2b：未找到")

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("修复完成")
