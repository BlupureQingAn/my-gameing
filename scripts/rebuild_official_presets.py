import argparse
import html
import os
import re
import sys
import zipfile
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class DecodeAttempt:
    encoding: str
    text: str
    score: float
    notes: str


def _normalize_newlines(s: str) -> str:
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    # trim excessive trailing whitespace lines, but keep final newline consistent
    s = re.sub(r"[ \t]+\n", "\n", s)
    return s.strip() + "\n"


def _score_text(s: str) -> tuple[float, str]:
    if not s:
        return 0.0, "empty"
    bad = 0
    total = len(s)
    # replacement char
    bad += s.count("\ufffd") * 20
    # NUL / C0 controls excluding newline & tab
    ctrl = sum(1 for ch in s if (ord(ch) < 32 and ch not in "\n\t") or ord(ch) == 127)
    bad += ctrl * 10
    # mojibake hints
    bad += len(re.findall(r"Ã.|Â.|Ð.|Ñ.|â€|â€™|â€œ|â€�|ä¸|å¤|æœ|çš", s)) * 5
    # if too much "?" it's suspicious (but not as strong)
    bad += s.count("?") * 0.2
    good = sum(1 for ch in s if ch.isprintable() or ch in "\n\t")
    ratio = good / max(1, total)
    score = bad + (1.0 - ratio) * 30.0
    return score, f"bad={bad:.1f}, printable_ratio={ratio:.3f}"


def decode_bytes_best_effort(data: bytes) -> DecodeAttempt:
    candidates = [
        "utf-8",
        "utf-8-sig",
        "utf-16",
        "utf-16le",
        "utf-16be",
        "gb18030",
        "gbk",
        "big5",
        "cp936",
    ]
    attempts: list[DecodeAttempt] = []
    for enc in candidates:
        try:
            text = data.decode(enc, errors="replace")
        except Exception:
            continue
        score, notes = _score_text(text)
        attempts.append(DecodeAttempt(enc, text, score, notes))
    if not attempts:
        # fallback
        text = data.decode("utf-8", errors="replace")
        score, notes = _score_text(text)
        return DecodeAttempt("utf-8", text, score, notes)
    attempts.sort(key=lambda a: a.score)
    return attempts[0]


def extract_text_from_docx(docx_path: Path) -> str:
    with zipfile.ZipFile(docx_path, "r") as zf:
        xml = zf.read("word/document.xml").decode("utf-8", errors="replace")
    # WordprocessingML: paragraphs and breaks/tabs
    xml = xml.replace("</w:p>", "\n")
    xml = xml.replace("<w:br/>", "\n").replace("<w:br />", "\n")
    xml = xml.replace("<w:tab/>", "\t").replace("<w:tab />", "\t")
    # remove tags
    xml = re.sub(r"<[^>]+>", "", xml)
    xml = html.unescape(xml)
    # collapse excessive blank lines
    xml = re.sub(r"\n{3,}", "\n\n", xml)
    return _normalize_newlines(xml)


def read_text_file_best_effort(path: Path) -> tuple[str, str]:
    data = path.read_bytes()
    attempt = decode_bytes_best_effort(data)
    return _normalize_newlines(attempt.text), attempt.encoding


def safe_filename(name: str) -> str:
    name = re.sub(r"[\\/:*?\"<>|]", "_", name)
    name = name.strip().strip(".")
    return name or "untitled"


def wipe_txt_files(target_dir: Path) -> int:
    n = 0
    for p in target_dir.glob("*.txt"):
        try:
            p.unlink()
            n += 1
        except Exception:
            pass
    return n


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="Rebuild official presets into presets/ with UTF-8 + LF.")
    ap.add_argument("--out", default=str(Path(__file__).resolve().parents[1] / "presets"), help="Output presets directory")
    ap.add_argument("--wipe", action="store_true", help="Delete existing .txt in output presets dir first")
    ap.add_argument("paths", nargs="*", help="Source .docx/.txt file paths")
    args = ap.parse_args(argv)

    out_dir = Path(args.out).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.wipe:
        wiped = wipe_txt_files(out_dir)
        print(f"[wipe] removed {wiped} txt files from {out_dir}")

    if not args.paths:
        print("No input paths provided.", file=sys.stderr)
        return 2

    ok = 0
    failed = 0
    for raw in args.paths:
        src = Path(raw).resolve()
        if not src.exists():
            print(f"[missing] {src}")
            failed += 1
            continue
        try:
            if src.suffix.lower() == ".docx":
                text = extract_text_from_docx(src)
                enc = "docx"
            elif src.suffix.lower() == ".txt":
                text, enc = read_text_file_best_effort(src)
            else:
                print(f"[skip] unsupported: {src}")
                continue
            out_name = safe_filename(src.stem) + ".txt"
            dst = out_dir / out_name
            dst.write_text(text, encoding="utf-8", newline="\n")
            print(f"[ok] {src.name} -> {dst.name} (from {enc})")
            ok += 1
        except Exception as e:
            print(f"[fail] {src} :: {e}")
            failed += 1

    print(f"done. ok={ok}, failed={failed}, out={out_dir}")
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

