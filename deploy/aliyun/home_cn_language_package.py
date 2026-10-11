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
from urllib.parse import urljoin, urlsplit, urlunsplit

ORIGIN = 'https://www.boardx.com.cn'
SOURCE_ORIGIN = 'https://workspacex.us'
EN_PATHS = {'/': '/en/', '/index.html': '/en/',
            '/privacy': '/en/privacy', '/privacy.html': '/en/privacy'}
ATTR = re.compile(r'\b(href|src|action|poster)=("|\')(.*?)\2')


def mapped_url(value, original_path):
    if not value or value.startswith(('#', 'mailto:', 'tel:', 'data:')):
        return value
    parsed = urlsplit(urljoin(SOURCE_ORIGIN + original_path, value))
    if parsed.scheme not in ('https', 'http') or parsed.netloc not in (
            'workspacex.us', 'www.boardx.com.cn'):
        return value
    path = EN_PATHS.get(parsed.path, parsed.path)
    result = urlunsplit(('', '', path, parsed.query, parsed.fragment))
    return ORIGIN + result if value.startswith(('https://', 'http://')) else result


def transform_html(text, original_path, destination_path):
    text = ATTR.sub(lambda m: m[1] + '=' + m[2] + mapped_url(m[3], original_path) + m[2], text)
    # Canonical and social URLs describe the destination, including the new CN root.
    text = re.sub(r'(<link rel="canonical" href=")[^"]+("\s*/?>)',
                  lambda m: m[1] + ORIGIN + destination_path + m[2], text)
    text = re.sub(r'(<meta property="og:url" content=")[^"]+("\s*/?>)',
                  lambda m: m[1] + ORIGIN + destination_path + m[2], text)
    text = text.replace(SOURCE_ORIGIN + '/', ORIGIN + '/')
    # x-default is now Chinese. Explicit en/zh alternatives remain available.
    default_path = '/privacy' if 'privacy' in destination_path else '/'
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
    if any(p.is_symlink() for p in source.rglob('*')):
        raise ValueError('Symlinks are not accepted in the input package')
    shutil.copytree(source, destination)
    # Transform every original page against its ORIGINAL location before moving it.
    pages = {str(p.relative_to(source)): p.read_text() for p in source.rglob('*.html')}
    for relative, text in pages.items():
        original = '/' + relative
        canonical = original.removesuffix('index.html').removesuffix('.html')
        (destination / relative).write_text(transform_html(text, original, canonical))
    (destination / 'en').mkdir(exist_ok=True)
    for name in ('index.html', 'privacy.html'):
        suffix = '' if name == 'index.html' else 'privacy'
        (destination / 'en' / name).write_text(transform_html(pages[name], '/' + name, '/en/' + suffix))
        (destination / name).write_text(transform_html(pages['zh/' + name], '/zh/' + name, '/' + suffix))
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
    urls = ('/', '/zh/', '/en/', '/privacy', '/zh/privacy', '/en/privacy', '/manual/')
    sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n'
    sitemap += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    sitemap += ''.join(f'  <url><loc>{ORIGIN}{url}</loc></url>\n' for url in urls)
    (destination / 'sitemap.xml').write_text(sitemap + '</urlset>\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input_public', type=Path)
    parser.add_argument('new_output', type=Path)
    args = parser.parse_args()
    build_cn_package(args.input_public, args.new_output)
