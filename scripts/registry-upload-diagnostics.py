#!/usr/bin/env python3
"""Bounded manual ACR diagnostic; uses the job's existing Docker login only."""
import argparse
from contextvars import ContextVar
import importlib.util
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import sys
import tempfile
import time

_spec = importlib.util.spec_from_file_location('registry_images', Path(__file__).with_name('registry-images.py'))
registry = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(registry)

MAX_OUTPUT = 2 * 1024 * 1024
MAX_DESCRIPTORS = 512
DIAGNOSTIC_SECONDS = 420
_DEADLINE = ContextVar('registry_diagnostic_deadline', default=None)
DIGEST = re.compile(r'sha256:[a-f0-9]{64}\Z')
IMAGE_ID = DIGEST
PROGRESS = re.compile(r'^([a-f0-9]{12,64}): (Preparing|Waiting|Pushing|Pushed|Layer already exists|Pulling fs layer|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)(?:\s|$)')
MEDIA = {
    'application/vnd.docker.distribution.manifest.v2+json': 'manifest',
    'application/vnd.docker.distribution.manifest.list.v2+json': 'index',
    'application/vnd.docker.container.image.v1+json': 'config',
    'application/vnd.docker.image.rootfs.diff.tar.gzip': 'layer',
    'application/vnd.oci.image.manifest.v1+json': 'manifest',
    'application/vnd.oci.image.index.v1+json': 'index',
    'application/vnd.oci.image.config.v1+json': 'config',
    'application/vnd.oci.image.layer.v1.tar': 'layer',
    'application/vnd.oci.image.layer.v1.tar+gzip': 'layer',
    'application/vnd.oci.image.layer.v1.tar+zstd': 'layer',
}


class DiagnosticError(Exception):
    """Only fixed internal codes cross the output boundary."""


def need(condition, code):
    if not condition:
        raise DiagnosticError(code)


def emit(value):
    print(json.dumps(value, sort_keys=True, separators=(',', ':')), flush=True)


def bounded_command(args, timeout, progress=None):
    deadline = _DEADLINE.get()
    if deadline is not None:
        remaining = deadline - time.monotonic()
        need(remaining > 0, 'DIAGNOSTIC_DEADLINE')
        timeout = min(timeout, remaining)
    try:
        result = command(args, timeout, progress)
    except DiagnosticError as error:
        if str(error) == 'COMMAND_TIMEOUT' and deadline is not None and time.monotonic() >= deadline:
            raise DiagnosticError('DIAGNOSTIC_DEADLINE') from None
        raise
    need(deadline is None or time.monotonic() < deadline, 'DIAGNOSTIC_DEADLINE')
    return result


