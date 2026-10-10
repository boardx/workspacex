"""Candidate-v2 publication sequence for a separately admitted trusted host adapter.

This module provides no CLI, credentials, host admission or transport fallback.
The host must admit its root-owned plan, pinned archive snapshots, tool closure,
immutable repositories and canonical sealer before invoking this sequence.
Legacy archive-v1 validation is deliberately unchanged.
"""
from datetime import datetime, timezone
import re
import sys

import cn_image_archive as a
import cn_image_candidate as c


def validate_intent(raw, expected_sha, plan, candidate_raw, candidate_sha, plan_sha, *, revalidation=None):
    a.require(len(raw) <= 16384 and a.sha(raw) == expected_sha, 'PUBLICATION_INTENT_HASH')
    value = a.decode(raw)
    fields = {'kind', 'schemaVersion', 'candidatePlanRawSha256', 'candidateSetRawSha256',
              'candidateIdentity', 'sourceRevision', 'controlRevision', 'attemptId',
              'release', 'redisImage', 'registryPrefix'}
    if revalidation is not None:
        fields.add('revalidationRawSha256')
        a.require(value.get('revalidationRawSha256') == revalidation.sha, 'PUBLICATION_REVALIDATION_BINDING')
    a.require(type(value) is dict and set(value) == fields, 'PUBLICATION_INTENT_FIELDS')
    a.require(value['kind'] == 'cn-candidate-publication-intent-v2'
              and type(value['schemaVersion']) is int and value['schemaVersion'] == 2,
              'PUBLICATION_INTENT_SCHEMA')
    c.validate_plan(plan)
    a.require(a.hex_string(plan_sha, 64) and a.hex_string(candidate_sha, 64)
              and a.sha(candidate_raw) == candidate_sha, 'PUBLICATION_INPUT_HASH')
    a.require(value['candidatePlanRawSha256'] == plan_sha
              and value['candidateSetRawSha256'] == candidate_sha
              and value['candidateIdentity'] == c.identity(plan), 'PUBLICATION_INTENT_BINDING')
    for key in ('sourceRevision', 'controlRevision', 'attemptId'):
        a.require(value[key] == plan[key], 'PUBLICATION_INTENT_IDENTITY')
    a.require(value['registryPrefix'] == a.PREFIX, 'PUBLICATION_REGISTRY')
    a.require(isinstance(value['release'], str)
              and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?', value['release']),
              'PUBLICATION_RELEASE')
    a.require(isinstance(value['redisImage'], str)
              and re.fullmatch(re.escape(a.PREFIX + '/base-redis') + '@sha256:[a-f0-9]{64}', value['redisImage']),
              'PUBLICATION_REDIS_REFERENCE')
    receipt = (c.validate_receipt(candidate_raw, plan, candidate_sha) if revalidation is None else
               revalidation.check(plan, candidate_raw, candidate_sha, plan_sha))
    a.require(receipt['planRawSha256'] == plan_sha, 'PUBLICATION_PLAN_RAW_BINDING')
    a.require(set(receipt['images']) == set(a.REPOSITORIES), 'PUBLICATION_COMPLETE_FIVE')
    return value


def image_matches(image, entry, plan, *, store_archive=None):
    a.require(type(image) is dict, 'PUBLICATION_IMAGE_ID')
    if image.get('Id') != entry['imageId']:
        a.require(store_archive is not None, 'PUBLICATION_IMAGE_ID')
        verify_store_archive(store_archive, image, entry, plan)
    a.require(image.get('Os') == 'linux' and image.get('Architecture') == 'amd64',
              'PUBLICATION_IMAGE_PLATFORM')
    labels = image.get('Config', {}).get('Labels') or {}
    a.require(type(labels) is dict
              and labels.get('org.opencontainers.image.revision') == plan['sourceRevision']
              and labels.get(c.LABEL) == c.identity(plan)
              and 'org.workspacex.archive-build-identity' not in labels, 'PUBLICATION_IMAGE_LABELS')


