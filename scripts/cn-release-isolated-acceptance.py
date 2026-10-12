"""Evidence-bound isolated acceptance. Never authorizes a production operation."""
import hashlib
import json
from pathlib import Path
import re
import subprocess

REQUIREMENTS = {'T%02d' % i for i in range(1,26)} | {'S%02d' % i for i in range(1,8)}
KNOWN_DEFECTS = {'SIM-%02d'%i for i in range(1,14)} | {'CI-01','CI-02','AUTH-01','UPG-01','MIG-01','PREP-01','API-01'}
KNOWN_INVARIANTS = {'no-false-green','exact-clean-source','local-descendants-contained','production-acceptance-not-forged'}


def git(root,*args):
    return subprocess.run(['git','-c','safe.directory='+str(root),'-C',str(root),*args],
                          capture_output=True,timeout=15)


def ancestor(root,commit,candidate):
    if not all(isinstance(c,str) and re.fullmatch('[a-f0-9]{40}',c) for c in (commit,candidate)):return False
    return git(root,'merge-base','--is-ancestor',commit,candidate).returncode == 0


def tracked_bytes(root,candidate,name,limit=262144):
    if not isinstance(name,str) or not name or Path(name).is_absolute() or '..' in Path(name).parts:return None
    result=git(root,'show',candidate+':'+name)
    if result.returncode or len(result.stdout)>limit:return None
    path=root/name
    if path.is_symlink() or not path.is_file() or path.resolve()!=root.resolve()/name:return None
    if path.stat().st_size>limit:return None
    return result.stdout if path.read_bytes()==result.stdout else None


def review_verified(root,candidate,issue):
    ref=issue.get('review')
    if not isinstance(ref,dict) or not ancestor(root,issue.get('fixCommit'),candidate):return False
    raw=tracked_bytes(root,candidate,ref.get('file'))
    if raw is None or hashlib.sha256(raw).hexdigest()!=ref.get('sha256'):return False
    try:report=json.loads(raw)
    except (ValueError,TypeError):return False
    if report.get('kind')!='cn-release-independent-code-review-v1':return False
    if not issue.get('author') or not report.get('sourceRef') or not report.get('reviewedAt') or not report.get('reviewer') or report['reviewer']==issue.get('author'):return False
    findings=[f for f in report.get('findings',[]) if f.get('issueId')==issue['id']]
    if len(findings)!=1 or findings[0].get('disposition')!='accepted':return False
    if not set(findings[0].get('requiredCounterexampleCaseIds',[])) <= set(issue.get('requiredCaseIds',[])):return False
    files=issue.get('requiredReviewedFiles',[]);pins=findings[0].get('reviewedFiles',{})
    if not files:return False
    for name in files:
        content=tracked_bytes(root,candidate,name,4*1024*1024)
        if content is None or hashlib.sha256(content).hexdigest()!=pins.get(name):return False
    return True


