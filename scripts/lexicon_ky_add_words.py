# -*- coding: utf-8 -*-
"""向 ky 源快照补入 mahavivo NPEE 缺失的大纲词，释义/音标取自 ECDICT。

用法:
    py scripts/lexicon_ky_add_words.py            # 写入 src/ky.json（自动备份）
    py scripts/lexicon_ky_add_words.py --dry-run  # 只打印
"""
import argparse
import csv
import json
import re
import shutil
import time
from pathlib import Path

SRC = Path(r"F:\Claude\lexicon_build\src\ky.json")
ECDICT = Path(r"F:\Claude\lexicon_build\raw\tier_sources\ecdict.csv")
BACKUP_DIR = Path(r"F:\Claude\lexicon_build\backup")

ADD_WORDS = """abatement acrobat amplifier attendance axe bacterium blackmail capitalism
caress chap compensation daytime disgrace doctorate gallop highland housing jeans kilo
madame meditate memo moss photo piston prick ruby seaside sham tar tv vowel waitress
elderly replacement proceeding""".split()

OVERRIDES = {
    "acrobat": "n. 杂技演员，特技演员",
    "amplifier": "n. 放大器，扩音器",
    "chap": "n. 小伙子，家伙",
    "elderly": "a. 年长的，上了年纪的",
    "housing": "n. 住房，住房供给",
    "kilo": "n. 千克，公斤",
    "meditate": "v. 冥想，沉思，考虑",
    "photo": "n. 照片，相片",
    "proceeding": "n. 程序，诉讼程序",
    "replacement": "n. 更换，代替者",
    "tar": "n. 焦油，柏油",
    "tv": "n. 电视",
}

BACKSLASH_N = chr(92) + "n"
POS_RE = re.compile(r"^((?:n|v|vt|vi|adj|adv|a|ad|prep|conj|pron|num|art|int|aux|pl|abbr)\.)")


def clean_zh(translation, max_chars=26, max_senses=3):
    if not translation:
        return ""
    lines = [
        line.strip()
        for line in translation.replace(BACKSLASH_N, "\n").split("\n")
        if line.strip() and not line.strip().startswith("[")
    ]
    if not lines:
        return ""
    line = lines[0].replace(", ", "，").replace(",", "，").replace("; ", "；").replace(";", "；")
    match = POS_RE.match(line)
    pos = match.group(1) if match else ""
    body = line[len(pos):].strip()
    senses = []
    for sense in re.split(r"[，；]", body):
        sense = sense.strip()
        if not sense:
            continue
        if senses and len("，".join(senses + [sense])) > max_chars:
            break
        senses.append(sense)
        if len(senses) >= max_senses:
            break
    text = "，".join(senses)
    return f"{pos} {text}".strip() if text else line[:max_chars]


def forms_of(exchange):
    forms = []
    for token in (exchange or "").split("/"):
        if ":" not in token:
            continue
        kind, value = token.split(":", 1)
        if kind in {"0", "1"}:
            continue
        if value and value.lower() not in forms:
            forms.append(value.lower())
    return forms


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    data = json.loads(SRC.read_text(encoding="utf-8"))
    existing = {item["w"].lower(): item for item in data["items"]}
    wanted = {w.lower() for w in ADD_WORDS}
    missing = sorted(wanted - set(existing))

    rows = {}
    with ECDICT.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            word = (row.get("word") or "").lower()
            if word in missing:
                rows[word] = row

    added, skipped = [], []
    for word in missing:
        row = rows.get(word)
        if not row:
            skipped.append((word, "ECDICT 无词条"))
            continue
        zh = OVERRIDES.get(word) or clean_zh(row.get("translation") or "")
        if not zh:
            skipped.append((word, "ECDICT 无中文释义"))
            continue
        item = {
            "w": word,
            "zh": zh,
            "ph": (row.get("phonetic") or "").strip(),
            "bnc": int(row["bnc"]) if (row.get("bnc") or "").isdigit() else 0,
            "frq": int(row["frq"]) if (row.get("frq") or "").isdigit() else 0,
        }
        forms = forms_of(row.get("exchange") or "")
        if forms:
            item["al"] = forms
        data["items"].append(item)
        added.append((word, zh))

    data["total"] = len(data["items"])
    print(f"add {len(added)} words, skip {len(skipped)}")
    for word, zh in added:
        print(f"  + {word:14} {zh}")
    for word, reason in skipped:
        print(f"  ! {word:14} {reason}")

    if args.dry_run:
        print("dry-run: 未写入")
        return
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    shutil.copy2(SRC, BACKUP_DIR / f"ky_before_add_{stamp}.json")
    SRC.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"written: {SRC} total={data['total']}")


if __name__ == "__main__":
    main()
