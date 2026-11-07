#!/usr/bin/env python3
"""把使用说明的纯Markdown稿转为符合中式排版约定的单文件HTML。"""

import html
import json
import re
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
MD_PATH = ROOT / "stage1" / "final_draft.md"
HTML_PATH = ROOT / "stage2" / "formatted-API账户余额看板使用说明.html"
TOKENS_PATH = ROOT / "stage2" / "design_tokens.json"

STYLE = """
body { font-family:"SimSun","宋体",serif; font-size:12pt; color:#000000; line-height:1.6; font-style:normal; }
p { font-family:"SimSun","宋体",serif; font-size:12pt; color:#000000; text-indent:2em; margin:0 0 8pt 0; font-style:normal; }
h1, h2, h3 { font-family:"SimSun","宋体",serif; color:#000000; text-indent:0; font-style:normal; }
h1 { font-size:18pt; text-align:center; font-weight:bold; margin:0 0 18pt 0; }
h2 { font-size:15pt; font-weight:bold; margin:16pt 0 8pt 0; }
h3 { font-size:13pt; font-weight:bold; margin:12pt 0 6pt 0; }
ul, ol { margin:0 0 8pt 0; padding-left:2em; }
li { font-family:"SimSun","宋体",serif; font-size:12pt; color:#000000; text-indent:0; margin-bottom:4pt; font-style:normal; }
table { border-collapse:collapse; table-layout:auto; margin:8pt 0 12pt 0; }
th { font-family:"SimSun","宋体",serif; font-size:11pt; color:#000000; text-align:center; font-weight:bold; background:none; border:0.5pt solid #000000; padding:5pt 6pt; text-indent:0; font-style:normal; }
td { font-family:"SimSun","宋体",serif; font-size:11pt; color:#000000; text-align:left; border:0.5pt solid #000000; padding:5pt 6pt; text-indent:0; vertical-align:top; font-style:normal; }
code { font-family:"Courier New",monospace; font-size:11pt; color:#000000; font-style:normal; }
strong { color:#000000; font-style:normal; }
"""


def inline(text):
    out = html.escape(text, quote=False)
    out = re.sub(r"`([^`]+)`", r"<code>\1</code>", out)
    out = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", out)
    return out


def classify(line):
    if line.startswith("### "): return "h3"
    if line.startswith("## "): return "h2"
    if line.startswith("# "): return "h1"
    if line.startswith("|"): return "table"
    if line.startswith("- "): return "ul"
    if re.match(r"^\d+\. ", line): return "ol"
    return "p"


def split_blocks(lines):
    blocks, cur_type, cur = [], None, []
    for line in lines + [""]:
        if not line.strip():
            if cur:
                blocks.append((cur_type, cur))
                cur, cur_type = [], None
            continue
        kind = classify(line)
        if cur and kind != cur_type:
            blocks.append((cur_type, cur))
            cur = []
        cur_type = kind
        cur.append(line)
    return blocks


def render(kind, lines):
    if kind == "h1":
        return "<h1>" + inline(lines[0][2:]) + "</h1>"
    if kind == "h2":
        return "<h2>" + inline(lines[0][3:]) + "</h2>"
    if kind == "h3":
        return "<h3>" + inline(lines[0][4:]) + "</h3>"
    if kind == "p":
        return "<p>" + inline("".join(lines)) + "</p>"
    if kind in ("ul", "ol"):
        tag = "ul" if kind == "ul" else "ol"
        items = []
        for line in lines:
            content = line[2:] if kind == "ul" else re.sub(r"^\d+\. ", "", line)
            items.append("<li>" + inline(content) + "</li>")
        return f"<{tag}>" + "".join(items) + f"</{tag}>"
    if kind == "table":
        rows = []
        for line in lines:
            if re.match(r"^\|[\s:|-]+\|$", line):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            rows.append(cells)
        if not rows:
            return ""
        head = "<thead><tr>" + "".join("<th>" + inline(c) + "</th>" for c in rows[0]) + "</tr></thead>"
        body = "<tbody>" + "".join(
            "<tr>" + "".join("<td>" + inline(c) + "</td>" for c in row) + "</tr>"
            for row in rows[1:]
        ) + "</tbody>"
        return "<table>" + head + body + "</table>"
    return ""


def main():
    md = MD_PATH.read_text(encoding="utf-8")
    lines = md.splitlines()
    body = "\n".join(render(kind, block) for kind, block in split_blocks(lines))
    doc = (
        "<!DOCTYPE html>\n<html lang=\"zh-CN\">\n<head>\n"
        "<meta charset=\"utf-8\">\n<title>API账户余额看板使用说明</title>\n"
        "<style>" + STYLE + "</style>\n</head>\n<body>\n" + body + "\n</body>\n</html>\n"
    )
    HTML_PATH.write_text(doc, encoding="utf-8")
    tokens = {
        "genre": "general",
        "route": "html-template",
        "theme": "user-chinese-document-convention",
        "typography": {"east_asia_font": "SimSun", "body_size": "12pt", "body_text_indent": "2em", "text_color": "#000000"},
        "heading": {"color": "#000000", "italic": False, "indent": 0},
        "table": {"header_align": "center", "header_shading": "none", "column_width": "auto", "cell_text_indent": 0},
        "page_furniture": {"cover": False, "toc": False, "header_footer": False, "reason": "用户未要求，使用说明以正文为主，避免冗余"},
        "source": "stage1/final_draft.md"
    }
    TOKENS_PATH.write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding="utf-8")
    print("HTML:", HTML_PATH)
    print("字符数:", len(doc))
    print("表格数:", doc.count("<table>"), "标题数:", doc.count("<h2>"))


if __name__ == "__main__":
    sys.exit(main())
