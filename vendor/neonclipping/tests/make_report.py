"""Turn tests/report.json into tests/REPORT.md (what was tested, result per check, and what was found and fixed)."""
import json
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
rows = json.loads((HERE / 'report.json').read_text(encoding='utf-8'))
fixes = json.loads((HERE / 'fixes.json').read_text(encoding='utf-8')) if (HERE / 'fixes.json').exists() else []
order = ['static', 'export', 'edit', 'make', 'style', 'features', 'live', 'phone', 'creators', 'feedback', 'ui', 'installer', 'unit', 'site']
titles = {'static': 'Page, API and input validation', 'export': 'Rendering: 11 layouts x 5 caption styles x positions',
          'edit': 'Editing saved clips (one / all clips of a video)', 'make': 'Make clips: sources, modes, languages, errors',
          'live': 'Live clipping on a real stream', 'phone': 'Phone remote over the real Wi-Fi address: PIN gate, PC-only routes, live clipping from the phone', 'creators': 'Creator list', 'feedback': 'Star ratings and learning',
          'style': 'Style extras: templates, background card, watermark, credit, outro, music', 'features': 'Caption animations, SRT/ASS import, facecam finder, AI parts, Make with moments', 'ui': 'Browser UI', 'installer': 'One-click installer', 'unit': 'Unit tests', 'site': 'Website, links, release, editorsgurukul'}
out = [f'# NeonClipping test report\n', f'Generated {time.strftime("%Y-%m-%d %H:%M")} by tests/make_report.py from tests/report.json.\n']
total = len(rows)
ok = sum(1 for r in rows if r['ok'])
out.append(f'**{ok} of {total} checks pass.**\n')
if fixes:
    out.append('## Problems found by the tests and fixed\n')
    out.append('| # | Found | Fix |\n|---|---|---|')
    for i, f in enumerate(fixes, 1):
        out.append(f'| {i} | {f["found"]} | {f["fix"]} |')
    out.append('')
for g in order:
    rs = [r for r in rows if r['group'] == g]
    if not rs:
        continue
    out.append(f'## {titles.get(g, g)}  ({sum(1 for r in rs if r["ok"])}/{len(rs)})\n')
    out.append('| Result | Check | Evidence |\n|---|---|---|')
    for r in rs:
        ev = str(r['evidence']).replace('|', '/').replace('\n', ' ')[:140]
        out.append(f'| {"PASS" if r["ok"] else "**FAIL**"} | {r["name"]} | {ev} |')
    out.append('')
(HERE / 'REPORT.md').write_text('\n'.join(out), encoding='utf-8')
print('wrote REPORT.md', ok, '/', total)
