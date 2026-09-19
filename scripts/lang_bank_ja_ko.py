# -*- coding: utf-8 -*-
"""云吞吞语言文游·日/韩词库清洗入库脚本(2026-09-19,可复跑)

用法:
  py scripts/lang_bank_ja_ko.py build    构建本地 JSON(含 LLM 补中文释义,带缓存可续跑)
  py scripts/lang_bank_ja_ko.py check    回读 PB 校验各档词条数
  py scripts/lang_bank_ja_ko.py push     灌入 PocketBase(按 band 整档替换,不触碰英语五档)
  py scripts/lang_bank_ja_ko.py all      build + push + check

数据源(均不入 git):
  日语 openjlpt(N5-N1,源自 tanos.co.uk,CC BY-SA)——pip 包自带数据
  韩语 TOPIK/NIKL 词表(julienshim/combined_korean_vocabulary_list)+
       HF jaylee8864/korean-vocabulary-5000(中文释义/罗马音/难度)

产出字段与英语五档对齐: {w: 词形, ph: 读音(假名/罗马音), zh: 中文释义}
"""
import sys, os, re, json, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

WORK = r"F:\Claude\tmp\ja_ko"
OUT_DIR = r"F:\Claude\lang_bank_out"
CACHE = os.path.join(WORK, "llm_cache.json")
PB_URL = "https://db.blupure.cn"
# 凭据不入库(公开仓库):F:\Claude\pb-admin.txt 两行 = 邮箱 / 密码
_cred = open(r"F:\Claude\pb-admin.txt", encoding="utf-8").read().splitlines()
PB_EMAIL, PB_PASSWORD = _cred[0].strip(), _cred[1].strip()
ZHIPU_KEY = open(r"F:\Claude\zhipu-apikey", encoding="utf-8").read().strip()
LLM_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions"
MODEL = "glm-4-flash"

JA_BANDS = ["ja-n5", "ja-n4", "ja-n3", "ja-n2", "ja-n1"]
KO_BANDS = ["ko-1", "ko-2", "ko-3"]
BANDS = JA_BANDS + KO_BANDS


# ---------------- LLM ----------------
def llm(prompt, retries=5):
    body = json.dumps({
        "model": MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
    }, ensure_ascii=False).encode("utf-8")
    last = ""
    for i in range(retries):
        try:
            req = urllib.request.Request(LLM_URL, data=body, method="POST", headers={
                "Authorization": "Bearer " + ZHIPU_KEY,
                "Content-Type": "application/json",
            })
            with urllib.request.urlopen(req, timeout=90) as r:
                d = json.loads(r.read().decode("utf-8"))
            return d["choices"][0]["message"]["content"]
        except Exception as e:
            last = str(e)[:160]
            time.sleep(2 + i * 3)
    print("  [LLM 失败]", last)
    return ""


def load_cache():
    if os.path.exists(CACHE):
        with open(CACHE, encoding="utf-8") as f:
            return json.load(f)
    return {}


def save_cache(c):
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(c, f, ensure_ascii=False)


def parse_llm_lines(txt, n_expect):
    """解析 '序号|释义' 行格式,返回 {序号: 释义}"""
    out = {}
    for line in (txt or "").splitlines():
        line = line.strip()
        if not line:
            continue
        m = re.match(r"^(\d+)\s*[|｜:：\t]\s*(.+)$", line)
        if m:
            idx = int(m.group(1))
            if 1 <= idx <= n_expect:
                out[idx] = m.group(2).strip()
    return out


def translate_batch(pairs, kind):
    """pairs: [(key, 源文本)];kind: 'ja' | 'ko' 决定提示词。返回 {key: 中文释义}"""
    if kind == "ja":
        lines = "\n".join(f"{i+1}|{p[1]}" for i, p in enumerate(pairs))
        prompt = (
            "你是日语词典编辑。下面每行是「序号|英文释义」，对应一个日语词条。\n"
            "请把英文释义译成简洁的简体中文释义（保留词性信息，如「名. 学校」「动. 去」）。\n"
            "要求：只输出「序号|中文释义」，每行一条，顺序与输入一致，不要任何解释或空行。\n\n"
            + lines
        )
    else:
        lines = "\n".join(f"{i+1}|{p[1]}" for i, p in enumerate(pairs))
        prompt = (
            "你是韩语词典编辑。下面每行是「序号|韩语词条(含词性/汉字词提示)」。\n"
            "请给出该词的简体中文释义，格式「词性. 释义」，如「名. 学校」「动. 去」。\n"
            "若为汉字词，释义须与该汉字词在中文里的含义一致。只输出「序号|中文释义」，"
            "每行一条，顺序与输入一致，不要任何解释或空行。\n\n"
            + lines
        )
    txt = llm(prompt)
    got = parse_llm_lines(txt, len(pairs))
    return {pairs[i - 1][0]: v for i, v in got.items()}


