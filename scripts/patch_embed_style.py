"""
把 EMBED_STYLE 里的 wy-stat-bar-* 类名替换为 data-wy-stat 属性选择器
"""
import pathlib, sys

src = pathlib.Path("index.html").read_text(encoding="utf-8")

replacements = [
    (".wenyou-card .wy-stat-bar-item{", ".wenyou-card [data-wy-stat='item']{"),
    (".wenyou-card .wy-stat-bar-header{", ".wenyou-card [data-wy-stat='header']{"),
    (".wenyou-card .wy-stat-bar-label{", ".wenyou-card [data-wy-stat='label']{"),
    (".wenyou-card .wy-stat-bar-value{", ".wenyou-card [data-wy-stat='value']{"),
    (".wenyou-card .wy-stat-bar-track{", ".wenyou-card [data-wy-stat='track']{"),
    (".wenyou-card .wy-stat-bar-fill{", ".wenyou-card [data-wy-stat='fill']{"),
]

for old, new in replacements:
    count = src.count(old)
    if count == 0:
        print(f"WARNING: not found: {old}")
    else:
        src = src.replace(old, new)
        print(f"✓ replaced {count}x: {old[:50]}")

pathlib.Path("index.html").write_text(src, encoding="utf-8")
print("Done.")