def publish(plan_raw, plan_sha, candidate_raw, candidate_sha,
            intent_raw, intent_sha, bundle, adapter, *, revalidation=None):
    """Validate original bytes, authenticate Redis first, then publish five images.

    adapter is an internal trusted capability, never a serialized caller input.
    Tests supply an isolated fake; a production caller must supply the admitted
    host implementation. A caller-supplied boolean is never Redis authentication.
    """
    a.require(len(plan_raw) <= 16384 and a.sha(plan_raw) == plan_sha, 'PUBLICATION_PLAN_HASH')
    plan = c.validate_plan(a.decode(plan_raw))
    intent = validate_intent(intent_raw, intent_sha, plan, candidate_raw, candidate_sha, plan_sha, revalidation=revalidation)
    receipt = (c.verify_bundle(bundle, plan, candidate_raw, candidate_sha, plan_sha) if revalidation is None else
               revalidation.verify_bundle(bundle, plan, candidate_raw, candidate_sha, plan_sha))

    def fresh():
        # Recheck the original receipt before every side effect and final seal.
        if revalidation is None:
            c.validate_receipt(candidate_raw, plan, candidate_sha)
        else:
            revalidation.check(plan, candidate_raw, candidate_sha, plan_sha)
        adapter.check_validity()

    def target(service):
        return a.PREFIX + '/' + a.REPOSITORIES[service] + ':' + plan['sourceRevision']

    def matches(image, entry):
        if type(image) is dict and image.get('Id') != entry['imageId']:
            a.require(callable(getattr(adapter, 'candidate_image_matches', None)), 'PUBLICATION_IMAGE_ID')
            adapter.candidate_image_matches(image, entry, plan)
        else:
            image_matches(image, entry, plan)

    owned = []
    try:
        fresh()
        # All local collisions and running-target checks precede authentication.
        for service, entry in receipt['images'].items():
            for tag in (entry['stagingTag'], target(service)):
                existing = adapter.local(tag)
                if existing is not None:
                    matches(existing, entry)
        adapter.protect_running_targets(receipt, plan)
        fresh()
        adapter.authenticate()
        for service, entry in receipt['images'].items():
            fresh()
            remote_id = adapter.remote_config_id(target(service))
            a.require(remote_id is None or remote_id == entry['imageId'], 'PUBLICATION_REMOTE_COLLISION')

        # A real authenticated registry pull and immutable remote digest readback
        # must complete before the first candidate load/tag/push.
        fresh()
        redis = intent['redisImage']
        adapter.pull_required(redis)
        fresh()
        redis_reference = adapter.registry_digest(redis, adapter.local(redis))
        a.require(redis_reference == redis, 'PUBLICATION_REDIS_DIGEST')
        redis_observed_at = datetime.now(timezone.utc).isoformat()
        results = {'redis': redis_reference}

        for service, entry in receipt['images'].items():
            fresh()
            remote = adapter.pull_optional(target(service))
            if remote is None:
                if adapter.local(entry['stagingTag']) is None:
                    fresh()
                    adapter.load(bundle / entry['file'])
                    loaded = adapter.local(entry['stagingTag'])
                    matches(loaded, entry)
                    owned.append((entry['stagingTag'], loaded['Id']))
                matches(adapter.local(entry['stagingTag']), entry)
                fresh()
                adapter.tag(entry['stagingTag'], target(service))
                fresh()
                pushed = adapter.push(target(service))
                # Lost acknowledgement permits readback, never a second push.
                fresh()
                remote = adapter.pull_optional(target(service))
                a.require(remote is not None,
                          'PUBLICATION_PUSH_UNCONFIRMED' if not pushed else 'PUBLICATION_READBACK_MISSING')
            matches(remote, entry)
            fresh()
            reference = adapter.registry_digest(target(service), remote)
            a.require(isinstance(reference, str)
                      and re.fullmatch(re.escape(a.PREFIX + '/' + a.REPOSITORIES[service])
                                       + '@sha256:[a-f0-9]{64}', reference), 'PUBLICATION_REGISTRY_READBACK')
            results[service] = reference

        fresh()
        manifest_input = {'schemaVersion': 1, 'release': intent['release'],
                          'sourceRevision': plan['sourceRevision'], 'platform': plan['platform'],
                          'images': {key: {'image': results[key]}
                                     for key in ('web', 'api', 'agent', 'sandbox', 'postgres', 'redis')}}
        binding = {'kind': 'cn-candidate-publication-binding-v2', 'schemaVersion': 2,
                   'candidatePlanRawSha256': plan_sha, 'candidateSetRawSha256': candidate_sha,
                   'publicationIntentRawSha256': intent_sha, 'candidateIdentity': c.identity(plan),
                   'sourceRevision': plan['sourceRevision'], 'controlRevision': plan['controlRevision'],
                   'attemptId': plan['attemptId'], 'release': intent['release'],
                   'redisImage': redis_reference, 'redisObservedAt': redis_observed_at,
                   'candidateExpiresAt': receipt['expiresAt'],
                   'releaseReady': False, 'productionReady': False}
        # Host adapter must use the original TS manifest generator/validator/sealer
        # and atomically bind this metadata with the real six-digest result.
        if revalidation is not None:
            binding['revalidationRawSha256'] = revalidation.sha
            binding['revalidationExpiresAt'] = revalidation.expires_at
        return adapter.canonical_publish_candidate(manifest_input, binding)
    finally:
        primary = sys.exc_info()[1]
        cleanup_failed = False
        for tag, image_id in reversed(owned):
            try:
                adapter.remove_owned_tag(tag, image_id)
            except Exception:
                cleanup_failed = True
        if cleanup_failed:
            if primary is not None:
                primary.add_note('PUBLICATION_OWNED_TAG_CLEANUP_UNCONFIRMED')
            else:
                raise a.Rejected('PUBLICATION_OWNED_TAG_CLEANUP_UNCONFIRMED') from None


