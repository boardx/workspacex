"""CN packaging regression tests; run with python3 -m unittest discover
-s deploy/aliyun -p test_home_cn_language_package.py. No production operations.
"""
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen

from home_cn_language_package import build_cn_package, transform_html


def fingerprints(root):
    return {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in root.rglob('*') if p.is_file()}


class PackageTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'us'
        self.output = Path(self.tmp.name) / 'cn'
        for subdir in ('zh', 'assets/js'):
            (self.source / subdir).mkdir(parents=True, exist_ok=True)
        for language, prefix in [('en', ''), ('zh-Hans', 'zh/')]:
            for page in ('index.html', 'privacy.html'):
                privacy = page == 'privacy.html'
                tail = 'privacy' if privacy else ''
                html = f'''<!doctype html><html lang="{language}"><head>
<link rel="canonical" href="https://workspacex.us/{prefix}{tail}">
<link rel="alternate" hreflang="en" href="https://workspacex.us/{tail}">
<link rel="alternate" hreflang="zh-Hans" href="https://workspacex.us/zh/{tail}">
<link rel="alternate" hreflang="x-default" href="https://workspacex.us/{tail}">
<meta property="og:url" content="https://workspacex.us/{prefix}{tail}">
<script src="{'../' if prefix else ''}assets/js/site.js"></script>
</head><body><a href="/{tail}" hreflang="en">EN</a>
<a href="/zh/{tail}" hreflang="zh-Hans">中文</a>
<a href="#main">Section</a><a href="https://app.boardx.com.cn/">App</a>
</body></html>'''
                (self.source / prefix / page).write_text(html)
        (self.source / '_redirects').write_text('/zh /zh/ 301\n/en / 301\n/en/* /:splat 301\n/security /.well-known/security.txt 301\n')
        (self.source / 'robots.txt').write_text('Sitemap: https://workspacex.us/sitemap.xml\n')
        (self.source / 'assets/js/site.js').write_text("const HINT = {en: {action: 'Switch to English', href: '/'}};")
        for name in ('site.webmanifest', 'site.zh.webmanifest'):
            (self.source / 'assets' / name).write_text(json.dumps({'start_url': '/'}))
        self.before = fingerprints(self.source)
        build_cn_package(self.source, self.output)

    def test_cn_default_and_explicit_language_urls(self):
        for page, lang in [('index.html', 'zh-Hans'), ('privacy.html', 'zh-Hans'),
                           ('zh/index.html', 'zh-Hans'), ('en/index.html', 'en'),
                           ('en/privacy.html', 'en')]:
            self.assertIn(f'<html lang="{lang}"', (self.output / page).read_text())
        self.assertEqual(fingerprints(self.source), self.before)
        self.assertIn('<html lang="en"', (self.source / 'index.html').read_text())

    def test_links_assets_metadata_and_manual_choice(self):
        root = (self.output / 'index.html').read_text()
        self.assertIn('href="/en/" hreflang="en"', root)
        self.assertIn('href="/zh/" hreflang="zh-Hans"', root)
        for page in ('index.html', 'en/index.html', 'zh/index.html'):
            text = (self.output / page).read_text()
            self.assertIn('src="/assets/js/site.js"', text)
            self.assertIn('href="#main"', text)
            self.assertIn('href="https://app.boardx.com.cn/"', text)
            self.assertIn('hreflang="x-default" href="https://www.boardx.com.cn/"', text)
            self.assertNotIn('https://workspacex.us/', text)
        self.assertIn('rel="canonical" href="https://www.boardx.com.cn/en/"',
                      (self.output / 'en/index.html').read_text())
        self.assertIn('href="/en/privacy" hreflang="en"',
                      (self.output / 'privacy.html').read_text())
        self.assertIn("href: '/en/'", (self.output / 'assets/js/site.js').read_text())
        redirects = (self.output / '_redirects').read_text()
        self.assertNotIn('/en/*', redirects)
        self.assertIn('/en /en/ 301', redirects)
        self.assertEqual(json.loads((self.output / 'assets/site.webmanifest').read_text())['start_url'], '/en/')
        self.assertEqual(json.loads((self.output / 'assets/site.zh.webmanifest').read_text())['start_url'], '/')

    def test_first_visit_english_browser_header_and_explicit_english(self):
        output = self.output
        class Handler(SimpleHTTPRequestHandler):
            def __init__(self, *args, **kwargs):
                super().__init__(*args, directory=str(output), **kwargs)
            def log_message(self, *args):
                pass
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for path, lang in [('/', 'zh-Hans'), ('/en/', 'en'), ('/zh/', 'zh-Hans')]:
                req = Request(f'http://127.0.0.1:{server.server_port}{path}',
                              headers={'Accept-Language': 'en-US,en;q=0.9'})
                with urlopen(req) as response:
                    self.assertEqual(response.status, 200)
                    self.assertIn(f'<html lang="{lang}"', response.read().decode())
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_refuses_overwrite_or_source_overlap(self):
        for destination in (self.output, self.source, self.source / 'nested'):
            with self.assertRaises(ValueError):
                build_cn_package(self.source, destination)
        self.assertEqual(fingerprints(self.source), self.before)

    def test_query_fragment_and_external_urls_survive(self):
        text = '<a href="../privacy?x=1#part">x</a><a href="https://example.org/">e</a>'
        result = transform_html(text, '/zh/index.html', '/')
        self.assertIn('/en/privacy?x=1#part', result)
        self.assertIn('https://example.org/', result)
        self.assertIn('https://app.boardx.com.cn/start?next=%2Fhome#section',
                      transform_html('<a href="https://devapp.boardx.us/start?next=%2Fhome#section">Start</a>',
                                     '/index.html', '/'))

    def test_new_bilingual_landing_page_keeps_cn_default_and_english_choice(self):
        for language, prefix in [('en', ''), ('zh-Hans', 'zh/')]:
            folder = self.source / prefix / 'aidt'
            folder.mkdir(parents=True)
            (folder / 'index.html').write_text(f'''<html lang="{language}"><head>
<link rel="canonical" href="https://workspacex.us/{prefix}aidt/">
<link rel="alternate" hreflang="x-default" href="https://workspacex.us/aidt/">
</head><body><a href="/aidt/" hreflang="en">EN</a>
<a href="/zh/aidt/" hreflang="zh-Hans">中文</a>
<link rel="stylesheet" href="/assets/css/aidt.css"></body></html>''')
        self.source.joinpath('sitemap.xml').write_text('''<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://workspacex.us/aidt/</loc></url>
<url><loc>https://workspacex.us/zh/aidt/</loc></url></urlset>''')
        before = fingerprints(self.source)
        output = Path(self.tmp.name) / 'cn-with-aidt'
        build_cn_package(self.source, output)
        for relative, language in [('aidt/index.html', 'zh-Hans'),
                                   ('en/aidt/index.html', 'en'),
                                   ('zh/aidt/index.html', 'zh-Hans')]:
            text = (output / relative).read_text()
            self.assertIn(f'<html lang="{language}"', text)
            self.assertIn('href="/en/aidt/" hreflang="en"', text)
            self.assertIn('href="/zh/aidt/" hreflang="zh-Hans"', text)
            self.assertIn('hreflang="x-default" href="https://www.boardx.com.cn/aidt/"', text)
            self.assertIn('href="/assets/css/aidt.css"', text)
            canonical = relative.removesuffix('index.html')
            self.assertIn(f'rel="canonical" href="https://www.boardx.com.cn/{canonical}"', text)
            self.assertIn(f'<loc>https://www.boardx.com.cn/{canonical}</loc>', (output / 'sitemap.xml').read_text())
        self.assertEqual(fingerprints(self.source), before)


if __name__ == '__main__':
    unittest.main()
