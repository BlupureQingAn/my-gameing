# -*- coding: utf-8 -*-
"""云吞吞语言文游·五档词库清洗入库脚本(M6d1,可复跑)

用法:
  py scripts/lang_bank_build.py clean   解析 5 源文件 -> OUT_DIR/{band}.json + 抽查统计(默认)
  py scripts/lang_bank_build.py push    clean 后灌入 PocketBase(建 lang_banks 集合,按 band 整档替换)
  py scripts/lang_bank_build.py check   回读 PB 校验各档词条数(与本地产物对账)
  py scripts/lang_bank_build.py all     clean + push + check

词库源文件(高中3500.docx/CET4_edited.txt/六级词汇表.xlsx/5530_v7.1_release.pdf/TOEFL.txt)不入 git;
产物 JSON 落 OUT_DIR(本地),脚本本体 add -f 提交 scripts/。
"""
import sys, os, re, json, time, urllib.request, urllib.parse

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

BASE = r"F:\1\下载"
OUT_DIR = r"F:\Claude\lang_bank_out"
PB_URL = "https://db.blupure.cn"
PB_EMAIL = "x18325986@163.com"
PB_PASSWORD = "x1832445986"

BANDS = ["hs", "cet4", "cet6", "ky", "toefl"]
BAND_NAMES = {"hs": "高中3500", "cet4": "CET4", "cet6": "六级", "ky": "考研5530", "toefl": "TOEFL"}
SRC_FILES = {
    "hs": "3500.docx", "cet4": "CET4_edited.txt", "cet6": "六级词汇表.xlsx",
    "ky": "5530_v7.1_release.pdf", "toefl": "TOEFL.txt",
}
ZH_RE = re.compile(r"[一-鿿]")
WORD_RE = re.compile(r"^([A-Za-z][A-Za-z0-9'’\-]*)")


def clean_word(raw):
    t = raw.strip()
    if not t or "." in t.split()[0]:
        return ""  # a.m./no./St. 类缩写变体词条丢弃(截断会污染真词)
    m = WORD_RE.match(t)
    return m.group(1).lower() if m else ""


def parse_hs(path):
    """3500.docx:每段一词 'abandon v. 放弃, 遗弃',含大写单字母分节行。"""
    import docx
    doc = docx.Document(path)
    items, bad = [], []
    for p in doc.paragraphs:
        t = (p.text or "").strip()
        if not t or ZH_RE.search(t) is None:
            if re.fullmatch(r"[A-Za-z]", t):
                continue  # 分节行 A/B/...
            bad.append(t[:40])
            continue
        m = re.match(r"^(\S+)\s*(?:\[[^\]]*\])?\s*(.+)$", t)
        if not m:
            bad.append(t[:40])
            continue
        w = clean_word(m.group(1))
        zh = m.group(2).strip()
        if not w or len(zh) < 1:
            bad.append(t[:40])
            continue
        items.append((w, zh, ""))
    return items, bad


