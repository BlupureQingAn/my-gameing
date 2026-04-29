#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""找出 JS 中花括号不平衡的位置"""
import re

with open("index.html", encoding="utf-8") as f:
    content = f.read()

# 提取 <script> 内容及其起始行号
lines = content.split('\n')
in_script = False
script_lines = []  # (line_number, line_text)
for i, line in enumerate(lines, 1):
    if '<script>' in line:
        in_script = True
        continue
    if '</script>' in line:
        in_script = False
        continue
    if in_script:
        script_lines.append((i, line))

# 追踪括号深度，忽略字符串和注释中的括号
depth = 0
last_open_pos = []  # stack of (line_num, depth_before)

# 简单追踪（不处理字符串内部，但足够定位问题）
for line_num, line in script_lines:
    for ch in line:
        if ch == '{':
            last_open_pos.append((line_num, depth))
            depth += 1
        elif ch == '}':
            depth -= 1
            if last_open_pos:
                last_open_pos.pop()

print(f"最终深度: {depth}")
print(f"未闭合的 {{ 数量: {len(last_open_pos)}")
if last_open_pos:
    print("最后几个未闭合的 { 位置:")
    for ln, d in last_open_pos[-5:]:
        # 打印该行内容
        orig_line = lines[ln - 1]
        print(f"  行 {ln} (深度{d}): {orig_line.strip()[:80]}")