def evaluate(summary,ledger,invariants,root):
    commit=summary.get('commit');run=summary.get('githubRunId');rounds=summary.get('rounds',[])
    round_ids=['%02d'%i for i in range(1,11)]
    identity_valid=isinstance(commit,str) and re.fullmatch('[a-f0-9]{40}',commit) is not None and isinstance(run,str) and re.fullmatch('[1-9][0-9]*',run) is not None
    base_seed=summary.get('baseSeed')
    seeds_valid=type(base_seed)is int and len(rounds)==10 and all(type(r.get('seed'))is int and r['seed']==base_seed+i for i,r in enumerate(rounds))
    ten=(identity_valid and seeds_valid and summary.get('requestedRounds')==summary.get('completedRounds')==10 and
         summary.get('status')=='passed' and [r.get('roundId')for r in rounds]==round_ids and
         all(r.get('commit')==commit and r.get('status')=='passed' and r.get('sourceUnchanged') is True and
             r.get('sourceStateBefore',{}).get('dirty') is False and r.get('sourceStateAfter',{}).get('dirty') is False for r in rounds))
    results=summary.get('caseResults',[])
    def replay(ids):
        if not ids or len(ids)!=len(set(ids)):return False
        for rid in round_ids:
            for identifier in ids:
                rows=[r for r in results if r.get('caseId')==identifier and r.get('roundId')==rid]
                if len(rows)!=1:return False
                row=rows[0]
                if row.get('commit')!=commit or row.get('runId')!=run or row.get('status')!='pass' or not row.get('evidence') or not row.get('observedAt'):return False
        return True
    keys=[(r.get('commit'),r.get('runId'),r.get('roundId'),r.get('caseId'))for r in results]
    valid_keys=all(all(isinstance(value,str)and value for value in key)for key in keys)
    unique_cases=valid_keys and len(set(keys))==len(keys)
    no_bad=identity_valid and bool(results) and unique_cases and all(r.get('status')=='pass' and r.get('commit')==commit and r.get('runId')==run and r.get('roundId')in round_ids and r.get('evidence') and r.get('observedAt') for r in results)
    coverage=summary.get('matrixCoverage',[])
    full=(len(coverage)==10 and [c.get('roundId')for c in coverage]==round_ids and all(
        c.get('commit')==commit and c.get('runId')==run and c.get('complete') is True and
        c.get('requirementDenominator')==32 and c.get('requirementNumerator')==32 and
        len(c.get('requirements',[]))==32 and {r.get('id')for r in c['requirements']}==REQUIREMENTS and
        all(r.get('covered') is True and r.get('implementation')=='implemented' and not r.get('notImplemented') for r in c['requirements']) and
        c.get('caseDenominator')==len(c.get('cases',[])) and replay([r.get('caseId')for r in c.get('cases',[])])
        for c in coverage))
    defects=[]
    for issue in ledger.get('issues',[]):
        reviewed=review_verified(root,commit,issue)
        replayed=replay(issue.get('requiredCaseIds',[]))
        closed=issue.get('disposition')=='fixed-awaiting-replay' and reviewed and replayed and not issue.get('remainingGap')
        defects.append(dict(id=issue['id'],severity=issue['severity'],reviewVerified=reviewed,tenRoundReplayPassed=replayed,verifiedClosed=closed))
    serious=(ledger.get('kind')=='cn-release-isolated-defect-ledger-v1' and KNOWN_DEFECTS<={d['id']for d in defects} and
             len({d['id']for d in defects})==len(defects) and all(d['severity']in ('P0','P1','P2','P3')for d in defects) and
             all(d['severity']in ('P0','P1')for d in defects if d['id']in KNOWN_DEFECTS-{'UPG-01'}) and
             any(d['severity']in ('P0','P1')for d in defects) and all(d['verifiedClosed']for d in defects if d['severity']in ('P0','P1')))
    all_known=bool(defects) and KNOWN_DEFECTS<={d['id']for d in defects} and len({d['id']for d in defects})==len(defects) and all(d['verifiedClosed']for d in defects)
    checks=[]
    for invariant in invariants.get('invariants',[]):
        ids=invariant.get('requiredCaseIds',[]);passed=replay(ids);failures=0 if ids else None
        for rid in round_ids:
            for identifier in ids:
                rows=[r for r in results if r.get('caseId')==identifier and r.get('roundId')==rid]
                if len(rows)!=1 or rows[0].get('commit')!=commit or rows[0].get('runId')!=run or not rows[0].get('evidence') or not rows[0].get('observedAt') or rows[0].get('status')not in ('pass','fail'):
                    failures=None
                elif failures is not None:failures+=rows[0]['status']=='fail'
        checks.append(dict(id=invariant['id'],allTenRoundsAsserted=passed,failureCount=failures,caseDenominator=10*len(ids),scope=invariant['scope']))
    invariant_gate=(invariants.get('kind')=='cn-release-isolated-invariant-registry-v1' and KNOWN_INVARIANTS<={c['id']for c in checks} and
                    len({c['id']for c in checks})==len(checks) and all(c['allTenRoundsAsserted']for c in checks))
    accepted=ten and no_bad and full and serious and all_known and invariant_gate
    return dict(scope='complete-declared-isolated-regression',isolatedAcceptance=accepted,productionAcceptance=False,
        realCloudThirtyMinutes=None,tenOfTen=ten,identityValid=identity_valid,roundSeedsValid=seeds_valid,allCaseKeysUnique=unique_cases,requiredCasesNoFailureOrSkip=bool(no_bad),fullMatrixCoverage=full,
        seriousIssuesClosed=serious,allKnownIssuesClosed=all_known,safetyInvariantAssertionsPassed=invariant_gate,
        assertedInvariantFailureCount=sum(c['failureCount']for c in checks)if checks and all(c['failureCount']is not None for c in checks)else None,
        assertedInvariantCaseDenominator=sum(c['caseDenominator']for c in checks),defects=defects,invariants=checks,
        attestationLimit='Local tracked review bytes and source reference are verified; reviewer identity is not cryptographically authenticated.')
