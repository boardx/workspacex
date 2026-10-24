"""Bound fixed-request commands for already approved, installed host capabilities.

Produces reviewable argv only, never invokes SSH, cloud commands, sudo or a shell.
The existing root entry remains the authority for approval, target, TTL, code hashes
and exact immutable inbox. A generated command is NOT authorization or readiness.
"""
import re
import fixed_cn_bundle as b
import cn_image_archive as a


def prepare(plan_raw, plan_sha, operation, approval_sha):
    a.require(a.sha(plan_raw) == plan_sha, 'FIXED_HOST_PLAN_HASH')
    plan = b.c.validate_plan(a.decode(plan_raw))
    a.require(plan['sourceRevision'] == b.fixed.SOURCE and plan['controlRevision'] == b.fixed.CONTROL,
              'FIXED_HOST_IDENTITY')
    a.require(a.hex_string(approval_sha, 64), 'SEPARATE_APPROVAL_SHA_REQUIRED')
    source, attempt = plan['sourceRevision'], plan['attemptId']
    a.require(re.fullmatch('[a-z0-9][a-z0-9-]{0,63}', attempt), 'FIXED_HOST_ATTEMPT')
    root = '/usr/local/lib/workspacex-cn/'
    if operation == 'download-check':
        args = [root+'execute-cn-candidate-download.py', source, attempt, approval_sha]
    elif operation == 'image-download':
        args = [root+'execute-cn-candidate-download.py', source, attempt, approval_sha, '--download']
    elif operation in ('publication-check', 'image-publication'):
        args = [root+'import-cn-image-candidates.py',
                '--publish' if operation == 'image-publication' else '--check-plan',
                source, attempt, approval_sha]
    else:
        raise a.Rejected('HOST_OPERATION_NOT_ADMITTED')
    return dict(target=b.fixed.TARGET, region='cn-shanghai', operation=operation,
                argv=['/usr/bin/python3','-I','-S','-B',*args], planSha256=plan_sha,
                source=source, control=plan['controlRevision'],
                approvalSha256=approval_sha, approvalValidated=False, installedBytesVerified=False,
                executionPerformed=False, ready=False,
                localSideEffectsPossible=True, automaticRetry=False)
