# -*- coding: utf-8 -*-
r"""日/韩词库 QC 清洗(2026-09-19,可复跑):就地重写 F:\Claude\lang_bank_out\*.json

处理四类实测缺陷:
  ① 韩语释义繁体(源 HF korean-vocabulary-5000 是 zh-TW)→ opencc t2s
  ② 罗马音混入西里尔字母(daieteо/Gatollик/Yeonguја/Peosентeu)→ 剔除非 ASCII
  ③ 日语词形是 openjlpt 的「异形并记」写法(川/河、いい/よい、见る 観る)→ 取首形、去括注
  ④ 非日文字符污染的条目(Ͼ立)→ 整条丢弃
"""
import json, io, os, re, sys

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, r"C:\Users\1\AppData\Local\Programs\Python\Python312\Lib\site-packages")
from opencc import OpenCC

D = r"F:\Claude\lang_bank_out"
JA = ["ja-n5", "ja-n4", "ja-n3", "ja-n2", "ja-n1"]
KO = ["ko-1", "ko-2", "ko-3"]
cc = OpenCC("t2s")

JA_OK = re.compile(r"^[ぁ-ゖァ-ヺー一-鿿々〆ヶ]+$")
KO_OK = re.compile(r"^[가-힣]+$")


def clean_ja_w(w):
    w = re.sub(r"[（(][^）)]*[）)]", "", w)      # 去括注
    w = re.split(r"\s*/\s*", w)[0]              # 异形并记取首形
    w = re.split(r"[\s、,，]", w.strip())[0]
    return w.strip()


stat = {}
for b in JA + KO:
    p = os.path.join(D, b + ".json")
    data = json.load(io.open(p, encoding="utf-8"))
    out, drop, conv = [], 0, 0
    for x in data["items"]:
        w, ph, zh = x["w"], x.get("ph", ""), x["zh"]
        if b.startswith("ja"):
            w2 = clean_ja_w(w)
            if not JA_OK.match(w2):
                drop += 1
                continue
            w = w2
        else:
            if w.startswith("-"):                # 词缀碎片(如 -소)
                drop += 1
                continue
            w2 = re.sub(r"[（(][^）)]*[）)]", "", w).strip()
            if not KO_OK.match(w2):
                drop += 1
                continue
            w = w2
            ph = re.sub(r"[^A-Za-z0-9 \-']", "", ph).strip()   # ②剔非 ASCII
        zh2 = cc.convert(zh)
        if zh2 != zh:
            conv += 1
        out.append({"w": w, "ph": ph, "zh": zh2})
    # 同档内清洗后可能撞形 → 去重保首
    seen, uniq = set(), []
    for x in out:
        if x["w"] in seen:
            drop += 1
            continue
        seen.add(x["w"])
        uniq.append(x)
    data["items"], data["total"] = uniq, len(uniq)
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    stat[b] = {"原": len(seen) + drop, "留": len(uniq), "丢": drop, "繁转简": conv}
    print(f"  {b}: 留 {len(uniq)} / 丢 {drop} / 繁转简 {conv}")

print("总计:", sum(v["留"] for v in stat.values()), "词;丢弃", sum(v["丢"] for v in stat.values()), ";繁转简", sum(v["繁转简"] for v in stat.values()))
