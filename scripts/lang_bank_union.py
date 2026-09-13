# -*- coding: utf-8 -*-
"""五档词库累积并集脚本(M6d1c,可复跑)

问题:六级/托福源文件本身不是全表(六级 xlsx 2220 精选、TOEFL.txt 4510 核心),
导致高档词库反而比低档少(六级 2219 < 四级 4536、托福 4510 < 考研 5529)。

口径(小徐 2026-09-13 定):四级、考研保留各自大纲原貌作底,六级起高档包含低档全部词——
  cet6  = cet4 ∪ cet6   -> 5713
  ky    = cet6 ∪ ky     -> 6277
  toefl = ky   ∪ toefl  -> 8128
同名重复本档释义优先(卡档即本档,考纲徽标与嵌词都按本档走);ph/frq/bnc/al 等 enrich
字段随所属条目携带,不重算。hs/cet4 两档不动。

用法:
  py scripts/lang_bank_union.py          仅本地并集,原地写回 OUT_DIR/*.json(打印对账)
  py scripts/lang_bank_union.py push     并集后只重建 cet6/ky/toefl 三档(PB)
  py scripts/lang_bank_build.py check    回读 PB 对账(应显示三档 PASS)

前置:须先跑 lang_bank_build.py clean + lang_bank_enrich.py(本脚本消费已补字段的产物)。
"""
import os, sys, json

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

OUT_DIR = r"F:\Claude\lang_bank_out"
STEPS = [("cet6", ["cet4", "cet6"]), ("ky", ["cet6", "ky"]), ("toefl", ["ky", "toefl"])]
TOUCHED = [b for b, _ in STEPS]


def load_band(band):
    with open(os.path.join(OUT_DIR, band + ".json"), "r", encoding="utf-8") as f:
        return json.load(f)


def union_band(band, sources):
    """按 sources 顺序合并(后者=本档,同词覆盖前者);结果按词形字母序。"""
    merged = {}
    for src in sources:
        data = load_band(src)
        for it in data["items"]:
            w = it.get("w")
            if not w:
                continue
            merged[w] = it
    items = [merged[w] for w in sorted(merged)]
    return items


def do_union():
    report = {}
    for band, sources in STEPS:
        before = load_band(band)["total"]
        items = union_band(band, sources)
        with open(os.path.join(OUT_DIR, band + ".json"), "w", encoding="utf-8") as f:
            json.dump({"band": band, "total": len(items), "items": items}, f, ensure_ascii=False)
        report[band] = (before, len(items))
        print(f"union {band}: {before} -> {len(items)}   (来源 {' ∪ '.join(sources)})")
    print("--- 五档总览 ---")
    for b in ["hs", "cet4", "cet6", "ky", "toefl"]:
        d = load_band(b)
        with_ph = sum(1 for i in d["items"] if i.get("ph"))
        with_al = sum(1 for i in d["items"] if i.get("al"))
        print(f"  {b:6s} total={d['total']:5d}  音标={with_ph:5d}  词形={with_al:5d}")
    return report


if __name__ == "__main__":
    do_union()
    if len(sys.argv) > 1 and sys.argv[1] == "push":
        import lang_bank_build as B
        B.push_all(TOUCHED)
