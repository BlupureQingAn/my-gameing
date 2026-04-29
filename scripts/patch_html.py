#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
移除 index.html 中的自定义 API 相关内容
"""
import re

with open("index.html", encoding="utf-8") as f:
    content = f.read()

original_len = len(content)

# ── 1. 移除卡片编辑器中的独立 API 区块 ──────────────────────────────────────
# 从 "🔌 当前卡片独立 API" 标题到三个 input 结束
content = re.sub(
    r'\s*<div class="list-title" style="margin-top:8px;">🔌 当前卡片独立 API（可选）</div>\s*'
    r'<div class="list-sub">留空则自动使用"设置页"的用户 API</div>\s*'
    r'<input type="text" id="card-api-url"[^>]*>\s*'
    r'<input type="password" id="card-api-key"[^>]*>\s*'
    r'<input type="text" id="card-api-model"[^>]*>',
    '',
    content
)

# ── 2. 移除废弃的 view-user-api section ──────────────────────────────────────
content = re.sub(
    r'\s*<section id="view-user-api" class="view-section">.*?</section>\s*',
    '\n',
    content,
    flags=re.DOTALL
)

# ── 3. 移除废弃的 view-api-cards section ─────────────────────────────────────
content = re.sub(
    r'\s*<section id="view-api-cards" class="view-section">.*?</section>\s*',
    '\n',
    content,
    flags=re.DOTALL
)

# ── 4. 移除顶部 top-edit-card-btn 按钮 ───────────────────────────────────────
content = re.sub(
    r'\s*<button class="top-nav-btn" id="top-edit-card-btn"[^>]*>编辑当前卡</button>',
    '',
    content
)

print(f"原始大小: {original_len} 字符")
print(f"修改后大小: {len(content)} 字符")
print(f"减少: {original_len - len(content)} 字符")

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("HTML 修改完成")
