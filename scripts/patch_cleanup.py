#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import re

with open("index.html", encoding="utf-8") as f:
    content = f.read()

original_len = len(content)

# 移除已无用的辅助函数
for func_pattern in [
    r'\s*function isProxyNetworkError\(err\) \{[^}]+\}',
    r'\s*function isRetryableProxyError\(err\) \{[^}]+\}',
    r'\s*function stripProxyHeaders\(headers = \{\}\) \{.*?\}(?=\s*function)',
    r'\s*function formatRequestError\(err, phaseLabel, endpointLabel\) \{[^}]+\}',
]:
    content = re.sub(func_pattern, '', content, flags=re.DOTALL)

print(f"原始大小: {original_len} 字符")
print(f"修改后大小: {len(content)} 字符")
print(f"减少: {original_len - len(content)} 字符")

with open("index.html", "w", encoding="utf-8") as f:
    f.write(content)

print("清理完成")