def parse_cet4(path):
    """txt:标题2行+大写分节行;词条 'abandon [ə] vt.丢弃;放弃,抛弃'(音标可缺)。"""
    raw = open(path, "rb").read()
    text = None
    for enc in ("utf-8-sig", "gbk", "utf-16"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            pass
    if text is None:
        text = raw.decode("utf-8", "replace")
    items, bad = [], []
    for ln in text.splitlines():
        t = ln.strip()
        if not t or re.fullmatch(r"[A-Za-z]", t) or not re.match(r"^[A-Za-z]", t):
            continue  # 空行/分节/标题(汉字或括号开头)
        m = re.match(r"^(\S+)\s*(?:\[([^\]]+)\])?\s*(.+)$", t)
        if not m:
            bad.append(t[:50])
            continue
        w = clean_word(m.group(1))
        ph = m.group(2) or ""
        zh = m.group(3).strip()
        if not w or not zh:
            bad.append(t[:50])
            continue
        items.append((w, zh, ph))
    return items, bad


def parse_cet6(path):
    """xlsx 两列: word, 中文释义(含词性)。"""
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.active
    items, bad = [], []
    for row in ws.iter_rows(values_only=True):
        if row is None or row[0] is None:
            continue
        w = clean_word(str(row[0]))
        zh = str(row[1] or "").strip()
        if not w or not zh:
            bad.append(str(row)[:60])
            continue
        items.append((w, zh, ""))
    wb.close()
    return items, bad


def parse_ky(path):
    """5530 pdf:每页表格(序号/词频/单词/释义/其他拼写),按页文本行做流式状态机(跨页续词)。"""
    import pymupdf
    HEADERS = {"序号", "词频", "单词", "释义", "其他拼写"}
    doc = pymupdf.open(path)
    items, bad = [], []
    cur, zh_parts = None, []
    seen_digit = False
    noise = []

    def flush():
        nonlocal cur, zh_parts
        if cur and zh_parts:
            items.append((cur, "；".join(zh_parts).strip(), ""))
        elif cur:
            noise.append((cur, "无释义"))
        cur, zh_parts = None, []

    for pi in range(doc.page_count):
        for raw in doc[pi].get_text().splitlines():
            t = raw.strip()
            if not t:
                continue
            if t in HEADERS:
                continue  # 页表头
            if t.isdigit():  # 序号或词频行
                if cur or zh_parts:
                    flush()
                seen_digit = True
                continue
            if cur is None:
                if seen_digit:
                    cur = t  # 词行(序号+词频后的第一个非数字行)
                    seen_digit = False
                else:
                    noise.append(t[:40])  # 正文外的零散文本
                continue
            if ZH_RE.search(t):
                zh_parts.append(t)
            else:
                pass  # 其他拼写等英文行:首版忽略
    flush()
    doc.close()
    bad.extend(n for n in noise if len(n) > 2)
    return items, bad[:50]


def parse_toefl(path):
    """txt:列对齐 'word [音标] vt. 释义' 多词性;释义长行折行需拼接。"""
    raw = open(path, "rb").read()
    text = None
    for enc in ("utf-8-sig", "gbk", "utf-16"):
        try:
            text = raw.decode(enc)
            break
        except Exception:
            pass
    if text is None:
        text = raw.decode("utf-8", "replace")
    ENTRY = re.compile(r"^([A-Za-z][A-Za-z0-9'’\-]*)\s{1,}\[([^\]]+)\]\s*(.*)$")
    items, bad = [], []
    cur, zh = None, ""
    for ln in text.splitlines():
        t = ln.strip()
        if not t:
            continue
        m = ENTRY.match(t)
        if m:
            if cur:
                items.append((cur, zh, ""))
            w = clean_word(m.group(1))
            cur, zh = w, m.group(3).strip()
            if not cur:
                bad.append(t[:50])
        elif cur:
            zh += (" " + t)  # 释义折行/续行
    if cur:
        items.append((cur, zh, ""))
    return items, bad


PARSERS = {"hs": parse_hs, "cet4": parse_cet4, "cet6": parse_cet6, "ky": parse_ky, "toefl": parse_toefl}


def merge_items(items):
    """同名多词性词条(如 can 助动/名词分列)合并为一条,释义以全角分号拼接,音标取首个。"""
    out, idx = [], {}
    for w, zh, ph in items:
        i = idx.get(w)
        if i is None:
            idx[w] = len(out)
            out.append([w, [zh], ph])
        elif zh not in out[i][1]:
            out[i][1].append(zh)
    return [(o[0], "；".join(o[1]), o[2]) for o in out]


def clean_all():
    os.makedirs(OUT_DIR, exist_ok=True)
    report = {}
    for band in BANDS:
        path = os.path.join(BASE, SRC_FILES[band])
        items, bad = PARSERS[band](path)
        items = merge_items(items)
        with_ph = sum(1 for i in items if i[2])
        report[band] = {"total": len(items), "with_ph": with_ph, "bad": len(bad), "bad_sample": bad[:8]}
        # 清洗后 zh 剥掉行首词性标记?不,展示层直接用;这里校验词条结构
        bad_zh = [i for i in items if not ZH_RE.search(i[1])]
        report[band]["no_zh"] = len(bad_zh)
        with open(os.path.join(OUT_DIR, band + ".json"), "w", encoding="utf-8") as f:
            json.dump({"band": band, "total": len(items),
                       "items": [{"w": w, "zh": zh} if not ph else {"w": w, "zh": zh, "ph": ph}
                                 for w, zh, ph in items]}, f, ensure_ascii=False)
        print(f"== {band} ({BAND_NAMES[band]}): {len(items)} 词 (音标 {with_ph}) bad {len(bad)}")
        for w, zh, ph in items[:3]:
            print(f"   | {w}  {zh[:60]}{('  ['+ph+']') if ph else ''}")
        print(f"   | ... tail: {items[-1][0] if items else '-'} {items[-1][1][:50] if items else ''}")
        if bad:
            print("   bad sample:", bad[:4])
    return report


# ---------------- PocketBase ----------------

def pb_req(method, path, body=None, token=None, retries=2):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = "Bearer " + token
    for i in range(retries + 1):
        try:
            req = urllib.request.Request(PB_URL + path, method=method,
                                         data=json.dumps(body).encode("utf-8") if body is not None else None,
                                         headers=headers)
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read().decode("utf-8"))
        except Exception as e:
            if i == retries:
                return 0, {"_err": str(e)}
            time.sleep(1.5)
    return 0, {}


