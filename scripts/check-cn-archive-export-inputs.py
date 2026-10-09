#!/usr/bin/env python3
"""Offline input review only: never fetch, dispatch, build or publish."""
import argparse
import json
from pathlib import Path
import subprocess
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
import cn_image_archive as c


def git(repository, args):
    p = subprocess.run(['git', '-C', str(repository), *args], capture_output=True,
                       timeout=10, env={'PATH': '/usr/bin:/bin', 'LANG': 'C',
                       'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
                       'GIT_NO_REPLACE_OBJECTS': '1', 'GIT_NO_LAZY_FETCH': '1'})
    c.require(len(p.stdout) <= 262144 and len(p.stderr) <= 262144, 'GIT_OUTPUT_LIMIT')
    return p.returncode, p.stdout


def check(raw, expected_hash, repository, command=git):
    c.require(len(raw) <= 16384 and c.hex_string(expected_hash, 64)
              and c.sha(raw) == expected_hash, 'PLAN_RAW_HASH_MISMATCH')
    plan = c.validate_plan(c.decode(raw))
    code, head = command(repository, ['rev-parse', 'HEAD'])
    c.require(code == 0 and c.hex_string(head.decode().strip(), 40), 'LOCAL_HEAD_UNAVAILABLE')
    code, main = command(repository, ['rev-parse', 'refs/remotes/origin/main'])
    c.require(code == 0 and c.hex_string(main.decode().strip(), 40), 'LOCAL_MAIN_UNAVAILABLE')
    head = head.decode().strip(); main = main.decode().strip(); blockers = []
    if head != plan['controlRevision']: blockers.append('CONTROL_HEAD_MISMATCH')
    for field in ('sourceRevision', 'controlRevision'):
        code, _ = command(repository, ['merge-base', '--is-ancestor', plan[field], main])
        if code != 0: blockers.append(field.upper() + '_NOT_LOCAL_MAIN_ANCESTOR')
    # Manual dispatch freezes current main control, not an arbitrary older ancestor.
    if plan['controlRevision'] != main: blockers.append('CONTROL_NOT_LOCAL_MAIN_TIP')
    workflow = '.github/workflows/export-cn-image-archives.yml'
    code, _ = command(repository, ['cat-file', '-e', main + ':' + workflow])
    if code != 0: blockers.append('FORMAL_WORKFLOW_NOT_IN_LOCAL_MAIN')
    return dict(kind='offline-cn-archive-export-input-review', sourceRevision=plan['sourceRevision'],
                controlRevision=plan['controlRevision'], localHead=head, localMain=main,
                localMainFreshness='not-refreshed-or-attested-by-this-command',
                rawPlanSha256=expected_hash, canonicalPlanSha256=c.sha(c.json_bytes(plan)),
                services=list(c.REPOSITORIES), runner='ubuntu-24.04',
                standardPublicRunnerCompute='previously-verified-free; account/storage-not-verified-here',
                serviceAdmissionBytes=4*plan['maxArchiveBytes']+plan['storageMarginBytes'],
                collectionAdmissionBytes=plan['maxTotalBytes']+plan['storageMarginBytes'],
                wholeSetMaxBytes=plan['maxTotalBytes'], fragmentTtlSeconds=3600,
                codeBlockers=blockers,
                externalInputsRequired=['fresh-main-observation-and-safe-registration',
                    'actual-runner-space-and-inodes', 'artifact-storage-and-download-allowance',
                    'same-run-attempt-five-fragments-before-original-expiry',
                    'approved-OSS-coordinates-principals-versioning-fence-and-existing-SDK-caller',
                    'trusted-installed-importer-and-canonical-closure-and-short-lived-publish-approval'],
                collectorOutput='fresh-flat-bundle; move-not-copy; no-measurement-artifact-substitution',
                ossEntry='cn_archive_oss.Transfer.upload/download SDK; no CLI',
                importerEntry='python3 -I -S -B INSTALLED_ENTRY --check-plan|--publish SHA ATTEMPT APPROVAL_RAW_SHA256',
                ready=False, buildStarted=False, productionActivated=False)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--plan', required=True); p.add_argument('--plan-sha256', required=True)
    p.add_argument('--repository', default=str(Path(__file__).resolve().parent.parent)); args = p.parse_args()
    path = Path(args.plan)
    c.require(path.is_file() and not path.is_symlink() and path.stat().st_size <= 16384, 'PLAN_FILE_REJECTED')
    result = check(path.read_bytes(), args.plan_sha256, args.repository)
    print(json.dumps(result, sort_keys=True))
    return 1 if result['codeBlockers'] else 0


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception:
        print('CN_ARCHIVE_OFFLINE_INPUT_REJECTED', file=sys.stderr); sys.exit(2)
