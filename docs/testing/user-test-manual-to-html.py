"""把 user-test-manual.md 渲染成打印用 HTML（PDF 的中间产物）。

用法见 user-test-manual.md 头部「怎么重新导出 PDF」。产出的 .html 不提交。
依赖：pip install markdown
"""
import markdown, pathlib

HERE = pathlib.Path(__file__).resolve().parent
src = (HERE / "user-test-manual.md").read_text(encoding="utf-8")
body = markdown.markdown(src, extensions=["tables","attr_list"])
css = """
@page { size: A4; margin: 16mm 14mm; }
body { font-family: "PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif; font-size: 10.5pt; line-height: 1.65; color:#1b1b1b; }
h1 { font-size: 22pt; border-bottom: 3px solid #2f6fed; padding-bottom: 8px; margin-top: 0; }
h2 { font-size: 15pt; color:#2f6fed; margin-top: 26px; border-left: 5px solid #2f6fed; padding-left: 10px; page-break-after: avoid; }
h3 { font-size: 12pt; margin-top: 18px; page-break-after: avoid; }
table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 9.3pt; page-break-inside: auto; }
th { background:#eef3fd; color:#123; text-align:left; }
th, td { border: 1px solid #c9d4e8; padding: 5px 7px; vertical-align: top; }
tr { page-break-inside: avoid; }
td:first-child { white-space: nowrap; }
td code { font-size: 8.2pt; color:#7d7d7d; background:transparent; font-family: ui-monospace, Menlo, monospace; white-space: nowrap; }
blockquote { border-left: 4px solid #f0a500; background:#fff9e9; margin: 12px 0; padding: 8px 14px; }
blockquote p { margin: 4px 0; }
code { background:#f2f4f7; padding: 1px 4px; border-radius: 3px; font-size: 9pt; }
hr { border:0; border-top:1px dashed #c9d4e8; margin: 22px 0; }
strong { color:#1a3f8f; }
ul { margin: 6px 0 12px 0; }
"""
(HERE / "user-test-manual.html").write_text(
 f'<!doctype html><html lang="zh"><head><meta charset="utf-8"><style>{css}</style></head><body>{body}</body></html>', encoding="utf-8")
print("wrote", HERE / "user-test-manual.html")
