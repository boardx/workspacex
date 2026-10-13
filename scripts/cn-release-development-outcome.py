"""Bounded fixture-only development outcome, never a production authorization.

Only original isolated fixtures call this after their finally cleanup. The runner
independently verifies containment, daemon cleanup, inventory and source identity.
No log content is used to grant continuation; missing outcome always stops.
"""
import json,os,re,stat
from pathlib import Path
KNOWN={'linux-application-recovery-complete','linux-six-business'}
def write(suite,*,business_failure,inner_cleanup,reason):
    target=os.environ.get('CN_SIMULATION_OUTCOME_PATH')
    if target is None:return
    path=Path(target)
    if suite not in KNOWN or path.name!=suite+'.tests.outcome.json' or path.parent.name!=os.environ.get('CN_SIX_ROUND_ID'):raise ValueError('OUTCOME_FIXED_PATH')
    if not path.is_absolute()or path.resolve()!=path:raise ValueError('OUTCOME_CANONICAL_PATH')
    revision=os.environ.get('CN_SIX_SOURCE_COMMIT','');run_id=os.environ.get('GITHUB_RUN_ID','')
    if not re.fullmatch('[a-f0-9]{40}',revision)or not re.fullmatch('[0-9]+',run_id):raise ValueError('OUTCOME_BINDING')
    if type(business_failure)is not bool or type(inner_cleanup)is not bool or reason not in ('known-business-failure','not-continuable'):raise ValueError('OUTCOME_SHAPE')
    value=dict(kind='cn-development-fixture-outcome-v1',suite=suite,caseId=suite.replace('-','_')+'_contract',commit=revision,runId=run_id,roundId=path.parent.name,businessFailure=business_failure,innerCleanupVerified=inner_cleanup,reason=reason,sideEffectScope='isolated-local-fixture-only',productionAccepted=False)
    raw=(json.dumps(value,sort_keys=True)+'\n').encode()
    if len(raw)>16384:raise ValueError('OUTCOME_BOUND')
    parent=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:
        info=os.fstat(parent)
        if not stat.S_ISDIR(info.st_mode)or info.st_uid!=os.geteuid()or info.st_mode&0o022:raise ValueError('OUTCOME_PARENT')
        fd=os.open(path.name,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
        with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.fsync(parent)
    finally:os.close(parent)
