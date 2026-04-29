#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
移除 index.html 中自定义 API 卡片相关的 JS 逻辑
"""
import re

with open("index.html", encoding="utf-8") as f:
    content = f.read()

original_len = len(content)

# ── 1. AppConfig: 移除 defaultApiCards ───────────────────────────────────────
content = re.sub(
    r',\s*defaultApiCards:\s*\[.*?\]',
    '',
    content,
    flags=re.DOTALL
)

# ── 2. AppConfig.storageKeys: 移除 api 相关 key ───────────────────────────────
for key_name in ['apiCards', 'selectedApiCardId', 'scenarioApiCardSelectionMap',
                 'apiIsolationMode', 'userApiSelectedCardMap', 'userApiCustomConfigMap']:
    content = re.sub(
        r'\s*' + key_name + r':\s*"[^"]*",?\n?',
        '\n',
        content
    )

# ── 3. 移除 IsolationScopeService ────────────────────────────────────────────
content = re.sub(
    r'\s*const IsolationScopeService = \(\(\) => \{.*?\}\)\(\);',
    '',
    content,
    flags=re.DOTALL
)

# ── 4. 移除 UserApiProfileService ────────────────────────────────────────────
content = re.sub(
    r'\s*const UserApiProfileService = \(\(\) => \{.*?\}\)\(\);',
    '',
    content,
    flags=re.DOTALL
)

# ── 5. 移除 CardScopedConfigService 中 API 相关方法，保留 ChatPolicy 方法 ──────
# 整个 CardScopedConfigService 替换为只保留 ChatPolicy 部分
old_csc = re.search(
    r'const CardScopedConfigService = \(\(\) => \{.*?return \{.*?\};\s*\}\)\(\);',
    content,
    flags=re.DOTALL
)
if old_csc:
    new_csc = '''const CardScopedConfigService = (() => {
        function getActiveScenarioId() {
            return ScenarioCardService.getSelectedId();
        }
        function loadChatPolicyMap() {
            return StorageService.readJson(AppConfig.storageKeys.scenarioChatPolicyMap, {});
        }
        function saveChatPolicyMap(map) {
            StorageService.writeJson(AppConfig.storageKeys.scenarioChatPolicyMap, map);
        }
        function getChatPolicyConfig() {
            const scenarioId = getActiveScenarioId();
            const map = loadChatPolicyMap();
            if (map && map[scenarioId]) return ChatPolicyConfigService.normalize(map[scenarioId]);
            const legacy = StorageService.readJson(AppConfig.storageKeys.chatPolicyConfig, null);
            if (legacy) return ChatPolicyConfigService.normalize(legacy);
            return ChatPolicyConfigService.normalize(null);
        }
        function setChatPolicyConfig(config) {
            const scenarioId = getActiveScenarioId();
            const map = loadChatPolicyMap();
            map[scenarioId] = ChatPolicyConfigService.normalize(config);
            saveChatPolicyMap(map);
            return map[scenarioId];
        }
        return { getChatPolicyConfig, setChatPolicyConfig };
    })();'''
    content = content[:old_csc.start()] + new_csc + content[old_csc.end():]
    print("CardScopedConfigService 已精简")
else:
    print("WARNING: CardScopedConfigService 未找到")

# ── 6. 移除 ApiCardService ────────────────────────────────────────────────────
content = re.sub(
    r'\s*const ApiCardService = \(\(\) => \{.*?\}\)\(\);',
    '',
    content,
    flags=re.DOTALL
)

# ── 7. SettingsService.loadToUI: 移除 card-api-* 赋值 ────────────────────────
content = re.sub(
    r'\s*const cardApi = selectedScenario\?\.apiConfig \|\| \{\};\s*'
    r'document\.getElementById\("card-api-url"\)\.value = cardApi\.upstreamUrl \|\| "";\s*'
    r'document\.getElementById\("card-api-key"\)\.value = cardApi\.key \|\| "";\s*'
    r'document\.getElementById\("card-api-model"\)\.value = cardApi\.model \|\| "";',
    '',
    content
)

# ── 8. SettingsService.saveFromUI: 移除 apiConfig 保存 ───────────────────────
content = re.sub(
    r'\s*const payload = \{\s*apiConfig: \{\s*upstreamUrl: document\.getElementById\("card-api-url"\)\.value\.trim\(\),\s*'
    r'key: document\.getElementById\("card-api-key"\)\.value\.trim\(\),\s*'
    r'model: document\.getElementById\("card-api-model"\)\.value\.trim\(\)\s*\}\s*\};\s*'
    r'ScenarioCardService\.updateSelectedCard\(payload\);',
    '',
    content
)

# ── 9. SettingsService.getApiConfig: 移除自定义 API 回退逻辑 ─────────────────
old_get_api = re.search(
    r'function getApiConfig\(\) \{.*?return \{ blocked: true.*?\};\s*\}',
    content,
    flags=re.DOTALL
)
if old_get_api:
    new_get_api = '''function getApiConfig() {
            const selectedCloudCardId = StorageService.readText(AppConfig.storageKeys.selectedCloudCard, "free");
            const cloudCard = AppConfig.cloudCards[selectedCloudCardId];
            if (cloudCard) {
                return { upstreamUrl: AppConfig.proxy.baseUrl, key: "", model: cloudCard.model, cloudCard };
            }
            return { blocked: true, reason: "请先在设置页面选择云卡。" };
        }'''
    content = content[:old_get_api.start()] + new_get_api + content[old_get_api.end():]
    print("getApiConfig 已精简")
else:
    print("WARNING: getApiConfig 未找到")

# ── 10. ScenarioCardControllerService.saveScenarioCard: 移除 apiConfig 保存 ──
content = re.sub(
    r',?\s*apiConfig: \{\s*upstreamUrl: document\.getElementById\("card-api-url"\)\.value\.trim\(\),\s*'
    r'key: document\.getElementById\("card-api-key"\)\.value\.trim\(\),\s*'
    r'model: document\.getElementById\("card-api-model"\)\.value\.trim\(\)\s*\}',
    '',
    content
)

# ── 11. ScenarioCardService.purgeCardRuntimeData: 移除 scenarioApiCardSelectionMap 清理 ──
content = re.sub(
    r'\s*// 4\) 删除卡片级 API 选择映射\s*'
    r'const apiMap = StorageService\.readJson\(AppConfig\.storageKeys\.scenarioApiCardSelectionMap.*?\}\s*\}',
    '',
    content,
    flags=re.DOTALL
)

# ── 12. UIRenderer.renderApiCards: 移除函数 ──────────────────────────────────
content = re.sub(
    r'\s*function renderApiCards\(\) \{.*?\}(?=\s*function|\s*return)',
    '',
    content,
    flags=re.DOTALL
)

# ── 13. UIRenderer return: 移除 renderApiCards ───────────────────────────────
content = re.sub(r',\s*renderApiCards\b', '', content)

# ── 14. Controller.renderAll: 移除 UIRenderer.renderApiCards() 调用 ──────────
content = re.sub(r'\s*UIRenderer\.renderApiCards\(\);\n?', '\n', content)

# ── 15. Controller: 移除 selectApiCard 函数 ──────────────────────────────────
content = re.sub(
    r'\s*function selectApiCard\(id\) \{.*?\}(?=\s*function|\s*return)',
    '',
    content,
    flags=re.DOTALL
)

# ── 16. Controller return: 移除 selectApiCard ────────────────────────────────
content = re.sub(r',\s*selectApiCard\b', '', content)

# ── 17. 全局函数: 移除 selectApiCard ─────────────────────────────────────────
content = re.sub(r'\s*function selectApiCard\(id\) \{ Controller\.selectApiCard\(id\); \}\n?', '\n', content)

# ── 18. NavigationVisibilityService: 移除 top-edit-card-btn 逻辑 ─────────────
content = re.sub(
    r'\s*const editBtn = document\.getElementById\("top-edit-card-btn"\);\s*'
    r'const hasSelectedCard = !!ScenarioCardService\.getSelectedCard\(\);\s*'
    r'if \(editBtn\) editBtn\.style\.display = inPlay && hasSelectedCard \? "" : "none";',
    '',
    content
)

# ── 19. Controller: 移除 openCurrentCardEditor 函数 ──────────────────────────
content = re.sub(
    r'\s*function openCurrentCardEditor\(\) \{.*?\}(?=\s*function|\s*return)',
    '',
    content,
    flags=re.DOTALL
)

# ── 20. Controller return: 移除 openCurrentCardEditor ────────────────────────
content = re.sub(r',\s*openCurrentCardEditor\b', '', content)

# ── 21. 全局函数: 移除 openCurrentCardEditor ─────────────────────────────────
content = re.sub(r'\s*function openCurrentCardEditor\(\) \{ Controller\.openCurrentCardEditor\(\); \}\n?', '\n', content)

# ── 22. ScenarioTemplateService.generateThemeWithAI: 修复 config.key 检查 ────
content = content.replace(
    'if (config.blocked || !config.upstreamUrl || !config.key || !config.model) {\n                throw new Error("未配置可用 AI-API，无法生成美化卡片模板。");\n            }',
    'if (config.blocked || !config.model) {\n                throw new Error("请先在设置页选择云卡，无法生成美化卡片模板。");\n            }'
)

print(f"原始大小: {original_len} 字符")
print(f"修改后大小: {len(content)} 字符")
print(f"减少: {original_len - len(content)} 字符")

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("JS 修改完成")