def command(args, timeout, progress=None):
    """One Docker process, bounded output and deadline; never print raw output."""
    start = time.monotonic()
    captured = bytearray()
    pending = ''
    proc = None
    try:
        proc = subprocess.Popen(['docker', *args], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        with selectors.DefaultSelector() as selector:
            selector.register(proc.stdout, selectors.EVENT_READ)
            while selector.get_map():
                remaining = timeout - (time.monotonic() - start)
                need(remaining > 0, 'COMMAND_TIMEOUT')
                for key, _event in selector.select(min(remaining, 1)):
                    data = os.read(key.fd, 4096)
                    if not data:
                        selector.unregister(key.fileobj)
                        continue
                    captured.extend(data)
                    need(len(captured) <= MAX_OUTPUT, 'COMMAND_OUTPUT_LIMIT')
                    if progress is not None:
                        pending += data.decode('utf-8', errors='replace')
                        lines = re.split(r'[\r\n]', pending)
                        pending = lines.pop()
                        need(len(pending) <= 4096, 'COMMAND_OUTPUT_LIMIT')
                        for line in lines:
                            progress(line, round(time.monotonic() - start, 3))
            remaining = timeout - (time.monotonic() - start)
            need(remaining > 0, 'COMMAND_TIMEOUT')
            status = proc.wait(timeout=remaining)
        if progress is not None and pending:
            progress(pending, round(time.monotonic() - start, 3))
        return status, captured.decode('utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        raise DiagnosticError('COMMAND_TIMEOUT') from None
    except OSError:
        raise DiagnosticError('DOCKER_EXECUTION_FAILED') from None
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.kill()
                proc.wait(timeout=5)
            if proc.stdout is not None:
                proc.stdout.close()


def manifest_metadata(raw):
    """Extract descriptors only, never Ref/URLs/annotations/config/history."""
    try:
        value = json.loads(raw)
    except (ValueError, TypeError):
        raise DiagnosticError('MANIFEST_INVALID_JSON') from None
    entries = value if isinstance(value, list) else [value]
    need(0 < len(entries) <= 32, 'MANIFEST_SHAPE')
    descriptors = []

    def descriptor(row):
        need(type(row) is dict and DIGEST.fullmatch(str(row.get('digest', ''))) is not None, 'MANIFEST_DESCRIPTOR')
        size = row.get('size')
        need(type(size) is int and 0 <= size <= 2**40, 'MANIFEST_DESCRIPTOR')
        kind = MEDIA.get(row.get('mediaType'))
        need(kind is not None, 'MANIFEST_MEDIA_TYPE')
        descriptors.append({'kind': kind, 'digest': row['digest'], 'size': size})
        need(len(descriptors) <= MAX_DESCRIPTORS, 'MANIFEST_DESCRIPTOR_LIMIT')

    for entry in entries:
        need(type(entry) is dict and 'Descriptor' in entry, 'MANIFEST_SHAPE')
        descriptor(entry['Descriptor'])
        bodies = [entry[key] for key in ('SchemaV2Manifest', 'OCIManifest', 'SchemaV2List', 'OCIIndex') if key in entry]
        need(len(bodies) == 1 and type(bodies[0]) is dict, 'MANIFEST_SHAPE')
        body = bodies[0]
        need(body.get('schemaVersion') == 2, 'MANIFEST_SHAPE')
        if 'layers' in body:
            need(type(body['layers']) is list and len(body['layers']) <= MAX_DESCRIPTORS, 'MANIFEST_SHAPE')
            descriptor(body.get('config'))
            for layer in body['layers']:
                descriptor(layer)
        else:
            need(type(body.get('manifests')) is list and 0 < len(body['manifests']) <= 32, 'MANIFEST_SHAPE')
            for item in body['manifests']:
                descriptor(item)
    return descriptors


def inspect_manifest(reference):
    try:
        status, raw = bounded_command(['manifest', 'inspect', '--verbose', reference], 30)
        if status:
            # A missing substring in a mixed transport/auth failure is not
            # evidence of absence and must never admit the write probe.
            if re.search(r'(?i)unauthori[sz]ed|denied|forbidden|TLS|x509|certificate|timeout|timed out|connection|unexpected EOF|proxy|no such host|network|dial tcp', raw):
                return {'status': 'error', 'errorCode': 'MANIFEST_INSPECT_FAILED'}
            if re.search(r'(?i)manifest unknown|no such manifest|MANIFEST_UNKNOWN', raw):
                return {'status': 'missing', 'descriptors': []}
            return {'status': 'error', 'errorCode': 'MANIFEST_INSPECT_FAILED'}
        return {'status': 'present', 'descriptors': manifest_metadata(raw)}
    except DiagnosticError as error:
        if str(error) == 'DIAGNOSTIC_DEADLINE':
            raise
        return {'status': 'error', 'errorCode': str(error)}


def progress_reader(stage, report):
    states = {}
    stats = {'layerCount': 0, 'completedCount': 0, 'elapsed': 0.0}
    report[stage] = stats

    def read(line, elapsed):
        match = PROGRESS.match(line.strip())
        if match is None:
            return
        layer, state = match.groups()
        need(layer in states or len(states) < MAX_DESCRIPTORS, 'PROGRESS_LAYER_LIMIT')
        states[layer] = state
        stats.update(layerCount=len(states), completedCount=sum(s in ('Pushed', 'Layer already exists', 'Pull complete', 'Already exists') for s in states.values()), elapsed=elapsed)
        emit({'stage': stage, 'layerId': layer, 'status': state, 'elapsed': elapsed})
    return read


def require_success(args, timeout, code, progress=None):
    try:
        status, raw = bounded_command(args, timeout, progress)
    except DiagnosticError as error:
        if str(error) == 'COMMAND_TIMEOUT':
            raise DiagnosticError(code + '_TIMEOUT') from None
        raise
    need(status == 0, code + '_FAILED')
    return raw


def image_id(reference):
    value = require_success(['image', 'inspect', '--format', '{{.Id}}', reference], 30, 'IMAGE_INSPECT').strip()
    need(IMAGE_ID.fullmatch(value) is not None, 'IMAGE_ID_INVALID')
    return value


def require_local_absent(reference):
    status, raw = bounded_command(['image', 'inspect', '--format', '{{.Id}}', reference], 30)
    need(status != 0 and re.search(r'(?i)no such image|no such object', raw) is not None, 'LOCAL_IMAGE_NOT_REMOVED')


def remove_if_local(reference, expected_id):
    """Only remove this probe's exact local image, never a different tag owner."""
    status, raw = bounded_command(['image', 'inspect', '--format', '{{.Id}}', reference], 30)
    if status:
        need(re.search(r'(?i)no such image|no such object', raw) is not None, 'LOCAL_IMAGE_INSPECT_FAILED')
        return
    need(raw.strip() == expected_id, 'LOCAL_IMAGE_ID_MISMATCH')
    require_success(['image', 'rm', '--force', reference], 30, 'LOCAL_REMOVE')
    require_local_absent(reference)


def buildkit_upload(root, reference, report):
    # No load/export into the daemon is requested. Refuse an existing local tag
    # before building, and only remove an exact matching image if a driver did load it.
    require_local_absent(reference)
    with tempfile.TemporaryDirectory(prefix='registry-buildkit-metadata-') as directory:
        metadata = Path(directory) / 'result.json'
        fd = os.open(metadata, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        os.close(fd)
        started = time.monotonic()
        report['buildkitPush'] = {'status': 'unknown', 'elapsed': 0.0}
        emit({'stage': 'buildkit-push', 'status': 'started', 'elapsed': 0.0})
        try:
            require_success(['buildx', 'build', '--platform', 'linux/amd64', '--network=none',
                             '--provenance=false', '--progress=plain', '--metadata-file', str(metadata),
                             '--output=type=registry,oci-mediatypes=false', '--tag', reference, str(root)], 180, 'BUILDKIT_PUSH')
            report['buildkitPush']['status'] = 'completed'
        finally:
            report['buildkitPush']['elapsed'] = round(time.monotonic() - started, 3)
        emit({'stage': 'buildkit-push', **report['buildkitPush']})
        need(not metadata.is_symlink() and metadata.is_file() and 0 < metadata.stat().st_size <= MAX_OUTPUT,
             'BUILDKIT_METADATA_FILE_INVALID')
        try:
            value = json.loads(metadata.read_bytes())
        except (ValueError, OSError):
            raise DiagnosticError('BUILDKIT_METADATA_INVALID') from None
        need(type(value) is dict, 'BUILDKIT_METADATA_INVALID')
        before, manifest = value.get('containerimage.config.digest'), value.get('containerimage.digest')
        need(type(before) is str and IMAGE_ID.fullmatch(before) is not None
             and type(manifest) is str and DIGEST.fullmatch(manifest) is not None, 'BUILDKIT_METADATA_INVALID')
        # No other metadata field, raw BuildKit output or provenance is copied.
        report.update(imageIdBefore=before, expectedManifestDigest=manifest)
        remote = inspect_manifest(reference)
        report['probeManifest'] = remote
        need(remote['status'] == 'present', 'PROBE_MANIFEST_READBACK_FAILED')
        manifests = [row for row in remote['descriptors'] if row['kind'] in ('manifest', 'index')]
        configs = [row for row in remote['descriptors'] if row['kind'] == 'config']
        need(len(manifests) == 1 and manifests[0]['kind'] == 'manifest'
             and manifests[0]['digest'] == manifest, 'PROBE_MANIFEST_DIGEST_MISMATCH')
        need(len(configs) == 1 and configs[0]['digest'] == before, 'PROBE_CONFIG_DIGEST_MISMATCH')
        remove_if_local(reference, before)
        remove_if_local(before, before)
        require_local_absent(reference)
        require_local_absent(before)
        report['localTagAndIdAbsentBeforePull'] = True
        pull_reference = reference.rsplit(':', 1)[0] + '@' + manifest
        require_success(['pull', pull_reference], 180, 'PULL', progress_reader('pull', report))
        after = image_id(pull_reference)
        report['imageIdAfter'] = after
        need(after == before, 'PULLED_IMAGE_ID_MISMATCH')


def diagnose(tag, payload_mib, output, transport='docker'):
    report = {'kind': 'registry-upload-diagnostic-v1', 'status': 'failed', 'metadata': {},
              'payloadBytes': 0, 'localTagAndIdAbsentBeforePull': False,
              'pullMayReuseLayerCache': True}
    result = 1
    destination = Path(output)
    # Never overwrite an existing receipt, including a symlink target.
    if not destination.is_absolute() or destination.exists() or destination.is_symlink() or not destination.parent.is_dir():
        emit({'errorCode': 'OUTPUT_PATH_INVALID'})
        return 1
    deadline_token = _DEADLINE.set(time.monotonic() + DIAGNOSTIC_SECONDS)
    try:
        need(transport in ('docker', 'buildkit'), 'TRANSPORT_NOT_ALLOWED')
        report['transport'] = transport
        need(type(payload_mib) is int and payload_mib == 32, 'PAYLOAD_SIZE_NOT_ALLOWED')
        need(os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_ENVIRONMENT') == 'github-hosted'
             and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch', 'MANAGED_HOSTED_JOB_REQUIRED')
        need(not any(os.environ.get(name) for name in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')),
             'DOCKER_ENDPOINT_OVERRIDE_FORBIDDEN')
        revision = os.environ.get('GITHUB_SHA', '')
        need(re.fullmatch(r'[a-f0-9]{40}', revision) is not None, 'DIAGNOSTIC_REVISION_INVALID')
        report['diagnosticCodeRevision'] = revision
        prefix = os.environ.get('REGISTRY_PREFIX', '')
        try:
            registry.coordinates(prefix, tag)
        except (ValueError, TypeError):
            raise DiagnosticError('REGISTRY_COORDINATES_INVALID') from None
        need(len(tag) <= 128 and '-vpc.' not in prefix.split('/')[0], 'REGISTRY_COORDINATES_INVALID')
        config = os.environ.get('DOCKER_CONFIG', '')
        need(config and Path(config).is_absolute() and not any(c in config for c in '\r\n\x00'), 'MANAGED_DOCKER_CONFIG_REQUIRED')
        run, attempt = os.environ.get('GITHUB_RUN_ID', ''), os.environ.get('GITHUB_RUN_ATTEMPT', '')
        need(re.fullmatch(r'[1-9][0-9]{0,19}', run) is not None and re.fullmatch(r'[1-9][0-9]{0,19}', attempt) is not None, 'RUN_IDENTITY_INVALID')
        probe_tag = 'acr-probe-' + run + '-' + attempt + '-sized'
        if transport == 'buildkit':
            probe_tag += '-buildkit'
        reference = prefix + '/api:' + probe_tag
        report.update(existingTag=tag, probeTag=probe_tag)
        version = require_success(['version', '--format', '{{.Server.Version}}'], 15, 'DOCKER_VERSION').strip()
        need(re.fullmatch(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9._-]+)?', version) is not None and len(version) <= 80, 'SERVER_VERSION_INVALID')
        report['dockerServerVersion'] = version
        for role, (repository, *_rest) in registry.SERVICES.items():
            report['metadata'][role] = inspect_manifest(prefix + '/' + repository + ':' + tag)
        need(all(row['status'] in ('present', 'missing') for row in report['metadata'].values()), 'METADATA_INCOMPLETE')
        probe = inspect_manifest(reference)
        need(probe['status'] == 'missing', 'PROBE_TAG_NOT_CONFIRMED_ABSENT')
        with tempfile.TemporaryDirectory(prefix='registry-sized-probe-') as directory:
            root = Path(directory)
            with (root / 'payload').open('xb') as stream:
                for _ in range(32):
                    chunk = os.urandom(1024 * 1024)
                    stream.write(chunk)
            report['payloadBytes'] = (root / 'payload').stat().st_size
            need(report['payloadBytes'] == 32 * 1024 * 1024, 'PAYLOAD_GENERATION_FAILED')
            (root / 'Dockerfile').write_text('FROM scratch\nCOPY payload /payload\n')
            if transport == 'buildkit':
                buildkit_upload(root, reference, report)
            else:
                require_success(['build', '--network=none', '--tag', reference, str(root)], 60, 'BUILD')
                before = image_id(reference)
                report['imageIdBefore'] = before
                require_success(['push', reference], 180, 'PUSH', progress_reader('push', report))
                require_success(['image', 'rm', '--force', reference], 30, 'LOCAL_REMOVE')
                require_local_absent(reference)
                require_local_absent(before)
                report['localTagAndIdAbsentBeforePull'] = True
                require_success(['pull', reference], 180, 'PULL', progress_reader('pull', report))
                after = image_id(reference)
                report['imageIdAfter'] = after
                need(after == before, 'PULLED_IMAGE_ID_MISMATCH')
        report['status'] = 'succeeded'
        result = 0
    except DiagnosticError as error:
        report['errorCode'] = str(error)
    except KeyboardInterrupt:
        report['errorCode'] = 'CANCELLED'
    except Exception:
        report['errorCode'] = 'DIAGNOSTIC_FAILED'
    finally:
        _DEADLINE.reset(deadline_token)
    try:
        # x mode is also the final race-safe refusal against receipt overwrite.
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            json.dump(report, stream, sort_keys=True, indent=2)
            stream.write('\n')
    except OSError:
        emit({'errorCode': 'OUTPUT_WRITE_FAILED'})
        return 1
    emit({'status': report['status'], **({'errorCode': report['errorCode']} if 'errorCode' in report else {})})
    return result


class SafeParser(argparse.ArgumentParser):
    def error(self, _message):
        raise DiagnosticError('ARGUMENTS_INVALID')


def main(argv=None):
    parser = SafeParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--payload-mib', required=True, type=int)
    parser.add_argument('--output', required=True)
    parser.add_argument('--transport', choices=('docker', 'buildkit'), default='docker')
    try:
        args = parser.parse_args(argv)
    except DiagnosticError:
        emit({'errorCode': 'ARGUMENTS_INVALID'})
        return 2
    return diagnose(args.tag, args.payload_mib, args.output, args.transport)


if __name__ == '__main__':
    raise SystemExit(main())
