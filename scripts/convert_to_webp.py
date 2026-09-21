# -*- coding: utf-8 -*-
"""静态图统一转 WebP。

小徐 2026-09-21 定规:以后所有静态图一律 WebP(jpg/png 不再产出)。
起因:剧本库封面是生成接口直出的 1152x864 JPG,单张 1.4~1.9MB,卡片上只显示 180~400px 宽;
立绘 PNG 864x1152 单张约 1.5MB。WebP 在**原分辨率**下就能缩 12~13 倍,无需牺牲清晰度:
   封面 1818KB → 148KB(q85)    立绘 1525KB → 115KB(q90,带 alpha)

本脚本只做格式转换,不改分辨率:
  *.jpg/*.jpeg  → .webp  q_photo(默认 85)
  *.png         → .webp  q_alpha(默认 90,保留 alpha 通道)
原图默认删除,但**全部在 git 历史里**(git show <commit>:<path> 可取回),要回滚直接 git checkout。

用法:
  py scripts/convert_to_webp.py                 # 转 scenarios/covers,删原图
  py scripts/convert_to_webp.py --dry           # 只报告
  py scripts/convert_to_webp.py --keep-originals
  py scripts/convert_to_webp.py --dir some/dir
"""
import argparse
import glob
import os
import sys
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def convert(path, q_photo, q_alpha, dry):
    ext = os.path.splitext(path)[1].lower()
    out = os.path.splitext(path)[0] + ".webp"
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(path):
        return None  # 已经转过且不比原图旧
    size0 = os.path.getsize(path)
    im = Image.open(path)
    # 只看 mode 会误判:生成接口直出的封面 JPEG 带 4 通道,被 Pillow 读成 RGBA(但全不透明),
    # 会错走立绘的高质量档。必须看 alpha 极值是否真有透明像素。
    has_alpha = im.mode in ("RGBA", "LA") or (im.mode == "P" and "transparency" in im.info)
    if has_alpha:
        try:
            has_alpha = im.getchannel("A").getextrema()[0] < 255
        except Exception:
            has_alpha = False
    if has_alpha:
        im = im.convert("RGBA")
        q = q_alpha
    else:
        im = im.convert("RGB")
        q = q_photo
    if not dry:
        im.save(out, "WEBP", quality=q, method=6)
    size1 = os.path.getsize(out) if not dry else 0
    if dry:
        import io
        b = io.BytesIO()
        im.save(b, "WEBP", quality=q, method=6)
        size1 = len(b.getvalue())
    if size1 and size1 >= size0:
        print(f"  ! {os.path.basename(path):<44} webp({size1//1024}KB) 不比原图小,保留原图")
        if not dry and os.path.exists(out):
            os.remove(out)
        return None
    if not dry:
        os.remove(path)
    return (ext, size0, size1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.join(ROOT, "scenarios", "covers"))
    ap.add_argument("--q-photo", type=int, default=85)
    ap.add_argument("--q-alpha", type=int, default=90)
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--keep-originals", action="store_true")
    a = ap.parse_args()

    files = sorted(glob.glob(os.path.join(a.dir, "*.jpg")) + glob.glob(os.path.join(a.dir, "*.jpeg"))
                   + glob.glob(os.path.join(a.dir, "*.png")))
    if not files:
        print("没有待转的 jpg/png:" + a.dir)
        return
    print(f"目录 {a.dir}")
    print(f"待转 {len(files)} 个 → WebP(jpg q{a.q_photo} / png q{a.q_alpha})"
          + ("  [dry run]" if a.dry else "") + "\n")
    n = tot0 = tot1 = 0
    for f in files:
        r = convert(f, a.q_photo, a.q_alpha, a.dry)
        if not r:
            continue
        n += 1
        _, s0, s1 = r
        tot0 += s0
        tot1 += s1
        print(f"  {os.path.basename(f):<44} {s0//1024:>5}KB → {s1//1024:>4}KB")
    print(f"\n转换 {n}/{len(files)} 个: {tot0/1048576:.1f}MB → {tot1/1048576:.1f}MB"
          + (f"  ({tot0/max(tot1,1):.1f}×)" if tot1 else "") + ("  [dry run,未写盘]" if a.dry else ""))


main()