def verify_store_archive(path, image, entry, plan):
    """Docker containerd store Id is a manifest digest. Bind actual exported bytes.

    This accepts only a single linux/amd64 manifest and exact original
    config/layer bytes. It never treats an inspect-supplied config label as proof.
    The trusted host exports by immutable Id and rechecks its tag afterwards.
    """
    import tarfile
    from pathlib import Path
    a.require(type(image) is dict and type(image.get('Descriptor')) is dict,
              'PUBLICATION_STORE_DESCRIPTOR')
    descriptor = image['Descriptor']; digest = descriptor.get('digest')
    media = ('application/vnd.docker.distribution.manifest.v2+json',
             'application/vnd.oci.image.manifest.v1+json')
    a.require(digest == image.get('Id') and isinstance(digest, str)
              and re.fullmatch('sha256:[a-f0-9]{64}', digest)
              and descriptor.get('mediaType') in media, 'PUBLICATION_STORE_DESCRIPTOR')
    a.require(0 < Path(path).stat().st_size <= entry['size'] * 2 + 16 * 1024**2,
              'PUBLICATION_STORE_SIZE')
    with tarfile.open(path, 'r:') as tar:
        ix = a.members(tar)
        def blob(ref, small=True):
            a.require(type(ref) is dict and isinstance(ref.get('digest'), str)
                      and re.fullmatch('sha256:[a-f0-9]{64}', ref['digest'])
                      and type(ref.get('size')) is int and ref['size'] > 0,
                      'PUBLICATION_STORE_BLOB')
            name = 'blobs/sha256/' + ref['digest'][7:]
            a.require(name in ix and ix[name].isfile() and ix[name].size == ref['size'],
                      'PUBLICATION_STORE_BLOB_SIZE')
            raw = a.small_member(tar, ix[name]) if small else None
            actual = a.sha(raw) if small else a.member_digest(tar, ix[name])
            a.require('sha256:' + actual == ref['digest'], 'PUBLICATION_STORE_BLOB_HASH')
            return raw
        a.require('index.json' in ix, 'PUBLICATION_STORE_INDEX')
        index = a.decode(a.small_member(tar, ix['index.json']))
        a.require(type(index) is dict and index.get('schemaVersion') == 2
                  and type(index.get('manifests')) is list and len(index['manifests']) == 1,
                  'PUBLICATION_STORE_SINGLE_IMAGE')
        ref = index['manifests'][0]
        a.require(ref.get('digest') == digest and ref.get('mediaType') == descriptor['mediaType']
                  and ref.get('size') == descriptor.get('size'), 'PUBLICATION_STORE_INDEX_BINDING')
        manifest = a.decode(blob(ref))
        a.require(manifest.get('schemaVersion') == 2 and manifest.get('mediaType') in media,
                  'PUBLICATION_STORE_MANIFEST')
        config_raw = blob(manifest.get('config'))
        a.require(a.sha(config_raw) == entry['configSha256']
                  and 'sha256:' + a.sha(config_raw) == entry['imageId'], 'PUBLICATION_STORE_CONFIG')
        config = a.decode(config_raw)
        a.require(config.get('os') == 'linux' and config.get('architecture') == 'amd64',
                  'PUBLICATION_STORE_PLATFORM')
        labels = config.get('config', {}).get('Labels') or {}
        a.require(labels.get('org.opencontainers.image.revision') == plan['sourceRevision']
                  and labels.get(c.LABEL) == c.identity(plan)
                  and 'org.workspacex.archive-build-identity' not in labels, 'PUBLICATION_STORE_LABELS')
        expected = ['sha256:' + layer['sha256'] for layer in entry['layers']]
        a.require(config.get('rootfs') == {'type': 'layers', 'diff_ids': expected}
                  and image.get('RootFS') == {'Type': 'layers', 'Layers': expected},
                  'PUBLICATION_STORE_ROOTFS')
        layers = manifest.get('layers')
        a.require(type(layers) is list and len(layers) == len(entry['layers']),
                  'PUBLICATION_STORE_LAYERS')
        for layer, original in zip(layers, entry['layers']):
            kind = layer.get('mediaType')
            plain = ('application/vnd.docker.image.rootfs.diff.tar', 'application/vnd.oci.image.layer.v1.tar')
            compressed = ('application/vnd.docker.image.rootfs.diff.tar.gzip', 'application/vnd.oci.image.layer.v1.tar+gzip')
            a.require(kind in plain + compressed, 'PUBLICATION_STORE_LAYER_BINDING')
            blob(layer, small=False)  # Hash the stored compressed bytes as well.
            if kind in plain:
                a.require(layer['digest'] == 'sha256:' + original['sha256']
                          and layer['size'] == original['size'], 'PUBLICATION_STORE_LAYER_BINDING')
            else:
                import gzip
                import hashlib
                total = 0; digest = hashlib.sha256()
                with tar.extractfile(ix['blobs/sha256/' + layer['digest'][7:]]) as source:
                    try:
                        with gzip.GzipFile(fileobj=source, mode='rb') as expanded:
                            while True:
                                chunk = expanded.read(65536)
                                if not chunk: break
                                total += len(chunk)
                                a.require(total <= original['size'], 'PUBLICATION_STORE_LAYER_EXPANSION')
                                digest.update(chunk)
                    except (OSError, EOFError):
                        raise a.Rejected('PUBLICATION_STORE_LAYER_GZIP') from None
                a.require(total == original['size'] and digest.hexdigest() == original['sha256'],
                          'PUBLICATION_STORE_LAYER_BINDING')
    return entry['imageId']
