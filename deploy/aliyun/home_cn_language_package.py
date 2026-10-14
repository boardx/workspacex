#!/usr/bin/env python3
"""Prepare a CN-only ESA Pages copy; never modify the shared/US home source.

Usage: python3 deploy/aliyun/home_cn_language_package.py INPUT_PUBLIC NEW_OUTPUT
The input is an already built bilingual package, English at / and Chinese at
/zh/. Language remains an explicit URL choice, not browser-language state.
"""
import argparse
import json
from pathlib import Path
import re
import shutil
import xml.etree.ElementTree as ET
from urllib.parse import urljoin, urlsplit, urlunsplit

CONFIG = json.loads(Path(__file__).with_name('home-cn-domains.json').read_text())
ORIGIN = CONFIG['marketingOrigin']
SOURCE_ORIGIN = 'https://workspacex.us'
SOURCE_APP_ORIGIN = 'https://devapp.boardx.us'
APP_ORIGIN = 'https://app.boardx.com.cn'
ICP_NUMBER = '粤ICP备2021115740号'
ICP_QUERY = 'https://beian.miit.gov.cn/'


def add_icp_footer(text):
    """Static CN-only markup: visible without JS, including mobile."""
    if 'data-cn-icp' in text or ICP_NUMBER in text:
        raise ValueError('Input already contains ICP markup; use the original US package')
    style = '<link rel="stylesheet" href="/assets/css/cn-icp.css">'
    if '</head>' not in text or '</body>' not in text:
        raise ValueError('Expected a complete HTML document')
    text = text.replace('</head>', style + '\n</head>', 1)
    link = (f'<p class="cn-icp" data-cn-icp><a href="{ICP_QUERY}" '
            f'rel="noopener noreferrer">{ICP_NUMBER}</a></p>')
    if '</footer>' in text:
        return text.replace('</footer>', link + '\n</footer>', 1)
    return text.replace('</body>', '<footer>' + link + '</footer>\n</body>', 1)
EN_PATHS = {'/': '/en/', '/index.html': '/en/',
            '/privacy': '/en/privacy', '/privacy.html': '/en/privacy'}
ATTR = re.compile(r'\b(href|src|action|poster)=("|\')(.*?)\2')


def mapped_url(value, original_path):
    if not value or value.startswith(('#', 'mailto:', 'tel:', 'data:')):
        return value
    parsed = urlsplit(urljoin(SOURCE_ORIGIN + original_path, value))
    if parsed.scheme in ('http', 'https') and parsed.netloc == urlsplit(SOURCE_APP_ORIGIN).netloc:
        return APP_ORIGIN + urlunsplit(('', '', parsed.path, parsed.query, parsed.fragment))
    if parsed.scheme not in ('https', 'http') or parsed.netloc not in (
            'workspacex.us', 'www.boardx.com.cn'):
        return value
    path = EN_PATHS.get(parsed.path, parsed.path)
    result = urlunsplit(('', '', path, parsed.query, parsed.fragment))
    return ORIGIN + result if value.startswith(('https://', 'http://')) else result


def transform_html(text, original_path, destination_path, en_paths=None):
    en_paths = EN_PATHS if en_paths is None else en_paths
    def map_url(value):
        mapped = mapped_url(value, original_path)
        parsed = urlsplit(mapped)
        if parsed.netloc and parsed.netloc != urlsplit(ORIGIN).netloc:
            return mapped
        if not value or value.startswith(('#', 'mailto:', 'tel:', 'data:')):
            return mapped
        path = en_paths.get(parsed.path, parsed.path)
        return urlunsplit((parsed.scheme, parsed.netloc, path, parsed.query, parsed.fragment))
    text = ATTR.sub(lambda m: m[1] + '=' + m[2] + map_url(m[3]) + m[2], text)
    # Canonical and social URLs describe the destination, including the new CN root.
    text = re.sub(r'(<link rel="canonical" href=")[^"]+("\s*/?>)',
                  lambda m: m[1] + ORIGIN + destination_path + m[2], text)
    text = re.sub(r'(<meta property="og:url" content=")[^"]+("\s*/?>)',
                  lambda m: m[1] + ORIGIN + destination_path + m[2], text)
    text = text.replace(SOURCE_ORIGIN + '/', ORIGIN + '/')
    # x-default is now Chinese. Explicit en/zh alternatives remain available.
    default_path = destination_path.removeprefix('/en').removeprefix('/zh') or '/'
    text = re.sub(r'(<link rel="alternate" hreflang="x-default" href=")[^"]+("\s*/?>)',
                  lambda m: m[1] + ORIGIN + default_path + m[2], text)
    return text.replace('x-default points at the English page.',
                        'x-default points at the Chinese page on this CN deployment.')


