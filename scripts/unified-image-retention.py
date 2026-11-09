#!/usr/bin/env python3
"""Retain canonical current/previous and all container images; never prune volumes."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

ROOT = Path('/srv/workspacex')

def need(condition, code):
    if not condition:
        raise ValueError(code)

def read(path):
    path = Path(path)
    need(not path.is_symlink(), 'UNTRUSTED_FILE')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as stream:
        info = os.fstat(stream.fileno())
        need(stat.S_ISREG(info.st_mode) and info.st_uid == 0 and not info.st_mode & 0o077, 'UNTRUSTED_FILE')
        return json.load(stream)

def docker(*args):
    return subprocess.check_output(['/usr/bin/docker', *args], text=True, timeout=90).strip()

def plan(config, versions, containers, images, now):
    current, previous = versions['current'], versions['previous']
    services = set(config['services'])
    need(services and set(current['images']) == services and set(previous['images']) == services, 'SERVICE_SET_CHANGED')
    keep = set(current['images'].values()) | set(previous['images'].values())
    keep.update(row['Image'] for row in containers)
    for service in services:
        matches = [row for row in containers if (row['Config'].get('Labels') or {}).get('com.docker.compose.project') == config['project'] and (row['Config'].get('Labels') or {}).get('com.docker.compose.service') == service and row['State']['Running']]
        need(len(matches) == 1 and matches[0]['Image'] == current['images'][service], 'RUNTIME_DRIFT')
    prefix = config['registryPrefix'].rstrip('/') + '/'
    candidates = []
    for image in images:
        refs = (image.get('RepoTags') or []) + (image.get('RepoDigests') or [])
        if image['Id'] in keep or not refs or not all(ref.startswith(prefix) for ref in refs):
            continue
        created = datetime.datetime.fromisoformat(image['Created'].replace('Z', '+00:00'))
        need(created.tzinfo is not None, 'INVALID_IMAGE_TIME')
        if (now - created).total_seconds() >= 86400:
            candidates.append({'id': image['Id'], 'tags': image.get('RepoTags') or [], 'refs': refs})
    return keep, candidates

def main(environment, apply=False):
    need(os.geteuid() == 0, 'ROOT_REQUIRED')
    cfg = read(ROOT / 'config/release.json')
    need(cfg['environment'] == environment, 'WRONG_ENVIRONMENT')
    lock_path = Path(cfg['lockFile'])
    need(not lock_path.is_symlink(), 'UNTRUSTED_LOCK')
    fd = os.open(lock_path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as lock:
        need(os.fstat(lock.fileno()).st_uid == 0, 'UNTRUSTED_LOCK')
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        need(not (ROOT / 'log/active.json').exists(), 'RELEASE_RECONCILIATION_REQUIRED')
        versions = read(ROOT / 'config/versions.json')
        attempt = Path(versions['attempt'])
        need(attempt.parent == ROOT / 'log' and attempt.name.startswith('release-'), 'ATTEMPT_PATH')
        result = read(attempt / 'result.json')
        need(result['status'] == 'SUCCEEDED' and result['attempt'] == str(attempt) and result['tag'] == versions['current']['tag'], 'RELEASE_NOT_SUCCEEDED')
        ids = docker('ps', '-aq').split()
        containers = json.loads(docker('inspect', *ids)) if ids else []
        image_ids = sorted(set(docker('image', 'ls', '-aq', '--no-trunc').split()))
        images = json.loads(docker('image', 'inspect', *image_ids)) if image_ids else []
        keep, candidates = plan(cfg, versions, containers, images, datetime.datetime.now(datetime.timezone.utc))
        print(json.dumps({'environment': environment, 'protectedImageCount': len(keep), 'candidateCount': len(candidates), 'candidates': candidates, 'apply': apply}), flush=True)
        if apply:
            for item in candidates:
                # Recheck identity and refs before each deletion. Never force Docker references.
                actual = json.loads(docker('image', 'inspect', item['id']))[0]
                need(set((actual.get('RepoTags') or []) + (actual.get('RepoDigests') or [])) == set(item['refs']), 'IMAGE_REFS_CHANGED')
                for tag in item['tags']:
                    need(json.loads(docker('image', 'inspect', tag))[0]['Id'] == item['id'], 'IMAGE_TAG_CHANGED')
                    docker('image', 'rm', tag)
                if subprocess.run(['/usr/bin/docker', 'image', 'inspect', item['id']], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=90).returncode == 0:
                    docker('image', 'rm', item['id'])
        print('OK retention check complete', flush=True)

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('environment', choices=['devapp', 'cn', 'us'])
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    try:
        main(args.environment, args.apply)
    except Exception:
        print('STOP retention withheld; inspect trusted state and runtime', file=sys.stderr)
        sys.exit(1)
