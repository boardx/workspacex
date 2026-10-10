"""Offline wheel admission/extraction. No pip, setup.py, imports or network.

Wheel hashes are an independently approved input. Provenance must be established
by the package producer; this reader does not equate a computed hash to approval.
"""
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

MAX_WHEEL = 32 * 1024**2
MAX_TOTAL = 192 * 1024**2


def need(value, code):
    if not value:
        raise ValueError(code)


def unique_json(raw):
    def pairs(items):
        result = {}
        for key, value in items:
            need(key not in result, 'JSON_DUPLICATE')
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=pairs)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def validate_manifest(raw):
    manifest = unique_json(raw)
    need(type(manifest) is dict and set(manifest) == {'kind', 'python', 'wheels'}, 'SDK_MANIFEST_FIELDS')
    need(manifest['kind'] == 'cn-oss-sdk-wheels-v1'
         and manifest['python'] == 'cp312-linux-x86_64', 'SDK_MANIFEST_TARGET')
    wheels = manifest['wheels']
    need(type(wheels) is list and 4 <= len(wheels) <= 40, 'SDK_WHEELS')
    names = set()
    packages = {}
    for wheel in wheels:
        need(type(wheel) is dict and set(wheel) == {'filename', 'sha256', 'size', 'package', 'version', 'originSha256'}, 'SDK_WHEEL_FIELDS')
        name = wheel['filename']
        need(type(name) is str and re.fullmatch(r'[A-Za-z0-9_.+-]+\.whl', name)
             and name not in names, 'SDK_WHEEL_NAME')
        names.add(name)
        need(type(wheel['size']) is int and 0 < wheel['size'] <= MAX_WHEEL
             and all(type(wheel[k]) is str and re.fullmatch('[0-9a-f]{64}', wheel[k])
                     for k in ('sha256', 'originSha256')), 'SDK_WHEEL_HASH')
        package = wheel['package'].lower().replace('_', '-').replace('.', '-')
        need(package not in packages and type(wheel['version']) is str, 'SDK_PACKAGE_DUPLICATE')
        packages[package] = wheel['version']
        # Linux CP312 accepts pure Python, CP312 and stable ABI wheels only.
        stem = name[:-4].rsplit('-', 3)
        need(len(stem) == 4, 'SDK_WHEEL_TAG')
        py, abi, platform = stem[1:]
        if platform == 'any':
            need(abi == 'none' and set(py.split('.')) <= {'py2', 'py3'}, 'SDK_WHEEL_TAG')
        else:
            need((py == 'cp312' and abi in ('cp312', 'abi3'))
                 or (abi == 'abi3' and re.fullmatch(r'cp3(?:[6-9]|1[01])', py)), 'SDK_WHEEL_ABI')
            need(all(re.fullmatch(r'manylinux_(?:2_(?:1[7-9]|2[0-9]|3[0-9])|2014)_x86_64', tag)
                     or tag in ('manylinux2014_x86_64', 'linux_x86_64') for tag in platform.split('.')), 'SDK_WHEEL_PLATFORM')
    expected = {'oss2': '2.19.1', 'alibabacloud-credentials': '0.3.6',
                'aliyun-python-sdk-core': '2.16.0', 'aliyun-python-sdk-sts': '3.1.2'}
    need(all(packages.get(k) == v for k, v in expected.items()), 'SDK_FIXED_DIRECT_DEPENDENCIES')
    return manifest


def extract_wheels(manifest_raw, reader, destination):
    """Extract admitted wheels into an empty private directory; never execute them."""
    manifest = validate_manifest(manifest_raw)
    root = Path(destination)
    need(root.is_dir() and not root.is_symlink() and not any(root.iterdir()), 'SDK_DESTINATION')
    files = {}
    total = 0
    for wheel in manifest['wheels']:
        raw = reader(wheel['filename'], wheel['size'])
        need(len(raw) == wheel['size'] and sha(raw) == wheel['sha256'], 'SDK_WHEEL_BYTES')
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            need(len(archive.infolist()) <= 10000, 'SDK_WHEEL_MEMBERS')
            for member in archive.infolist():
                name = member.filename
                path = PurePosixPath(name)
                need(name and not path.is_absolute() and '..' not in path.parts
                     and '\\' not in name and '\x00' not in name
                     and str(path) == name.rstrip('/'), 'SDK_MEMBER_PATH')
                mode = member.external_attr >> 16
                need(not mode or (mode & 0o170000) in (0, 0o040000, 0o100000), 'SDK_MEMBER_TYPE')
                need(not member.flag_bits & 1 and member.file_size <= MAX_WHEEL, 'SDK_MEMBER_SIZE')
                if member.is_dir():
                    continue
                need(not name.endswith(('.pth', '.pyc')) and not any(p.endswith('.data') for p in path.parts)
                     and name not in files, 'SDK_MEMBER_FORBIDDEN')
                total += member.file_size
                need(total <= MAX_TOTAL, 'SDK_TOTAL_LIMIT')
                content = archive.read(member)
                if name.endswith('.so'):
                    need(content[:5] == b'\x7fELF\x02' and content[5] == 1
                         and content[18:20] == b'\x3e\x00', 'SDK_NATIVE_ARCH')
                files[name] = content
    # Validate every archive before writing any executable dependency bytes.
    for name, content in files.items():
        target = root.joinpath(*PurePosixPath(name).parts)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with target.open('xb') as out:
            out.write(content)
        target.chmod(0o600)
    return len(files)
