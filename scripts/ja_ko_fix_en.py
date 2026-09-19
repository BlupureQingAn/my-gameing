# -*- coding: utf-8 -*-
"""补漏:把「释义是纯英文」的词条(源自 HF 数据集 english_term 字段本就是英文)
重新过一遍 LLM 转成简体中文,就地写回 F:\\Claude\\lang_bank_out\\*.json(可复跑)"""
import sys, os, json, io, re

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, r"F:\GithubBlupure\my-bitlife-game\scripts")
import lang_bank_ja_ko as B  # noqa: E402  (复用 llm/缓存/解析)

D = B.OUT_DIR
BANDS = B.JA_BANDS + B.KO_BANDS
ASCII_ZH = re.compile(r"^[A-Za-z0-9 ,.\-()/&+':!?]+$")

for b in BANDS:
    p = os.path.join(D, b + ".json")
    data = json.load(io.open(p, encoding="utf-8"))
    need = [x for x in data["items"] if ASCII_ZH.match(x["zh"] or "")]
    if not need:
        print(f"  {b}: 无需补")
        continue
    kind = "ja" if b.startswith("ja") else "ko"
    print(f"  {b}: {len(need)} 条英文释义待转")
    got = B.fill_meanings([(b + "\x00" + x["w"], x["w"]) for x in need], kind)
    n = 0
    for x in data["items"]:
        if not ASCII_ZH.match(x["zh"] or ""):
            continue
        z = (got.get(b + "\x00" + x["w"]) or "").strip()
        if z and not ASCII_ZH.match(z):
            x["zh"] = z
            n += 1
    with io.open(p, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    left = sum(1 for x in data["items"] if ASCII_ZH.match(x["zh"] or ""))
    print(f"  {b}: 已转 {n} 条, 仍余 {left} 条")

print("完成")
