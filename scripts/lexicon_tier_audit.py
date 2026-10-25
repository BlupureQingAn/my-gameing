# -*- coding: utf-8 -*-
"""三档考纲词表交叉审计：现有快照 vs mahavivo / qwerty-learner / ECDICT tag。

用法:
    py scripts/lexicon_tier_audit.py
输出:
    F:/Claude/lexicon_build/audit/tier_audit.json
"""
import csv
import json
import re
from pathlib import Path

SRC_DIR = Path(r"F:\Claude\lexicon_build\src")
RAW_DIR = Path(r"F:\Claude\lexicon_build\raw\tier_sources")
OUT_DIR = Path(r"F:\Claude\lexicon_build\audit")
OUT_DIR.mkdir(parents=True, exist_ok=True)

BANDS = {
    "cet4": {"mahavivo": "CET4_mahavivo.txt", "qwerty": "CET4_T_qwerty.json", "tag": "cet4"},
    "cet6": {"mahavivo": "CET6_mahavivo.txt", "qwerty": "CET6_T_qwerty.json", "tag": "cet6"},
    "ky": {"mahavivo": "NPEE_mahavivo.txt", "qwerty": "KaoYan_2024_qwerty.json", "tag": "ky"},
}

WORD_RE = re.compile(r"^[A-Za-z][A-Za-z'\-]*")


def norm(w):
    return w.strip().lower()


def load_src(band):
    data = json.loads((SRC_DIR / f"{band}.json").read_text(encoding="utf-8"))
    return {norm(it["w"]): it for it in data["items"]}


def load_mahavivo(name):
    out = {}
    for line in (RAW_DIR / name).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line[0] in "(（" or len(line) <= 2:
            continue
        m = WORD_RE.match(line)
        if not m:
            continue
        word = m.group(0)
        if word.isupper() and len(word) == 1:  # 字母分组标题 A/B/C
            continue
        out[norm(word)] = line
    return out


def load_qwerty(name):
    data = json.loads((RAW_DIR / name).read_text(encoding="utf-8"))
    return {norm(it["name"]): it for it in data if it.get("name")}


def load_ecdict_tags():
    tags = {"cet4": set(), "cet6": set(), "ky": set(), "gk": set()}
    path = RAW_DIR / "ecdict.csv"
    with path.open(encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            word = norm(row.get("word") or "")
            if not word:
                continue
            for tag in (row.get("tag") or "").split():
                if tag in tags:
                    tags[tag].add(word)
    return tags


def audit_band(band, cfg, ecdict):
    src = load_src(band)
    maha = load_mahavivo(cfg["mahavivo"])
    qw = load_qwerty(cfg["qwerty"])
    ec = ecdict[cfg["tag"]]
    src_set = set(src)

    report = {
        "band": band,
        "sizes": {
            "src": len(src_set),
            "mahavivo": len(maha),
            "qwerty": len(qw),
            "ecdict": len(ec),
            "union": len(src_set | set(maha) | set(qw) | ec),
        },
        "overlap": {
            "src&maha": len(src_set & set(maha)),
            "src&qw": len(src_set & set(qw)),
            "src&ecdict": len(src_set & ec),
            "src_only": len(src_set - set(maha) - set(qw) - ec),
            "all_four": len(src_set & set(maha) & set(qw) & ec),
        },
        "missing_from_src": {
            "in_ecdict_only": sorted(ec - src_set)[:500],
            "in_maha_only": sorted(set(maha) - src_set)[:500],
            "in_qw_only": sorted(set(qw) - src_set)[:500],
            "in_all_three_not_src": sorted((set(maha) & set(qw) & ec) - src_set)[:500],
        },
        "src_not_in_ecdict": sorted(src_set - ec)[:500],
        "src_has_zh": sum(1 for v in src.values() if (v.get("zh") or "").strip()),
        "samples_maha_missing": [
            {w: maha[w] for w in sorted((set(maha) & set(qw) & ec) - src_set)[:10]}
        ],
    }
    return report


def main():
    ecdict = load_ecdict_tags()
    reports = {}
    for band, cfg in BANDS.items():
        rep = audit_band(band, cfg, ecdict)
        reports[band] = rep
        s = rep["sizes"]
        o = rep["overlap"]
        print(f"[{band}] src={s['src']} maha={s['mahavivo']} qw={s['qwerty']} "
              f"ecdict={s['ecdict']} union={s['union']}")
        print(f"   交集 src&maha={o['src&maha']} src&qw={o['src&qw']} "
              f"src&ec={o['src&ecdict']} 四源共有={o['all_four']} src独有={o['src_only']}")
        print(f"   三源共缺(应补)={len(rep['missing_from_src']['in_all_three_not_src'])} "
              f"src无ec标签={len(rep['src_not_in_ecdict'])}")
    OUT_DIR.joinpath("tier_audit.json").write_text(
        json.dumps(reports, ensure_ascii=False, indent=1), encoding="utf-8")
    print("报告:", OUT_DIR / "tier_audit.json")


if __name__ == "__main__":
    main()
