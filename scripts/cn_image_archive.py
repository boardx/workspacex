"""Archive transport contract only; never acquires credentials or mutates Docker."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

HOST = 'workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com'
PREFIX = HOST + '/workspacex-prod'
INSTANCE = 'cri-ttm0916mvdvg4ugx'
REPOSITORIES = dict(api='api', web='web', agent='deep-agent', sandbox='skill-sandbox', postgres='postgres-age')
MAX_ARCHIVE = 8 * 1024**3
MAX_TOTAL = 32 * 1024**3


class Rejected(ValueError):
    pass


def require(value, code):
    if not value:
        raise Rejected(code)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pairs(items):
    result = {}
    for key, value in items:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def decode(raw):
    try:
        return json.loads(raw, object_pairs_hook=pairs)
    except (UnicodeError, json.JSONDecodeError):
        raise Rejected('INVALID_JSON') from None


def hex_string(value, length):
    return isinstance(value, str) and re.fullmatch('[a-f0-9]{' + str(length) + '}', value)


def timestamp(value):
    require(isinstance(value, str), 'INVALID_TIMESTAMP')
    try:
        date = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        raise Rejected('INVALID_TIMESTAMP') from None
    require(date.tzinfo is not None, 'TIMEZONE_REQUIRED')
    return date


def validate_plan(plan):
    fields = {'schemaVersion', 'sourceRevision', 'controlRevision', 'release', 'attemptId',
              'platform', 'baseImages', 'maxArchiveBytes', 'maxTotalBytes', 'storageMarginBytes'}
    require(type(plan) is dict and set(plan) == fields, 'BUILD_PLAN_FIELDS')
    require(type(plan['schemaVersion']) is int and plan['schemaVersion'] == 1, 'BUILD_PLAN_SCHEMA')
    require(hex_string(plan['sourceRevision'], 40) and hex_string(plan['controlRevision'], 40), 'EXACT_SHA_REQUIRED')
    require(isinstance(plan['release'], str) and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?', plan['release']), 'RELEASE_INVALID')
    require(isinstance(plan['attemptId'], str) and re.fullmatch(r'[a-z0-9][a-z0-9-]{0,63}', plan['attemptId']), 'ATTEMPT_INVALID')
    require(plan['platform'] == 'linux/amd64', 'PLATFORM_NOT_SUPPORTED')
    bases = plan['baseImages']
    require(type(bases) is dict and set(bases) == {'node', 'python', 'postgres', 'redis'}, 'BASE_SET_INVALID')
    public = {'node': 'docker.io/library/node', 'python': 'docker.io/library/python', 'postgres': 'docker.io/pgvector/pgvector'}
    for key, repository in public.items():
        require(isinstance(bases[key], str) and re.fullmatch(re.escape(repository) + '@sha256:[a-f0-9]{64}', bases[key]), 'PUBLIC_BASE_DIGEST_REQUIRED')
    require(isinstance(bases['redis'], str) and re.fullmatch(re.escape(PREFIX + '/base-redis') + '@sha256:[a-f0-9]{64}', bases['redis']), 'EXISTING_REDIS_DIGEST_REQUIRED')
    for key, maximum in (('maxArchiveBytes', MAX_ARCHIVE), ('maxTotalBytes', MAX_TOTAL)):
        require(type(plan[key]) is int and 0 < plan[key] <= maximum, 'ARCHIVE_BUDGET_INVALID')
    require(plan['maxTotalBytes'] >= plan['maxArchiveBytes'], 'ARCHIVE_BUDGET_INVALID')
    require(type(plan['storageMarginBytes']) is int and 1024**3 <= plan['storageMarginBytes'] <= 32 * 1024**3, 'STORAGE_MARGIN_INVALID')
    return plan


def build_identity(plan):
    # Content identity excludes attempt, timestamps and storage/transport budgets.
    return sha(json_bytes({k: plan[k] for k in ('sourceRevision', 'controlRevision', 'platform', 'baseImages')}))


def staging_tag(plan, service):
    require(service in REPOSITORIES, 'SERVICE_INVALID')
    return 'wsx-archive-' + plan['attemptId'] + '/' + REPOSITORIES[service] + ':' + plan['sourceRevision']


def safe_name(name):
    require(isinstance(name, str) and 0 < len(name) <= 256, 'ARCHIVE_PATH_INVALID')
    p = PurePosixPath(name)
    require(not p.is_absolute() and '..' not in p.parts and str(p) == name and '\\' not in name, 'ARCHIVE_PATH_INVALID')
    require(re.fullmatch(r'[a-zA-Z0-9._/-]+', name) is not None, 'ARCHIVE_PATH_INVALID')


def members(tar):
    result = {}
    for member in tar:
        require(len(result) < 512, 'ARCHIVE_MEMBER_LIMIT')
        name = member.name.rstrip('/') if member.isdir() else member.name
        safe_name(name)
        require(name not in result and not member.pax_headers, 'ARCHIVE_DUPLICATE_OR_PAX')
        require(member.isfile() or member.isdir(), 'ARCHIVE_LINK_OR_SPECIAL_FILE')
        require(member.size >= 0, 'ARCHIVE_SIZE_INVALID')
        result[name] = member
    return result


def small_member(tar, member):
    require(member.isfile() and member.size <= 1024**2, 'ARCHIVE_JSON_TOO_LARGE')
    with tar.extractfile(member) as stream:
        raw = stream.read(1024**2 + 1)
    require(len(raw) == member.size, 'ARCHIVE_TRUNCATED')
    return raw


def member_digest(tar, member):
    require(member.isfile() and member.size <= MAX_ARCHIVE, 'LAYER_SIZE_INVALID')
    h = hashlib.sha256(); size = 0
    with tar.extractfile(member) as stream:
        while True:
            data = stream.read(1024**2)
            if not data:
                break
            size += len(data); require(size <= member.size, 'ARCHIVE_TRUNCATED')
            h.update(data)
    require(size == member.size, 'ARCHIVE_TRUNCATED')
    return h.hexdigest()


def inspect_archive(path, plan, service):
    """Inspect outer tar in memory/streams; never extract it onto a filesystem."""
    require(service in REPOSITORIES, 'SERVICE_INVALID')
    require(0 < Path(path).stat().st_size <= plan['maxArchiveBytes'], 'ARCHIVE_SIZE_LIMIT')
    with tarfile.open(path, 'r:') as tar:
        index = members(tar)
        require('manifest.json' in index, 'DOCKER_MANIFEST_MISSING')
        manifest = decode(small_member(tar, index['manifest.json']))
        require(type(manifest) is list and len(manifest) == 1, 'ONE_IMAGE_REQUIRED')
        item = manifest[0]
        require(type(item) is dict and set(item) == {'Config', 'RepoTags', 'Layers'}, 'DOCKER_MANIFEST_FIELDS')
        require(item['RepoTags'] == [staging_tag(plan, service)], 'STAGING_TAG_MISMATCH')
        config_name = item['Config']; safe_name(config_name)
        layer_names = item['Layers']
        require(type(layer_names) is list and 0 < len(layer_names) <= 128 and len(set(layer_names)) == len(layer_names), 'LAYER_SET_INVALID')
        for name in layer_names:
            safe_name(name)
        referenced = {'manifest.json', config_name, *layer_names}
        require(set(name for name, m in index.items() if m.isfile()) == referenced, 'UNREFERENCED_ARCHIVE_MEMBER')
        require(all(name in index for name in referenced), 'ARCHIVE_MEMBER_MISSING')
        config_raw = small_member(tar, index[config_name]); config = decode(config_raw)
        require(type(config) is dict and config.get('os') == 'linux' and config.get('architecture') == 'amd64', 'IMAGE_PLATFORM_MISMATCH')
        require(type(config.get('config')) is dict and type(config['config'].get('Labels')) is dict, 'IMAGE_LABELS_MISSING')
        require(config['config']['Labels'].get('org.opencontainers.image.revision') == plan['sourceRevision'], 'IMAGE_SOURCE_MISMATCH')
        require(config['config']['Labels'].get('org.workspacex.archive-build-identity') == build_identity(plan), 'IMAGE_BUILD_BINDING_MISMATCH')
        rootfs = config.get('rootfs')
        require(type(rootfs) is dict and rootfs.get('type') == 'layers' and type(rootfs.get('diff_ids')) is list, 'IMAGE_ROOTFS_INVALID')
        layers = [{'name': name, 'size': index[name].size, 'sha256': member_digest(tar, index[name])} for name in layer_names]
        require(rootfs['diff_ids'] == ['sha256:' + layer['sha256'] for layer in layers], 'LAYER_DIFF_ID_MISMATCH')
        return {'configSha256': sha(config_raw), 'imageId': 'sha256:' + sha(config_raw), 'layers': layers,
                'stagingTag': staging_tag(plan, service)}


def json_bytes(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def file_digest(path, maximum):
    h = hashlib.sha256(); size = 0
    with open(path, 'rb') as stream:
        while True:
            data = stream.read(1024**2)
            if not data:
                break
            size += len(data); require(size <= maximum, 'FILE_SIZE_LIMIT'); h.update(data)
    return size, h.hexdigest()


def validate_set(bundle, manifest_raw, expected_sha, plan, now=None, pinned_paths=None):
    require(len(manifest_raw) <= 256 * 1024 and sha(manifest_raw) == expected_sha, 'ARCHIVE_SET_HASH_MISMATCH')
    value = decode(manifest_raw)
    fields = {'schemaVersion', 'receiptKind', 'planSha256', 'producedAt', 'expiresAt', 'images', 'ready', 'prepared', 'productionActivated', 'sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform'}
    require(type(value) is dict and set(value) == fields and type(value['schemaVersion']) is int and value['schemaVersion'] == 1,
            'ARCHIVE_SET_FIELDS')
    require(value['receiptKind'] == 'cn-image-archive-set-v1' and value['planSha256'] == sha(json_bytes(validate_plan(plan))), 'ARCHIVE_SET_PLAN_MISMATCH')
    require(all(value[k] == plan[k] for k in ('sourceRevision', 'controlRevision', 'release', 'attemptId', 'platform')), 'ARCHIVE_SET_IDENTITY_MISMATCH')
    require(value['ready'] is False and value['prepared'] is False and value['productionActivated'] is False, 'ARCHIVE_SET_PRIVILEGE')
    issued = timestamp(value['producedAt']); expiry = timestamp(value['expiresAt'])
    clock = now or datetime.now(timezone.utc)
    require(0 < (expiry-issued).total_seconds() <= 3600 and issued <= clock < expiry, 'ARCHIVE_SET_EXPIRED')
    require(type(value['images']) is dict and set(value['images']) == set(REPOSITORIES), 'COMPLETE_FIVE_IMAGES_REQUIRED')
    total = 0
    for service, entry in value['images'].items():
        require(type(entry) is dict and set(entry) == {'file', 'size', 'sha256', 'configSha256', 'imageId', 'layers', 'stagingTag'}, 'ARCHIVE_ENTRY_FIELDS')
        require(entry['file'] == service + '.tar', 'ARCHIVE_FILENAME_MISMATCH')
        path = pinned_paths[service] if pinned_paths is not None else Path(bundle) / entry['file']
        size, digest = file_digest(path, plan['maxArchiveBytes'])
        require(type(entry['size']) is int and entry['size'] == size and entry['sha256'] == digest, 'ARCHIVE_CONTENT_MISMATCH')
        observed = inspect_archive(path, plan, service)
        require(observed == {k: entry[k] for k in observed}, 'ARCHIVE_IMAGE_METADATA_MISMATCH')
        total += size; require(total <= plan['maxTotalBytes'], 'ARCHIVE_TOTAL_LIMIT')
    return value, total


def validate_transport(transport, value, manifest_sha):
    """Approval binding only. No guessed bucket, credential fallback or OSS call."""
    fields = {'kind', 'bucket', 'region', 'endpoint', 'prefix', 'uploadPrincipal', 'downloadPrincipal', 'objects'}
    require(type(transport) is dict and set(transport) == fields and transport['kind'] == 'approved-oss-staging-v1', 'TRANSPORT_APPROVAL_REQUIRED')
    for key in ('bucket', 'region', 'prefix', 'uploadPrincipal', 'downloadPrincipal'):
        require(isinstance(transport[key], str) and 0 < len(transport[key]) <= 512 and not any(ord(c) < 32 for c in transport[key]), 'TRANSPORT_FIELD_INVALID')
    require(re.fullmatch(r'[a-z0-9][a-z0-9-]{1,61}[a-z0-9]', transport['bucket']), 'TRANSPORT_BUCKET_INVALID')
    require(re.fullmatch(r'cn-[a-z0-9-]+', transport['region']), 'TRANSPORT_REGION_INVALID')
    require(transport['endpoint'] == 'https://oss-' + transport['region'] + '.aliyuncs.com', 'TRANSPORT_ENDPOINT_INVALID')
    prefix = transport['prefix']; safe_name(prefix.rstrip('/'))
    require(prefix.endswith('/'), 'TRANSPORT_PREFIX_INVALID')
    objects = transport['objects']
    require(type(objects) is dict and set(objects) == {'archive-set.json', *[x + '.tar' for x in REPOSITORIES]}, 'TRANSPORT_OBJECT_SET')
    for file, item in objects.items():
        require(type(item) is dict and set(item) == {'key', 'versionId', 'sha256'}, 'TRANSPORT_OBJECT_FIELDS')
        safe_name(item['key']); require(item['key'].startswith(prefix), 'TRANSPORT_OBJECT_SCOPE')
        require(isinstance(item['versionId'], str) and len(item['versionId']) <= 256 and not any(ord(c) < 32 for c in item['versionId']), 'TRANSPORT_VERSION_INVALID')
        expected = manifest_sha if file == 'archive-set.json' else value['images'][file[:-4]]['sha256']
        require(item['sha256'] == expected, 'TRANSPORT_OBJECT_HASH')
    require(len({item['key'] for item in objects.values()}) == len(objects), 'TRANSPORT_DUPLICATE_KEY')