def pb_admin_token():
    st, d = pb_req("POST", "/api/collections/_superusers/auth-with-password",
                   {"identity": PB_EMAIL, "password": PB_PASSWORD})
    if st != 200 or "token" not in d:
        raise SystemExit(f"PB 超管登录失败: {st} {d}")
    return d["token"]


def pb_ensure_collection(token):
    # 全量拉集合列表,本地匹配(PB filter 引号语法跨版本不稳)
    st, d = pb_req("GET", "/api/collections?perPage=200", token=token)
    col = None
    if st == 200:
        for c in (d.get("items") or []):
            if c.get("name") == "lang_banks":
                col = c
                break
    if col and len(col.get("fields", [])) > 1:
        print("集合 lang_banks 已存在且结构完整")
        return
    if col:  # 结构缺失(旧 schema 键建错):删除重建
        pb_req("DELETE", f"/api/collections/{col['id']}", token=token)
        print("旧结构缺失的 lang_banks 已删除,重建中")
    body = {
        "name": "lang_banks", "type": "base",
        "fields": [
            {"name": "band", "type": "text", "required": True},
            {"name": "part", "type": "number"},
            {"name": "total", "type": "number"},
            {"name": "count", "type": "number"},
            {"name": "items", "type": "json"},
        ],
        "listRule": "", "viewRule": "", "createRule": None,
        "updateRule": None, "deleteRule": None,
    }
    st, d = pb_req("POST", "/api/collections", body, token)
    if st not in (200, 201):
        raise SystemExit(f"建集合失败: {st} {d}")
    print("集合 lang_banks 已创建(fields 格式,listRule/viewRule 公开读)")


def push_all():
    token = pb_admin_token()
    pb_ensure_collection(token)
    MAX_PART = 150 * 1024  # bytes,单条记录体积上限控制
    for band in BANDS:
        with open(os.path.join(OUT_DIR, band + ".json"), "r", encoding="utf-8") as f:
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
                parts.append(cur)
                cur, cur_size = [], 0
            cur.append(it)
            cur_size += sz
        if cur:
            parts.append(cur)
        for pi, part in enumerate(parts):
            body = {"band": band, "part": pi, "total": len(items),
                    "count": len(part), "items": part}
            st, d = pb_req("POST", "/api/collections/lang_banks/records", body, token)
            if st not in (200, 201):
                raise SystemExit(f"{band} part{pi} 灌入失败: {st} {d}")
        print(f"push {band}: {len(items)} 词 -> {len(parts)} 条记录")


def check_all():
    token = pb_admin_token()
    local_total = {}
    for band in BANDS:
        with open(os.path.join(OUT_DIR, band + ".json"), "r", encoding="utf-8") as f:
            local_total[band] = json.load(f)["total"]
    st, d = pb_req("GET", "/api/collections/lang_banks/records?perPage=200&fields=band,part,total,count", token=token)
    all_recs = (d.get("items") or []) if st == 200 else []
    for band in BANDS:
        recs = [r for r in all_recs if r.get("band") == band]
        got = sum(int(r.get("count") or 0) for r in recs)
        want = local_total.get(band, -1)
        ok = "PASS" if got == want else "FAIL"
        print(f"check {band}: PB={got} 本地={want} 记录数={len(recs)} [{ok}]")
        if ok == "FAIL":
            print("   recs:", [(r.get("part"), r.get("count")) for r in recs])


if __name__ == "__main__":
    act = sys.argv[1] if len(sys.argv) > 1 else "clean"
    if act in ("clean", "all"):
        clean_all()
    if act in ("push", "all"):
        push_all()
    if act in ("check", "all"):
        check_all()
