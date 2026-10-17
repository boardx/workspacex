"""Real local-byte adapter for the fixed request; no network, Docker or authorization.

Transfers five original Docker-save archives into a fresh inbox, reuses canonical
candidate admission, and emits the manifest consumed by minimal-docker-release.py.
This is not an ECS upload or permission to load/deploy the resulting images.
"""
import datetime as dt
import hashlib
import importlib.util
import os
from pathlib import Path
import time

import cn_image_archive as a
import cn_image_candidate as c

spec = importlib.util.spec_from_file_location('fixed_request', Path(__file__).with_name('fixed-cn-release.py'))
fixed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixed)


def stage(bundle, plan_raw, plan_sha, candidate_raw, candidate_sha, inventory, output,
          *, timeout=120):
    """Production-format bytes in/out; retained partial inboxes require reconciliation.

    inventory is a fresh GitHub metadata observation, not an authorization. Hash
    pins must come from reviewed original acquisition, never generated from this
    output. Canonical receipt expiry remains enforced; there is no TTL refresh.
    """
    a.require(len(plan_raw) <= 16384 and len(candidate_raw) <= 256*1024, 'FIXED_INPUT_SIZE')
    a.require(a.sha(plan_raw) == plan_sha and a.sha(candidate_raw) == candidate_sha,
              'FIXED_ORIGINAL_INPUT_HASH')
    plan = c.validate_plan(a.decode(plan_raw))
    a.require(plan['sourceRevision'] == fixed.SOURCE and plan['controlRevision'] == fixed.CONTROL,
              'FIXED_BUNDLE_IDENTITY')
    a.require(inventory.get('kind') == 'github-metadata-only'
              and inventory.get('run') == fixed.RUN and inventory.get('control') == fixed.CONTROL
              and inventory.get('expectedSource') == fixed.SOURCE, 'FIXED_INVENTORY_IDENTITY')
    a.require(type(timeout) is int and 1 <= timeout <= 120, 'FIXED_COPY_TIMEOUT')
    deadline = time.monotonic() + timeout
    def fresh():
        a.require(time.monotonic() < deadline, 'FIXED_COPY_DEADLINE')
        now = dt.datetime.now(dt.timezone.utc)
        observed = a.timestamp(inventory['observedAt'])
        a.require(dt.timedelta(0) <= now - observed <= dt.timedelta(minutes=5), 'FIXED_INVENTORY_STALE')
        c.validate_receipt(candidate_raw, plan, candidate_sha, now)
        a.require(all(a.timestamp(row['expires_at']) > now for row in inventory['artifacts']),
                  'FIXED_ARTIFACT_EXPIRED')
    fresh()
    receipt = c.verify_bundle(bundle, plan, candidate_raw, candidate_sha, plan_sha)
    a.require(set(receipt['images']) == set(fixed.ROLES), 'FIXED_COMPLETE_FIVE')
    source = Path(bundle)
    out = Path(output)
    # Exact flat file paths, immutable output allocation, never overwrite/replay.
    out.mkdir(mode=0o700, parents=False, exist_ok=False)
    def save(name, raw):
        with (out / name).open('xb') as stream:
            os.chmod(stream.name, 0o600)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    save('stage-intent.json', a.json_bytes(dict(source=fixed.SOURCE, control=fixed.CONTROL,
         run=fixed.RUN, planSha256=plan_sha, candidateSha256=candidate_sha,
         startedAt=dt.datetime.now(dt.timezone.utc).isoformat(), automaticRetry=False)))
    try:
        images = {}
        for role in fixed.ROLES:
            fresh()
            row = receipt['images'][role]
            matches = [r for r in inventory['artifacts']
                       if r['name'] == f'cn-image-candidate-{role}-{fixed.RUN}-1']
            a.require(len(matches) == 1 and type(matches[0]['id']) is int and matches[0]['id'] > 0,
                      'FIXED_ARCHIVE_ARTIFACT_ID')
            digest = hashlib.sha256(); copied = 0
            fd = os.open(source / row['file'], os.O_RDONLY | os.O_NOFOLLOW)
            with os.fdopen(fd, 'rb') as src, (out / row['file']).open('xb') as dest:
                os.chmod(dest.name, 0o600)
                while True:
                    fresh()
                    block = src.read(min(1024**2, row['size'] - copied + 1))
                    if not block:
                        break
                    copied += len(block)
                    a.require(copied <= row['size'], 'FIXED_ARCHIVE_SIZE_DRIFT')
                    digest.update(block); dest.write(block)
                dest.flush(); os.fsync(dest.fileno())
            a.require(copied == row['size'] and digest.hexdigest() == row['sha256'],
                      'FIXED_ARCHIVE_COPY_HASH')
            images[role] = dict(imageId=row['imageId'], archiveSha256=row['sha256'],
                                artifactId=str(matches[0]['id']), runId=str(fixed.RUN))
        # Reparse destination tar config, labels, layers and identities independently.
        c.verify_bundle(out, plan, candidate_raw, candidate_sha, plan_sha)
        fresh()
        manifest = dict(kind='single-host-images-v1', sourceRevision=fixed.SOURCE, images=images)
        manifest_raw = a.json_bytes(manifest)
        save('candidate-plan.json', plan_raw)
        save('candidate-set.json', candidate_raw)
        save('manifest.json', manifest_raw)
        result = dict(status='LOCAL_ARCHIVES_STAGED', source=fixed.SOURCE, control=fixed.CONTROL,
                      run=fixed.RUN, manifestSha256=a.sha(manifest_raw),
                      candidateSha256=candidate_sha, planSha256=plan_sha,
                      completedAt=dt.datetime.now(dt.timezone.utc).isoformat(),
                      originalBytesVerified=True, githubOriginalProvenanceVerified=False, productionTransferPerformed=False,
                      productionAccepted=False, automaticRetry=False)
        save('stage-receipt.json', a.json_bytes(result))
        return result
    except BaseException:
        # Do not delete partial evidence or silently retry an incomplete copy.
        save('stage-failure.json', a.json_bytes(dict(status='LOCAL_STAGE_FAILED', automaticRetry=False,
             productionTransferPerformed=False, recovery='Inspect retained partial inbox before a fresh separately named attempt.')))
        raise