def fill_meanings(items, kind, batch=40, workers=2):
    # 实测(2026-09-19):4 worker x 20 条吞吐仅 0.44 条/秒(并发触发限流不断退避重试);
    # 2 worker x 40 条实测 80 条/22s ≈ 3.6 条/秒,为最优组合,勿轻易调大。
    """items: [(key, src)];原地补中文,带缓存"""
    cache = load_cache()
    todo = [x for x in items if x[0] not in cache]
    print(f"  待 LLM 处理 {len(todo)} / 共 {len(items)}（缓存命中 {len(items)-len(todo)}）")
    if not todo:
        return {k: cache[k] for k, _ in items if k in cache}
    batches = [todo[i:i + batch] for i in range(0, len(todo), batch)]
    done = [0]
    lock = __import__("threading").Lock()

    def work(b):
        res = translate_batch(b, kind)
        with lock:
            cache.update(res)
            done[0] += 1
            if done[0] % 20 == 0:
                save_cache(cache)
                print(f"    进度 {done[0]}/{len(batches)} 批")

    with ThreadPoolExecutor(max_workers=workers) as ex:
        list(ex.map(work, batches))
    save_cache(cache)
    miss = len([x for x in items if x[0] not in cache])
    print(f"  完成,未取得释义 {miss} 条")
    return {k: cache.get(k, "") for k, _ in items}


# ---------------- 日语 ----------------
def build_ja():
    import openjlpt
    base = os.path.dirname(openjlpt.__file__)
    lv_map = {"n5": "ja-n5", "n4": "ja-n4", "n3": "ja-n3", "n2": "ja-n2", "n1": "ja-n1"}
    seen, per = {}, {b: [] for b in JA_BANDS}
    for lv, band in lv_map.items():
        d = json.load(open(os.path.join(base, "data/json/vocab", lv + ".json"), encoding="utf-8"))
        for e in d:
            w = (e.get("word") or "").strip()
            if not w or w in seen:
                continue          # 同词跨档时保留最易档(先入为主=N5 优先)
            seen[w] = band
            per[band].append({
                "w": w,
                "ph": (e.get("reading") or "").strip(),
                "src": " ".join(e.get("meanings") or [])[:200],
            })
    # LLM 转中文
    flat = [(b + "\x00" + it["w"], it["src"]) for b in JA_BANDS for it in per[b]]
    zh = fill_meanings(flat, "ja")
    out = {}
    for b in JA_BANDS:
        items = []
        for it in per[b]:
            z = (zh.get(b + "\x00" + it["w"]) or "").strip()
            if not z:
                continue
            items.append({"w": it["w"], "ph": it["ph"], "zh": z})
        out[b] = items
        print(f"  {b}: {len(items)} 词")
    return out


# ---------------- 韩语 ----------------
def build_ko():
    import csv
    # 1) TOPIK/NIKL 骨架
    rows = [r for r in csv.DictReader(open(os.path.join(WORK, "topik_results.tsv"), encoding="utf-8"), delimiter="\t")]
    # 2) HF 中文查表
    hf = {}
    for line in open(os.path.join(WORK, "ko_zh.jsonl"), encoding="utf-8"):
        r = json.loads(line)
        k = (r.get("korean_term") or "").strip()
        if k:
            hf.setdefault(k, r)

    def band_of(r):
        t = (r.get("topik_level") or "").strip()
        if t == "초급":
            return "ko-1"
        if t == "중급":
            return "ko-2"
        n = (r.get("nikl_level") or "").strip()
        if n == "A":
            return "ko-1"
        if n == "B":
            return "ko-2"
        if n == "C":
            return "ko-3"
        return ""

    seen, per = set(), {b: [] for b in KO_BANDS}
    for r in rows:
        w = (r.get("word") or "").strip()
        w = re.sub(r"\d+$", "", w)          # 가격03 -> 가격
        if not w or w in seen:
            continue
        b = band_of(r)
        if not b:
            continue
        seen.add(w)
        h = hf.get(w) or {}
        pos = (r.get("part_of_speech") or "").strip()
        hanja = (r.get("hanja") or "").strip()
        per[b].append({
            "w": w,
            "ph": (h.get("romanization") or "").strip(),
            "zh": (h.get("english_term") or "").strip(),      # HF 直供中文优先
            "pos": pos,
            "hanja": hanja,
            # 把词性/汉字词/官方搭配一并给模型当上下文,显著降低生造释义的概率
            "src": f"{w} [{pos or '?'}{', 汉字词:' + hanja if hanja else ''}"
                   + (f", 搭配:{colloc}" if (colloc := (r.get('explanation') or '').strip()) else "") + "]",
        })
    # LLM 补缺释义
    need = [(b + "\x00" + it["w"], it["src"]) for b in KO_BANDS for it in per[b] if not it["zh"]]
    print(f"  韩语需 LLM 生成释义 {len(need)} 条（HF 直供 {sum(1 for b in KO_BANDS for it in per[b] if it['zh'])} 条）")
    zh = fill_meanings(need, "ko") if need else {}
    out = {}
    for b in KO_BANDS:
        items = []
        for it in per[b]:
            z = (it["zh"] or zh.get(b + "\x00" + it["w"]) or "").strip()
            if not z:
                continue
            items.append({"w": it["w"], "ph": it["ph"], "zh": z})
        out[b] = items
        print(f"  {b}: {len(items)} 词")
    return out