def build_cn_package(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    if destination == source or source in destination.parents or destination in source.parents:
        raise ValueError('Input and output must be separate, non-overlapping directories')
    if destination.exists():
        raise ValueError('Output must not exist; refusing to replace an existing package')
    for relative, language in [('index.html', 'en'), ('zh/index.html', 'zh-Hans'),
                               ('privacy.html', 'en'), ('zh/privacy.html', 'zh-Hans')]:
        if f'<html lang="{language}"' not in (source / relative).read_text():
            raise ValueError('Unexpected bilingual input: ' + relative)
    for page in source.rglob('*.html'):
        if ICP_NUMBER in page.read_text() or 'data-cn-icp' in page.read_text():
            raise ValueError('Expected an ICP-free US package')
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Symlinks are not accepted in the input package')
    shutil.copytree(source, destination)
    # Transform every original page against its ORIGINAL location before moving it.
    pages = {str(p.relative_to(source)): p.read_text() for p in source.rglob('*.html')}
    # Discover bilingual pairs so new landing pages retain the CN default language.
    pairs = {name: 'zh/' + name for name in pages if 'zh/' + name in pages
             and '<html lang="en"' in pages[name]
             and '<html lang="zh-Hans"' in pages['zh/' + name]}
    en_paths = dict(EN_PATHS)
    for name in pairs:
        original = '/' + name
        canonical = original.removesuffix('index.html').removesuffix('.html')
        en_paths[original] = '/en' + canonical
        en_paths[canonical] = '/en' + canonical
    for relative, text in pages.items():
        original = '/' + relative
        canonical = original.removesuffix('index.html').removesuffix('.html')
        (destination / relative).write_text(transform_html(text, original, canonical, en_paths))
    (destination / 'en').mkdir(exist_ok=True)
    for name, chinese in pairs.items():
        canonical = ('/' + name).removesuffix('index.html').removesuffix('.html')
        target = destination / 'en' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(transform_html(pages[name], '/' + name, '/en' + canonical, en_paths))
        (destination / name).write_text(transform_html(pages[chinese], '/' + chinese, canonical, en_paths))
    # Never insert this into shared sources or decide from browser language.
    for page in destination.rglob('*.html'):
        page.write_text(add_icp_footer(page.read_text()))
    css = destination / 'assets/css/cn-icp.css'
    css.parent.mkdir(parents=True, exist_ok=True)
    css.write_text('.cn-icp { margin: 1rem auto; padding: 0 1rem; text-align: center; '
                   'font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }\n'
                   '.cn-icp a { display: inline-flex; align-items: center; '
                   'min-height: 44px; max-width: 100%; color: inherit; }\n')
    redirects = destination / '_redirects'
    lines = redirects.read_text().splitlines()
    lines = [line for line in lines if not re.match(r'^/en(?:\s|/\*)', line)]
    redirects.write_text('\n'.join(lines) + '\n/en /en/ 301\n')
    # Both the source module and deployed bundle use the same explicit English fallback.
    for path in (destination / 'assets/js').glob('*.js'):
        text = path.read_text()
        text = text.replace("action: 'Switch to English', href: '/'",
                            "action: 'Switch to English', href: '/en/'")
        path.write_text(text)
    for name, start in [('site.webmanifest', '/en/'), ('site.zh.webmanifest', '/')]:
        path = destination / 'assets' / name
        data = json.loads(path.read_text())
        data['start_url'] = start
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
    robots = destination / 'robots.txt'
    robots.write_text(robots.read_text().replace(SOURCE_ORIGIN, ORIGIN))
    # CN sitemap has CN destinations only; no US deployment files are touched.
    urls = {'/', '/zh/', '/en/', '/privacy', '/zh/privacy', '/en/privacy', '/manual/'}
    source_sitemap = source / 'sitemap.xml'
    if source_sitemap.exists():
        ns = {'s': 'http://www.sitemaps.org/schemas/sitemap/0.9'}
        for loc in ET.fromstring(source_sitemap.read_text()).findall('s:url/s:loc', ns):
            parsed = urlsplit(loc.text or '')
            if parsed.netloc != urlsplit(SOURCE_ORIGIN).netloc:
                raise ValueError('Unexpected sitemap origin')
            urls.add(en_paths.get(parsed.path, parsed.path))
    for name in pairs:
        path = ('/' + name).removesuffix('index.html').removesuffix('.html')
        urls.update((path, '/zh' + path, '/en' + path))
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += ''.join(f'  <url><loc>{ORIGIN}{url}</loc></url>\n' for url in sorted(urls))
    (destination / 'sitemap.xml').write_text(sitemap + '</urlset>\n')
    marker = destination / '.well-known/workspacex-release.json'
    if marker.exists():
        release = json.loads(marker.read_text())
        release.update(project=CONFIG['routine'], region='cn', origin=ORIGIN,
                       icp=ICP_NUMBER, filingCoverage='requires-official-verification')
        marker.write_text(json.dumps(release, ensure_ascii=False) + '\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_public', type=Path)
    parser.add_argument('new_output', type=Path)
    args = parser.parse_args()
    build_cn_package(args.input_public, args.new_output)
