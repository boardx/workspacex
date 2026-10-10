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


def image_matches(image, entry, plan):
    a.require(type(image) is dict and image.get('Id') == entry['imageId'], 'PUBLICATION_IMAGE_ID')
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

    owned = []
    try:
        fresh()
        # All local collisions and running-target checks precede authentication.
        for service, entry in receipt['images'].items():
            for tag in (entry['stagingTag'], target(service)):
                existing = adapter.local(tag)
                if existing is not None:
                    image_matches(existing, entry, plan)
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
                    owned.append((entry['stagingTag'], entry['imageId']))
                    fresh()
                    adapter.load(bundle / entry['file'])
                image_matches(adapter.local(entry['stagingTag']), entry, plan)
                fresh()
                adapter.tag(entry['stagingTag'], target(service))
                fresh()
                pushed = adapter.push(target(service))
                # Lost acknowledgement permits readback, never a second push.
                fresh()
                remote = adapter.pull_optional(target(service))
                a.require(remote is not None,
                          'PUBLICATION_PUSH_UNCONFIRMED' if not pushed else 'PUBLICATION_READBACK_MISSING')
            image_matches(remote, entry, plan)
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
