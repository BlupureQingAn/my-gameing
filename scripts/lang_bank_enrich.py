# -*- coding: utf-8 -*-
"""五档词库 ECDICT 辅助层·补字段脚本(M6d1b,可复跑)

读 ecdict.csv(770611 词条)建小写词索引,为 OUT_DIR 五档 JSON 补:
  ph  -> 缺失音标的词补 ECDICT 英式音标(hs/cet6/ky 源文件无音标)
  frq -> 当代语料库词频(小=常见),bnc -> 英国国家语料库词频(小=常见)

用法:
  py scripts/lang_bank_enrich.py           补字段后原地写回 OUT_DIR/*.json
  py scripts/lang_bank_build.py push check 灌入 PocketBase 并回读对账

ECDICT 词条同名多行(不同词性)时取文件序首条;词频 0/空视为未知不写。
"""
import os, re, json, csv, sys, time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

OUT_DIR = r"F:\Claude\lang_bank_out"
ECDICT = r"F:\Claude\ecdict\ecdict.csv"
BANDS = ["hs", "cet4", "cet6", "ky", "toefl"]


def load_ecdict(path):
    """word.lower() -> (phonetic, frq, bnc);同名首条优先;跳过词组/超长拼写。"""
    idx = {}
    t0 = time.time()
    with open(path, "r", encoding="utf-8", newline="") as f:
        r = csv.reader(f)
        header = next(r)
        for row in r:
            if not row:
                continue
            w = row[0]
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9'\-]*", w):
                continue  # 词组/缩写/特殊字符词条不参与补字段
            key = w.lower()
            if key in idx:
                continue
            ph = (row[1] or "").strip()
            frq, bnc = 0, 0
            try:
                frq = int(row[9]) if row[9] else 0
                bnc = int(row[8]) if row[8] else 0
            except ValueError:
                pass
            idx[key] = (ph, frq, bnc)
    print(f"ECDICT 索引载入 {len(idx)} 词({time.time()-t0:.1f}s)")
    return idx


def enrich_band(band, idx):
    path = os.path.join(OUT_DIR, band + ".json")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    n_ph = n_frq = n_bnc = 0
    for it in data["items"]:
        w = it.get("w", "")
        e = idx.get(w)
        if not e:
            continue
        ph, frq, bnc = e
        if ph and not it.get("ph"):
            it["ph"] = ph
            n_ph += 1
        if frq and not it.get("frq"):
            it["frq"] = frq
            n_frq += 1
        if bnc and not it.get("bnc"):
            it["bnc"] = bnc
            n_bnc += 1
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    return n_ph, n_frq, n_bnc, len(data["items"])


if __name__ == "__main__":
    idx = load_ecdict(ECDICT)
    for band in BANDS:
        n_ph, n_frq, n_bnc, total = enrich_band(band, idx)
        print(f"enrich {band}: {total} 词,补音标 {n_ph} / 补frq {n_frq} / 补bnc {n_bnc}")
