"""
Convert every Markdown file in this folder into a styled dark-mode HTML page.

Self-contained: uses python-markdown + Pygments (server-side highlighting), so the
output needs no internet/CDN. Re-run after editing any .md:

    python de-prep/build_html.py
"""
import os
import re
import markdown
from pygments.formatters import HtmlFormatter

ROOT = os.path.dirname(os.path.abspath(__file__))
INDEX = os.path.join(ROOT, "index.html")

# Dark theme matching index.html, plus Pygments token colors.
PYGMENTS_CSS = HtmlFormatter(style="dracula").get_style_defs(".codehilite")

CSS = """
:root{
  --bg:#0b1020; --bg2:#101a33; --panel:#131d36; --panel2:#1a2745;
  --text:#e6edf6; --muted:#9fb0c7; --line:#26365c;
  --accent:#38bdf8; --accent2:#22d3ee; --green:#34d399; --amber:#fbbf24;
  --red:#f87171; --purple:#a78bfa; --code:#0a0f1e;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0; font-family:"Segoe UI",Roboto,system-ui,Arial,sans-serif;
  background:linear-gradient(180deg,#090e1c,#0b1020); color:var(--text);
  line-height:1.65; font-size:15.5px;}
a{color:var(--accent2); text-decoration:none}
a:hover{text-decoration:underline}

.topbar{position:sticky; top:0; z-index:10; display:flex; align-items:center; gap:14px;
  background:rgba(11,16,32,.85); backdrop-filter:blur(8px);
  border-bottom:1px solid var(--line); padding:12px 22px;}
.topbar .back{display:inline-flex; align-items:center; gap:6px; font-size:13.5px;
  font-weight:600; color:var(--accent2); background:var(--panel2);
  border:1px solid var(--line); padding:6px 12px; border-radius:999px;}
.topbar .back:hover{border-color:var(--accent); text-decoration:none}
.topbar .crumb{font-size:13px; color:var(--muted)}

main.doc{max-width:900px; margin:26px auto; padding:30px 36px 50px;
  background:var(--panel); border:1px solid var(--line); border-radius:16px;}

h1{font-size:28px; margin:0 0 18px; padding-bottom:14px; border-bottom:2px solid var(--line);
  color:#eaf2ff;}
h2{font-size:21px; margin:34px 0 12px; padding:8px 0 8px 14px; color:var(--accent);
  border-left:4px solid var(--accent); background:linear-gradient(90deg,rgba(56,189,248,.08),transparent);
  border-radius:0 8px 8px 0;}
h3{font-size:17px; margin:22px 0 8px; color:var(--accent2);}
h4{font-size:14.5px; margin:16px 0 6px; color:var(--purple); text-transform:uppercase; letter-spacing:.5px;}
p{margin:10px 0}

ul,ol{margin:10px 0; padding-left:24px}
li{margin:6px 0}
li::marker{color:var(--accent)}

blockquote{margin:16px 0; padding:12px 18px; border-left:4px solid var(--amber);
  background:rgba(251,191,36,.07); border-radius:0 8px 8px 0; color:#f3e6c2;}
blockquote p{margin:4px 0}

hr{border:none; border-top:1px solid var(--line); margin:28px 0}

/* inline code */
code{font-family:Consolas,"Courier New",monospace; font-size:13px;
  background:var(--panel2); color:#ffd9a8; padding:2px 6px; border-radius:5px;
  border:1px solid var(--line);}

/* code blocks */
pre{margin:14px 0; padding:0; background:transparent; border:none; overflow:auto}
.codehilite{background:var(--code); border:1px solid var(--line); border-radius:10px;
  padding:14px 16px; margin:14px 0; overflow:auto;}
.codehilite pre{margin:0; padding:0; background:transparent; line-height:1.5}
.codehilite code, pre code{background:transparent; border:none; color:inherit; padding:0;
  font-size:13px;}

/* tables */
table{width:100%; border-collapse:collapse; margin:16px 0; font-size:13.8px}
th,td{border:1px solid var(--line); padding:9px 12px; text-align:left; vertical-align:top}
th{background:var(--panel2); color:#dbe7ff}
tr:nth-child(even) td{background:rgba(255,255,255,.015)}

strong{color:#f1f6ff}
em{color:#cdd9ee}

.docfoot{max-width:900px; margin:0 auto 50px; padding:0 36px; text-align:center;
  color:var(--muted); font-size:12.5px}
""" + "\n/* ---- Pygments (dracula) ---- */\n" + PYGMENTS_CSS + """
.codehilite, .codehilite pre{background:#0a0f1e !important;}
"""

TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{title}</title>
<style>
{css}
</style>
</head>
<body>
<div class="topbar">
  <a class="back" href="{back}">&#8592; Prep Home</a>
  <span class="crumb">{crumb}</span>
</div>
<main class="doc">
{content}
</main>
<footer class="docfoot">Data Engineer Prep &middot; Snowflake + dbt + Airflow</footer>
</body>
</html>
"""


def first_heading(md_text, fallback):
    for line in md_text.splitlines():
        m = re.match(r"#\s+(.*)", line.strip())
        if m:
            return m.group(1).strip()
    return fallback


def convert(md_path):
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()

    md = markdown.Markdown(
        extensions=["fenced_code", "codehilite", "tables", "sane_lists", "toc", "attr_list"],
        extension_configs={"codehilite": {"guess_lang": False, "css_class": "codehilite"}},
    )
    html_body = md.convert(md_text)

    title = first_heading(md_text, os.path.basename(md_path))
    back = os.path.relpath(INDEX, start=os.path.dirname(md_path)).replace("\\", "/")
    crumb = os.path.relpath(md_path, ROOT).replace("\\", "/")

    out_html = TEMPLATE.format(
        title=title, css=CSS, content=html_body, back=back, crumb=crumb
    )
    out_path = os.path.splitext(md_path)[0] + ".html"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(out_html)
    return out_path


def main():
    count = 0
    for dirpath, _dirs, files in os.walk(ROOT):
        for name in files:
            if name.lower().endswith(".md"):
                out = convert(os.path.join(dirpath, name))
                print("wrote", os.path.relpath(out, ROOT))
                count += 1
    print(f"\nDone: {count} files converted.")


if __name__ == "__main__":
    main()
