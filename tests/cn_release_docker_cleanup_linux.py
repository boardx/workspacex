#!/usr/bin/env python3
"""GitHub-only real Docker cleanup after owned fixture creator SIGKILL.

Uses an existing immutable image; never pulls, prunes, or enumerates unrelated
containers. The 60 second alarm is a hard test deadline: timeout is unverified,
not a cleanup-success claim. Successful runs remove all three owned registries.
"""
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import select
import shutil
import signal
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]


def need(value, code):
    if not value:
        raise RuntimeError(code)


def main():
    started = time.monotonic()
    if (sys.platform != 'linux' or os.geteuid() != 0 or
            os.environ.get('GITHUB_ACTIONS') != 'true'):
        print(json.dumps({'verified': False, 'reason': 'GITHUB_LINUX_ROOT_REQUIRED'}))
        return 2
    image = os.environ.get('CN_API_STARTUP_PG_IMAGE', '')
    run_id = os.environ.get('GITHUB_RUN_ID', '')
    need(re.fullmatch('sha256:[a-f0-9]{64}', image), 'IMMUTABLE_IMAGE_REQUIRED')
    need(re.fullmatch('[1-9][0-9]*', run_id), 'GITHUB_RUN_ID_REQUIRED')
    spec = importlib.util.spec_from_file_location('fixture_cleanup', ROOT / 'scripts/cn-release-fixture-docker-cleanup.py')
    module = importlib.util.module_from_spec(spec)
    old_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = old_bytecode
    docker = shutil.which('docker')
    need(docker, 'DOCKER_REQUIRED')
    observed = module.command([docker, 'image', 'inspect', '--format', '{{.Id}} {{.Os}} {{.Architecture}}', image])
    need(observed == image + ' linux amd64', 'EXISTING_IMAGE_IDENTITY')
    temporary = Path(tempfile.mkdtemp(prefix='wsx-docker-cleanup-test-'))
    owners = []
    closed = set()
    child = None
    pipes = []
    proofs = []
    failure = None
    def timeout(_signum, _frame):
        raise RuntimeError('TEST_DEADLINE_UNVERIFIED')
    previous_handler = signal.signal(signal.SIGALRM, timeout)
    deadline = started + 60
    original_command = module.command
    def bounded_command(argv):
        remaining = deadline - time.monotonic()
        need(remaining > 0, 'TEST_DEADLINE_UNVERIFIED')
        signal.setitimer(signal.ITIMER_REAL, remaining)
        return original_command(argv)
    module.command = bounded_command
    signal.setitimer(signal.ITIMER_REAL, max(.001, deadline - time.monotonic()))

    def owner(label):
        folder = temporary / label
        folder.mkdir(mode=0o700)
        value = module.Owner(folder, run_id, 'round-00')
        owners.append(value)
        return value

    def intent(value):
        record = {'token': value.token, 'containerName': 'wsx-cn-api-' + secrets.token_hex(8), 'imageId': image}
        module.durable(value.directory, 'api-create-intent.json', record)
        return record

    def create(value):
        record = intent(value)
        cid = module.command([docker, 'run', '--pull=never', '--detach', '--network=none',
                              '--memory=64m', '--cpus=.25', '--pids-limit=16', '--cap-drop=ALL',
                              '--security-opt=no-new-privileges', '--read-only',
                              '--name', record['containerName'], '--label', 'cn-startup-fixture=' + value.token,
                              '--entrypoint=/bin/sh', image, '-c', 'exec sleep 120'])
        need(re.fullmatch('[a-f0-9]{64}', cid), 'CREATE_ID_REQUIRED')
        actual = module.command([docker, 'inspect', '--format',
            '{{.Id}} {{index .Config.Labels "cn-startup-fixture"}} {{.Image}} {{.Name}} {{.State.Running}}', cid])
        need(actual == ' '.join([cid, value.token, image, '/' + record['containerName'], 'true']), 'CREATE_INSPECT_IDENTITY')
        module.durable(value.directory, 'api-create-receipt.json', dict(record, containerId=cid))
        return cid

    def close(value):
        # Mark before invoking: a response-unknown close is never automatically replayed.
        closed.add(value.token)
        result = value.close()
        proofs.append(result)
        return result

    try:
        control = owner('control')
        control_id = create(control)
        target = owner('target')
        read_fd, write_fd = os.pipe()
        pipes.extend([read_fd, write_fd])
        child = os.fork()
        if child == 0:
            os.close(read_fd)
            try:
                create(target)
                os.write(write_fd, b'R')
                while True:
                    signal.pause()
            except BaseException:
                os._exit(3)
        os.close(write_fd)
        pipes.remove(write_fd)
        need(select.select([read_fd], [], [], 20)[0], 'CREATOR_READY_TIMEOUT')
        need(os.read(read_fd, 1) == b'R', 'CREATOR_FAILED')
        os.kill(child, signal.SIGKILL)
        waited, status = os.waitpid(child, 0)
        child = None
        need(os.WIFSIGNALED(status) and os.WTERMSIG(status) == signal.SIGKILL, 'CREATOR_NOT_SIGKILLED')
        receipt = target.read('api-create-receipt.json')
        need(receipt is not None, 'DURABLE_RECEIPT_REQUIRED')
        proof = close(target)
        need(proof['verified'] is True and proof['removedContainerIds'] == [receipt['containerId']]
             and proof['daemonReadbackEmpty'] is True, 'TARGET_CLEANUP_UNPROVEN')
        need(module.command([docker, 'ps', '--all', '--quiet', '--no-trunc',
                             '--filter', 'id=' + receipt['containerId']]) == '', 'TARGET_ID_STILL_EXISTS')
        # Exact control ID lookup proves cleanup did not delete a different owner.
        need(module.command([docker, 'inspect', '--format', '{{.Id}} {{.State.Running}}', control_id])
             == control_id + ' true', 'UNRELATED_FIXTURE_REMOVED')
        unknown = owner('unknown')
        intent(unknown)  # Simulates a create request with no durable acknowledgement.
        unknown_proof = close(unknown)
        need(unknown_proof['verified'] is False and unknown_proof['unacknowledgedCreate'] is True
             and unknown_proof['daemonReadbackEmpty'] is True, 'UNKNOWN_CREATE_FALSE_GREEN')
        need(close(control)['verified'] is True, 'CONTROL_CLEANUP_UNPROVEN')
    except Exception as exc:
        failure = type(exc).__name__ + ':' + str(exc)
    finally:
        if child is not None:
            try:
                os.kill(child, signal.SIGKILL)
            except ProcessLookupError:
                pass
            os.waitpid(child, 0)
        for fd in pipes:
            os.close(fd)
        for value in owners:
            if value.token not in closed:
                try:
                    result = close(value)
                    if result['verified'] is not True:
                        failure = failure or 'FINAL_CLEANUP_UNVERIFIED'
                except Exception:
                    failure = failure or 'FINAL_CLEANUP_FAILED'
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous_handler)
        # Retain evidence on any failure or unknown resource outcome.
        if failure is None:
            shutil.rmtree(temporary)
    passed = failure is None
    print(json.dumps({'kind': 'cn-docker-sigkill-cleanup-linux-v1', 'verified': passed,
                      'failure': failure, 'durationSeconds': round(time.monotonic() - started, 3),
                      'proofs': proofs, 'creatorSigkillTested': passed,
                      'unrelatedFixturePreserved': passed, 'unknownCreateRejected': passed,
                      'evidenceDirectory': None if passed else str(temporary),
                      'productionAccepted': False}, sort_keys=True))
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
