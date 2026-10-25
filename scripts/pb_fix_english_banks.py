# -*- coding: utf-8 -*-
"""修复并增强 PocketBase lang_banks 的英文五档词库。

处理内容：
  1. hs 档去除 ball1 / bear2 这类为区分同形异义而附加的数字后缀，合并成原形；
  2. 合并同档内重复词（ky / toefl 的 29 个专有名词重复项），释义、别名、词频取并集；
  3. 用 lexicon/data/banks/{band}.json 的 Datamuse 增强数据补 pos/ipa/syl/affixes/
     def/en/syn/ant/synGroup/rank/freq。原有字段 w/zh/ph/frq/bnc/al 一律保留，
     只在缺失时补充 ph（取 ipa 去掉定界符）。
  4. 写库前把原始记录备份到 F:\\Claude\\lexicon_build\\backup\\。

用法：
  py scripts/pb_fix_english_banks.py            # 只体检，不写库
  py scripts/pb_fix_english_banks.py --apply    # 备份后写库
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

PB_BASE = "https://db.blupure.cn"
CRED_PATH = r"F:\Claude\pb-admin.txt"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANKS_DIR = os.path.join(ROOT, "lexicon", "data", "banks")
SRC_DIR = r"F:\Claude\lexicon_build\src"
BACKUP_DIR = r"F:\Claude\lexicon_build\backup"
BANDS = ["hs", "cet4", "cet6", "ky", "toefl"]
MAX_PART = 150 * 1024
HOMO_RE = re.compile(r"^([a-z][a-z' -]*?)(\d+)$")


def read_cred():
    with open(CRED_PATH, encoding="utf-8") as f:
        lines = [x.strip() for x in f.read().splitlines() if x.strip()]
    if len(lines) < 2:
        raise SystemExit("凭据文件格式错误，需要两行：邮箱 / 密码")
    return lines[0], lines[1]


def pb_req(method, path, body=None, token=None):
    url = PB_BASE + path
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, json.loads(r.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode("utf-8") or "{}")
        except Exception:
            return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}


def pb_retry(method, path, body=None, token=None, tries=6):
    delay = 1.0
    for attempt in range(tries):
        st, d = pb_req(method, path, body, token=token)
        if st != 0:
            return st, d
        time.sleep(delay)
        delay = min(20, delay * 1.7)
    return st, d


def pb_token():
    email, password = read_cred()
    st, d = pb_retry("POST", "/api/collections/_superusers/auth-with-password",
                     {"identity": email, "password": password})
    if st != 200 or not d.get("token"):
        raise SystemExit("PB 认证失败: %s %s" % (st, d))
    return d["token"]


def load_src_items():
    """以云端快照为权威底稿，避免依赖当前 PB 状态（旧分片可能已部分删除）。"""
    out = {}
    for band in BANDS:
        path = os.path.join(SRC_DIR, band + ".json")
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        out[band] = list(data.get("items") or [])
    return out


def load_bank_meta():
    out = {}
    for band in BANDS:
        path = os.path.join(BANKS_DIR, band + ".json")
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        out[band] = {str(it.get("w", "")).lower(): it for it in data.get("items", [])}
    return out


def merge_zh(a, b):
    a = (a or "").strip()
    b = (b or "").strip()
    if not a:
        return b
    if not b or b in a:
        return a
    if a in b:
        return b
    return a + "；" + b


def merge_into(base, extra):
    base["zh"] = merge_zh(base.get("zh"), extra.get("zh"))
    for key in ("frq", "bnc"):
        a, b = base.get(key), extra.get(key)
        vals = [x for x in (a, b) if isinstance(x, (int, float)) and x > 0]
        if vals:
            base[key] = min(vals)
    al = []
    for src in (base.get("al"), extra.get("al")):
        if isinstance(src, list):
            for x in src:
                if x and x not in al:
                    al.append(x)
    if al:
        base["al"] = al
    if not base.get("ph") and extra.get("ph"):
        base["ph"] = extra["ph"]


def normalize_band(band, items):
    out = []
    index = {}
    merged = 0
    for raw in items:
        if not isinstance(raw, dict):
            continue
        it = dict(raw)
        w = str(it.get("w") or "").strip()
        if not w:
            continue
        m = HOMO_RE.match(w.lower())
        if m:
            w = m.group(1)
            it["w"] = w
        key = w.lower()
        if key in index:
            merge_into(index[key], it)
            merged += 1
            continue
        index[key] = it
        out.append(it)
    return out, merged


def enrich_band(band, items, meta):
    stats = {"enriched": 0, "pos": 0, "ipa": 0, "ph_filled": 0, "def": 0, "syn": 0, "ant": 0,
             "synGroup": 0, "rank": 0}
    for it in items:
        key = str(it.get("w") or "").strip().lower()
        src = meta.get(band, {}).get(key)
        if src:
            it["pos"] = src.get("pos") or it.get("pos") or []
            if src.get("ipa"):
                it["ipa"] = src["ipa"]
                if not it.get("ph"):
                    it["ph"] = src["ipa"].strip("/")
                    stats["ph_filled"] += 1
            for f in ("syl", "affixes", "syn", "ant", "synGroup", "rank"):
                if src.get(f) not in (None, [], ""):
                    it[f] = src[f]
            if src.get("def"):
                it["def"] = src["def"]
                it["en"] = src.get("en") or src["def"]
            if src.get("freq") is not None:
                it["freq"] = src["freq"]
            it["proper"] = bool(src.get("proper")) or bool(it.get("proper"))
            stats["enriched"] += 1
        if it.get("pos"):
            stats["pos"] += 1
        if it.get("ipa"):
            stats["ipa"] += 1
        if it.get("def"):
            stats["def"] += 1
        if it.get("syn"):
            stats["syn"] += 1
        if it.get("ant"):
            stats["ant"] += 1
        if it.get("synGroup") is not None:
            stats["synGroup"] += 1
        if it.get("rank") is not None:
            stats["rank"] += 1
    return stats


def fetch_records(token):
    st, d = pb_req("GET", "/api/collections/lang_banks/records?perPage=200", token=token)
    if st != 200:
        raise SystemExit("读取 lang_banks 失败: %s %s" % (st, d))
    recs = {}
    for r in d.get("items") or []:
        band = r.get("band") or ""
        if band in BANDS:
            recs.setdefault(band, []).append(r)
    for band in recs:
        recs[band].sort(key=lambda r: int(r.get("part") or 0))
    return recs


def chunk(items):
    parts, cur, size = [], [], 0
    for it in items:
        n = len(json.dumps(it, ensure_ascii=False))
        if cur and size + n > MAX_PART:
            parts.append(cur)
            cur, size = [], 0
        cur.append(it)
        size += n
    if cur:
        parts.append(cur)
    return parts


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--band", choices=BANDS, default=None, help="只处理指定档，默认全部")
    args = ap.parse_args()
    targets = [args.band] if args.band else BANDS

    token = pb_token()
    recs = fetch_records(token)
    src = load_src_items()
    meta = load_bank_meta()
    if not meta:
        raise SystemExit("未找到 lexicon/data/banks/*.json，请先运行 scripts/lexicon_build_bank.py")

    prepared = {}
    report = {}
    for band in targets:
        items, merged = normalize_band(band, src[band])
        old_total = sum(len(r.get("items") or []) for r in recs.get(band, []))
        st = enrich_band(band, items, meta)
        prepared[band] = items
        report[band] = {"before": old_total, "source": len(src[band]), "after": len(items), "merged": merged, **st}

    print(json.dumps(report, ensure_ascii=False, indent=2))

    if not args.apply:
        print("\n体检模式，未写库。确认无误后加 --apply。")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d_%H%M%S")
    backup_path = os.path.join(BACKUP_DIR, "lang_banks_en_" + stamp + ".json")
    with open(backup_path, "w", encoding="utf-8") as f:
        json.dump({"createdAt": stamp, "records": recs}, f, ensure_ascii=False)
    print("备份已写入 " + backup_path)

    # 两阶段写库：先推新分片（偏移 part=1000+），验证齐全后再删旧分片并回写 part。
    # 旧流程「先删后推」曾因网络瞬断把 hs 的 part0 删掉且中止，线上直接缺词。
    for band in targets:
        parts = chunk(prepared[band])
        new_ids = []
        for pi, part in enumerate(parts):
            body = {"band": band, "part": 1000 + pi, "total": len(prepared[band]),
                    "count": len(part), "items": part}
            st, d = pb_retry("POST", "/api/collections/lang_banks/records", body, token=token)
            if st not in (200, 201):
                raise SystemExit("%s part%d 写入失败: %s %s" % (band, pi, st, d))
            new_ids.append(d.get("id"))
        for r in recs.get(band, []):
            st, d = pb_retry("DELETE", "/api/collections/lang_banks/records/" + r["id"], token=token)
            if st not in (200, 204):
                raise SystemExit("%s 旧分片 %s 删除失败: %s %s" % (band, r["id"], st, d))
        for pi, rid in enumerate(new_ids):
            st, d = pb_retry("PATCH", "/api/collections/lang_banks/records/" + str(rid), {"part": pi}, token=token)
            if st != 200:
                raise SystemExit("%s part%d 回写失败: %s %s" % (band, pi, st, d))
        print("push %s: %d 词 -> %d 条记录" % (band, len(prepared[band]), len(parts)))

    # 对账
    recs2 = fetch_records(token)
    for band in targets:
        got = sum(int(r.get("count") or 0) for r in recs2.get(band, []))
        if got != len(prepared[band]):
            raise SystemExit("对账失败 %s: 期望 %d 实际 %d" % (band, len(prepared[band]), got))
    print("全部对账通过")


if __name__ == "__main__":
    main()
