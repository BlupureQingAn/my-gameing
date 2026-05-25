import json
import re
import hashlib
from pathlib import Path
from zipfile import ZipFile

SRC_ROOT = Path(r"E:\temp\deepseek_game")
OUT_ROOT = Path(r"E:\Desktop\文游\my-bitlife-game\presets")
MANIFEST_PATH = OUT_ROOT / "manifest.json"
EXCLUDE_DIR = "文风预设"

NAME_POOL = [
    "苏棠", "许诺", "温遥", "沈知夏", "姜予安", "陆星冉", "唐梨", "林栀", "顾屿", "周叙白",
    "秦晚", "乔一禾", "江念", "夏青禾", "安以宁", "白若", "叶清辞", "宋予澄", "段云舒", "时砚",
    "程予安", "岑雾"
]

TITLE_POOL = [
    "热搜预警：{p}的反转人生开局就爆了",
    "一夜翻盘：{p}的高能逆袭剧本",
    "心动失控：{p}被全校盯上的那一天",
    "凤阙惊梦：{p}从冷局里杀出重围",
    "深宫翻牌：{p}的逆袭开局太上头了",
    "朱墙暗涌：{p}的古风开局太带感",
    "心动警报：{p}一开局就拿了万人迷剧本",
    "反套路恋综：{p}把所有人都整不会了",
    "甜虐失控：{p}的快穿恋爱大翻盘",
    "仙门爆改：{p}开局竟被全宗门盯上",
    "灵契开挂：{p}的修真局爽到停不下来",
    "三界热搜：{p}在修仙界杀疯了",
    "极限求生：{p}的末日逃亡开局",
    "危机倒计时：{p}在封锁区拼命翻盘",
    "绝境反杀：{p}的生存局太刺激",
    "慢生活治愈录：{p}的温柔逆风局",
    "山海日常：{p}把生活过成了理想型",
    "岁月回甘：{p}的养成系人生开局",
]


def safe_filename(s: str) -> str:
    s = re.sub(r'[\\/:*?"<>|\s]+', '_', s)
    s = re.sub(r'_+', '_', s).strip('_.')
    return s or 'preset'


def detect_text(data: bytes) -> str:
    for enc in ('utf-8-sig', 'utf-8', 'gb18030', 'gbk', 'cp936'):
        try:
            return data.decode(enc)
        except Exception:
            pass
    return data.decode('utf-8', errors='replace')


def extract_docx(path: Path) -> str:
    with ZipFile(path) as zf:
        xml = zf.read('word/document.xml').decode('utf-8', 'replace')
    xml = xml.replace('</w:p>', '\n').replace('<w:br/>', '\n').replace('<w:br />', '\n')
    xml = xml.replace('<w:tab/>', '\t').replace('<w:tab />', '\t')
    return re.sub(r'<[^>]+>', '', xml)


def extract_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    return '\n'.join((page.extract_text() or '') for page in reader.pages)


def extract(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == '.txt':
        return detect_text(path.read_bytes())
    if suf == '.docx':
        return extract_docx(path)
    if suf == '.pdf':
        return extract_pdf(path)
    return ''


def title_for(relstem: str) -> str:
    h = int(hashlib.sha1(relstem.encode('utf-8')).hexdigest(), 16)
    return TITLE_POOL[h % len(TITLE_POOL)].format(p='她')


def rewrite(title: str) -> str:
    protagonist = '苏棠'
    return f'''// 游戏开始指令：【{title}】\n\n// 场景：招新夜的灯光把整个会场推到最热闹的临界点。\n// 时间：晚上8:30\n// 主角初始状态：\n// 你：{protagonist}\n// 情绪值：45%\n// 自尊值：52%\n// 社交能力：28%\n// 社死程度：8%\n// 魅力值：58%\n// 学识值：72%\n\n【剧情开始】\n你叫{protagonist}，刚踏进新的环境，本来只想安安静静把今晚混过去，结果偏偏被推到了最显眼的位置。人群、灯光、噪音、视线，一层层压上来，你心里只剩一个念头：别慌，先把局面稳住。\n\n可还没等你反应过来，意外就先一步找上门来。有人在众目睽睽之下提起你的名字，还顺势抛出一份来路不明的“证据”，像是早就准备好要看你出丑。你原本想低调，偏偏对方不给你低调的机会。\n\n// 状态变化：\n// 情绪值：-8%\n// 自尊值：-5%\n// 社死程度：+12%\n\n你抬起头，第一次真正意识到：今晚不是普通的开局，而是一次必须接住的反转局。\n\n✨ **请选择你的回应** ✨\nA. 【先退一步】暂时离开人群，观察局势。\nB. 【冷静反问】直接要求对方说明情况，抢回节奏。\nC. 【轻松反转】用玩笑把场面带偏，打断对方节奏。\nD. 【当场对质】把事情摊开，逼对方拿出证据。\n'''


def main() -> int:
    OUT_ROOT.mkdir(parents=True, exist_ok=True)
    for p in OUT_ROOT.glob('*.txt'):
        p.unlink()

    files = [p for p in SRC_ROOT.rglob('*') if p.is_file() and EXCLUDE_DIR not in p.parts and p.suffix.lower() in {'.txt', '.docx', '.pdf'}]
    manifest = []
    seen_names = set()
    for p in files:
        raw = extract(p)
        if not raw.strip():
            continue
        rel = p.relative_to(SRC_ROOT)
        title = title_for(str(rel.with_suffix('')))
        base = safe_filename(title)
        out_name = f"{base}_{hashlib.sha1(str(rel).encode('utf-8')).hexdigest()[:6]}.txt"
        if out_name in seen_names:
            continue
        seen_names.add(out_name)
        out_path = OUT_ROOT / out_name
        out_path.write_text(rewrite(title), encoding='utf-8', newline='\n')
        chk = out_path.read_text(encoding='utf-8')
        if '\ufffd' in chk:
            raise RuntimeError(f'encoding issue: {out_name}')
        manifest.append({
            'id': 'cloud_' + hashlib.sha1(out_name.encode('utf-8')).hexdigest()[:8],
            'title': title,
            'theme': '网络模板',
            'source': '本地整理生成'
        })

    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=4), encoding='utf-8')
    print(f'written={len(manifest)}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
