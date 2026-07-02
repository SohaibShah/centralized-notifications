#!/usr/bin/env python3
"""Render docs/architecture.html from the diagrams in docs/architecture.md.

The output is a standalone viewer for the 6 Mermaid diagrams. Mermaid is loaded from a
CDN (so nothing vendored is committed — the git-safety secret scanner stays strict, and
this generator has no large binary blob). The generated architecture.html is gitignored;
regenerate it with:  python3 docs/scripts/render_architecture.py

Usage: python3 docs/scripts/render_architecture.py [architecture.md] [architecture.html]
"""
import html
import re
import sys

MD = sys.argv[1] if len(sys.argv) > 1 else "docs/architecture.md"
OUT = sys.argv[2] if len(sys.argv) > 2 else "docs/architecture.html"

CSS = """
  :root {
    --bg:#0f1419; --panel:#161b22; --border:#2b333d; --ink:#e6edf3;
    --muted:#8b98a5; --accent:#3b82f6;
  }
  * { box-sizing:border-box; }
  body {
    margin:0; background:var(--bg); color:var(--ink);
    font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  }
  header {
    padding:28px 32px 18px; border-bottom:1px solid var(--border);
    position:sticky; top:0; background:linear-gradient(180deg,var(--bg),rgba(15,20,25,.92)); z-index:5;
  }
  header h1 { margin:0 0 4px; font-size:20px; letter-spacing:.2px; }
  header p { margin:0; color:var(--muted); font-size:13px; }
  .wrap { display:grid; grid-template-columns:230px 1fr; gap:0; }
  nav {
    border-right:1px solid var(--border); padding:20px 14px; position:sticky; top:96px;
    align-self:start; height:calc(100vh - 96px); overflow:auto;
  }
  nav ul { list-style:none; margin:0; padding:0; }
  nav li { margin:2px 0; }
  nav a { color:var(--muted); text-decoration:none; font-size:13px; display:block; padding:6px 10px; border-radius:6px; }
  nav a:hover { color:var(--ink); background:var(--panel); }
  main { padding:24px 32px 80px; max-width:1100px; }
  .card {
    background:var(--panel); border:1px solid var(--border); border-radius:10px;
    padding:18px 20px 22px; margin:0 0 22px; scroll-margin-top:110px;
  }
  .card h2 { margin:0 0 14px; font-size:15px; color:var(--ink); font-weight:600; }
  .mermaid { background:#fbfcfd; border-radius:8px; padding:16px; overflow:auto; text-align:center; }
  footer { color:var(--muted); font-size:12px; padding:0 32px 40px; }
  a.src { color:var(--accent); }
"""

md = open(MD, encoding="utf-8").read()
diagrams = md.split("## Diagrams", 1)
if len(diagrams) < 2:
    sys.exit("no '## Diagrams' section found in " + MD)
pairs = re.findall(r"### (.+?)\n.*?```mermaid\n(.*?)\n```", diagrams[1], flags=re.DOTALL)
if len(pairs) != 6:
    sys.exit(f"expected 6 diagrams, found {len(pairs)}")

toc = "\n".join(
    f'<li><a href="#d{i}">{html.escape(title)}</a></li>' for i, (title, _) in enumerate(pairs, 1)
)
sections = "\n".join(
    f'<section class="card" id="d{i}">\n'
    f"  <h2>{html.escape(title)}</h2>\n"
    f'  <pre class="mermaid">{html.escape(block)}</pre>\n'
    f"</section>"
    for i, (title, block) in enumerate(pairs, 1)
)

doc = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Centralized Notification System — Architecture Diagrams</title>
<style>{CSS}</style>
</head>
<body>
<header>
  <h1>Centralized Notification System &mdash; Architecture Diagrams</h1>
  <p>Rendered from <code>docs/architecture.md</code> by <code>docs/scripts/render_architecture.py</code>. Mermaid loads from a CDN.</p>
</header>
<div class="wrap">
  <nav><ul>
{toc}
  </ul></nav>
  <main>
{sections}
  </main>
</div>
<footer>Regenerate by editing <code>docs/architecture.md</code> and running <code>python3 docs/scripts/render_architecture.py</code>.</footer>
<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>
<script>
  mermaid.initialize({{ startOnLoad:true, theme:"default", securityLevel:"loose", flowchart:{{ htmlLabels:true, curve:"basis" }} }});
</script>
</body>
</html>
"""

open(OUT, "w", encoding="utf-8").write(doc)
print(f"Rendered {OUT} ({len(pairs)} diagrams)")
