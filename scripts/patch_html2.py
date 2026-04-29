#!/usr/bin/env python3
# -*- coding: utf-8 -*-
with open("index.html", encoding="utf-8") as f:
    lines = f.readlines()

# 找到要删除的行范围
start_marker = '当前卡片独立 API'
end_marker = 'card-api-model'

out = []
skip = False
for line in lines:
    if start_marker in line:
        skip = True
    if skip:
        if end_marker in line:
            skip = False  # 这行也跳过
            continue
        continue
    out.append(line)

with open("index.html", "w", encoding="utf-8") as f:
    f.writelines(out)

print(f"原始行数: {len(lines)}, 修改后: {len(out)}, 删除: {len(lines)-len(out)} 行")