def build():
    os.makedirs(OUT_DIR, exist_ok=True)
    print("=== 日语 ===")
    ja = build_ja()
    print("=== 韩语 ===")
    ko = build_ko()
    allb = dict(ja); allb.update(ko)
    for b, items in allb.items():
        p = os.path.join(OUT_DIR, b + ".json")
        with open(p, "w", encoding="utf-8") as f:
            json.dump({"band": b, "total": len(items), "items": items}, f, ensure_ascii=False)
        print(f"  写出 {b}.json  {len(items)} 词")


# ---------------- PB ----------------
def pb_req(method, path, body=None, token=None, retries=3):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    for i in range(retries):
        try:
            req = urllib.request.Request(PB_URL + path, data=data, method=method)
            req.add_header("Content-Type", "application/json")
            if token:
                req.add_header("Authorization", token)
            with urllib.request.urlopen(req, timeout=90) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read().decode("utf-8"))
            except Exception:
                return e.code, {}
        except Exception:
            time.sleep(1 + i * 2)
    return 0, {}


def pb_admin_token():
    st, d = pb_req("POST", "/api/collections/_superusers/auth-with-password",
                   {"identity": PB_EMAIL, "password": PB_PASSWORD})
    if st != 200 or "token" not in d:
        raise SystemExit(f"PB 认证失败: {st} {d}")
    return d["token"]


def push_all(bands=None):
    bands = list(bands) if bands else BANDS
    token = pb_admin_token()
    MAX_PART = 150 * 1024
    for band in bands:
        with open(os.path.join(OUT_DIR, band + ".json"), encoding="utf-8") as f:
            data = json.load(f)
        items = data["items"]
        st, d = pb_req("GET", "/api/collections/lang_banks/records?perPage=200", token=token)
        for rec in (d.get("items") or []):
            if rec.get("band") == band:
                pb_req("DELETE", f"/api/collections/lang_banks/records/{rec['id']}", token=token)
        parts, cur, cur_size = [], [], 0
        for it in items:
            sz = len(json.dumps(it, ensure_ascii=False))
            if cur and cur_size + sz > MAX_PART:
                parts.append(cur); cur, cur_size = [], 0
            cur.append(it); cur_size += sz
        if cur:
            parts.append(cur)
        for pi, part in enumerate(parts):
            body = {"band": band, "part": pi, "total": len(items), "count": len(part), "items": part}
            st, d = pb_req("POST", "/api/collections/lang_banks/records", body, token)
            if st not in (200, 201):
                raise SystemExit(f"{band} part{pi} 灌入失败: {st} {d}")
        print(f"push {band}: {len(items)} 词 -> {len(parts)} 条记录")


def check_all():
    token = pb_admin_token()
    local = {}
    for b in BANDS:
        p = os.path.join(OUT_DIR, b + ".json")
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                local[b] = json.load(f)["total"]
    st, d = pb_req("GET", "/api/collections/lang_banks/records?perPage=200&fields=band,part,total,count", token=token)
    recs = {}
    for r in (d.get("items") or []):
        recs.setdefault(r.get("band"), []).append(r)
    ok = True
    for b in BANDS:
        if b not in local:
            continue
        got = sum(int(r.get("count") or 0) for r in recs.get(b, []))
        flag = "OK " if got == local[b] else "MISMATCH"
        if got != local[b]:
            ok = False
        print(f"  {flag} {b}: 本地 {local[b]} / PB {got}（{len(recs.get(b, []))} 分片）")
    if not ok:
        raise SystemExit("对账失败")
    print("  全部对账通过")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        build()
    elif cmd == "push":
        push_all(sys.argv[2:] or None)
    elif cmd == "check":
        check_all()
    elif cmd == "all":
        build(); push_all(); check_all()
    else:
        print(__doc__)
