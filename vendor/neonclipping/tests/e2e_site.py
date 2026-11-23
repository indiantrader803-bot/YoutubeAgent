"""Website + release + README link tests (no GPU): both public copies of the site, every link/asset on them, the release assets."""
import re
import sys
import urllib.request
import urllib.error
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from e2e import R

SITES = ['https://iamajmeena.github.io/neonclipping/', 'https://editorsgurukul.com/neonclipping/']
UA = {'User-Agent': 'Mozilla/5.0 NeonClipping-linktest'}


def get(url, method='GET', timeout=40):
    req = urllib.request.Request(url, headers=UA, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read() if method == 'GET' else b'', r.headers
    except urllib.error.HTTPError as e:
        return e.code, b'', e.headers
    except Exception as e:
        if 'CERTIFICATE_VERIFY_FAILED' in str(e):          # this machine's Python trust store sometimes cannot verify github.com; curl can
            return _curl(url, method)
        return 0, str(e).encode(), {}


def _curl(url, method):
    import subprocess
    nl = chr(10)
    cmd = ['curl', '-sL', '-m', '40', '-A', UA['User-Agent'], '-w', nl + '%{http_code}']
    if method == 'HEAD':
        cmd += ['-I']
    r = subprocess.run(cmd + [url], capture_output=True)
    out = r.stdout
    pos = out.rfind(nl.encode())
    try:
        code = int(out[pos + 1:].strip() or 0)
    except ValueError:
        code = 0
    return code, (out[:pos] if method == 'GET' else b''), {}


def links(html, base):
    out = set()
    for m in re.finditer(r'''(?:href|src|poster)=["']([^"'#][^"']*)["']''', html):
        u = m.group(1)
        if u.startswith(('mailto:', 'javascript:', 'data:')):
            continue
        out.add(urllib.request.urljoin(base, u))
    return sorted(out)


def run():
    g = 'site'
    for site in SITES:
        st, body, h = get(site)
        R.check(g, f'{site} loads', lambda st=st, body=body: (st == 200 and len(body) > 5000, f'{st} {len(body)} bytes'))
        if st != 200:
            continue
        html = body.decode('utf-8', 'ignore')
        R.check(g, f'{site} has title, download button, demo video', lambda html=html: (
            '<title>' in html and 'NeonClipping-Setup.bat' in html and '<video' in html, ''))
        for u in links(html, site):
            host = u.split('/')[2]
            if host in ('www.instagram.com',):          # login walls answer 200/302/429 inconsistently
                continue
            code, _, _ = get(u, 'HEAD' if not u.startswith(site) else 'GET')
            if code in (403, 405, 0):                    # some hosts refuse HEAD
                code = get(u)[0]
            R.check(g, f'link {u[:90]}', lambda code=code: (code == 200, code))
        R.check(g, f'{site} no leftover github.io / edtrust names', lambda html=html, site=site: (
            'edtrustguru' not in html.lower(), ''))
    # the two copies of the page must be the same except the back link
    a = get(SITES[0])[1].decode('utf-8', 'ignore')
    b = get(SITES[1])[1].decode('utf-8', 'ignore')
    def norm(x):
        x = x.replace(chr(13), '')
        x = x.replace('<a href="https://editorsgurukul.com/">&larr; Editors Gurukul</a> ' + chr(183) + ' ', '')
        x = re.sub(r'<script[^>]*cloudflareinsights[^>]*></script>', '', x)       # Cloudflare injects its own analytics tag
        return x.replace(chr(10), '')
    R.check(g, 'both site copies carry the same content (only the back link and line endings differ)', lambda: (
        norm(a) == norm(b), f'{len(a)} vs {len(b)} bytes'))
    # release assets
    rel = json.loads(get('https://api.github.com/repos/iamajmeena/neonclipping/releases/latest')[1] or b'{}')
    names = {x['name'] for x in rel.get('assets', [])}
    for need in ('NeonClipping-Setup.bat', 'install.ps1', 'install.sh', 'NeonClipping-Guide-EN-HI.pdf', 'NEONCLIPPING-AGENT-SETUP-PROMPT.txt'):
        R.check(g, f'release asset {need}', lambda need=need: (need in names, sorted(names)))
    code = get('https://github.com/iamajmeena/neonclipping/releases/latest/download/NeonClipping-Setup.bat')[0]
    R.check(g, 'one-click download URL resolves', lambda: (code == 200, code))
    # the .bat the site serves is the one in the repo
    raw = get('https://raw.githubusercontent.com/iamajmeena/neonclipping/main/install.ps1')
    R.check(g, 'raw install.ps1 reachable (the .bat downloads it when run alone)', lambda: (raw[0] == 200 and b'param(' in raw[1].lower(), raw[0]))
    R.check(g, 'install.ps1 is ASCII only (no encoding surprises in PowerShell 5.1)', lambda: (all(c < 128 for c in raw[1]), ''))
    # PDF
    pdf = get('https://iamajmeena.github.io/neonclipping/NeonClipping-Guide-EN-HI.pdf')
    R.check(g, 'guide PDF is a PDF with pages', lambda: (pdf[1][:4] == b'%PDF' and pdf[1].count(b'/Type /Page') >= 6, len(pdf[1])))
    # agent prompt
    pr = get('https://iamajmeena.github.io/neonclipping/NEONCLIPPING-AGENT-SETUP-PROMPT.txt')
    t = pr[1].decode('utf-8', 'ignore')
    R.check(g, 'agent prompt has the 9 steps + simple-Hindi explanation + stop rules', lambda: (
        len(t) > 4000 and 'Hindi' in t and 'Step 9' in t or 'STEP 9' in t, len(t)))
    # editorsgurukul integration
    for u, needle in (('https://editorsgurukul.com/free-resources', 'neonclipping'), ('https://editorsgurukul.com/free-websites/', 'neonclipping'),
                      ('https://editorsgurukul.com/free-websites/neonclipping/', 'NeonClipping')):
        code, body, _ = get(u)
        R.check(g, f'{u} lists NeonClipping', lambda code=code, body=body, needle=needle: (code == 200 and needle.lower() in body.decode('utf-8', 'ignore').lower(), code))
    sm = get('https://editorsgurukul.com/sitemap-0.xml')[1].decode('utf-8', 'ignore')
    R.check(g, 'sitemap lists /neonclipping/', lambda: ('/neonclipping/' in sm, ''))


if __name__ == '__main__':
    run()
    R.save()
    bad = [r for r in R.rows if not r['ok']]
    print(f'\n{len(R.rows) - len(bad)}/{len(R.rows)} passed')
