"""Existing flat CN migration completion witness; never synthesizes a receipt."""
import datetime,hashlib,json,re,time
from writer_fence import require, admitted_release_identity

KEYS=('schemaVersion','scope','sourceRevision','baselineRevision','attemptId','release','originalPlanSha256',
 'completionPlanSha256','sourceInventorySha256','sourceBindingSha256','snapshotSha256','fullResponseSha256','ledgerSha256',
 'appliedSqlCount','pendingCount','driftCount','unknownAppliedCount','capturedAt','providerFinishedAt','expiresAt','productionMutationAuthorized')

def ledger_sha(rows):
    require(type(rows) is list,'CANDIDATE_COMPLETION_LEDGER_ROWS')
    normal=[]
    for r in rows:
        require(type(r) is dict and type(r.get('name')) is str and re.fullmatch('[A-Za-z0-9_.-]+',r['name']) and
            type(r.get('checksum')) is str and re.fullmatch('[a-f0-9]{64}',r['checksum']),'CANDIDATE_COMPLETION_LEDGER_ENTRY')
        normal.append(dict(name=r['name'],checksum=r['checksum']))
    require(len({r['name'] for r in normal})==len(normal),'CANDIDATE_COMPLETION_LEDGER_DUPLICATE')
    # Native compareMigrationInventory uses JSON.stringify objects {name,checksum}.
    raw=json.dumps(sorted(normal,key=lambda r:r['name']),separators=(',',':'),ensure_ascii=False).encode()
    return hashlib.sha256(raw).hexdigest()

def verify_completion(value,bound,rows,now=None,*,expected_release=None):
    require(type(value) is dict and set(value)==set(KEYS),'CANDIDATE_COMPLETION_NATIVE_SCHEMA')
    i=bound['identity']
    require(admitted_release_identity(i),'CANDIDATE_COMPLETION_RELEASE_PAIR')
    # Only the historic fixed pair retains its historical call convention.
    if expected_release is None and i['sourceRevision']=='9b25bfa65662b96c0826fe67506b562ea46aa6d0':expected_release='2026.10.3-cn.1'
    require(type(expected_release) is str and re.fullmatch('[A-Za-z0-9][A-Za-z0-9._-]{0,127}',expected_release),'CANDIDATE_COMPLETION_RELEASE_AUTHORITY')
    require(type(value['schemaVersion']) is int and value['schemaVersion']==1 and
        value['scope']=='validated-production-migration-completion' and
        value['sourceRevision']==i['sourceRevision'] and value['baselineRevision']==i['baselineRevision'] and
        value['attemptId']==i['attemptId'] and value['originalPlanSha256']==i['migrationPlanSha256'] and
        value['release']==expected_release and value['productionMutationAuthorized'] is False,
        'CANDIDATE_COMPLETION_NATIVE_BINDING')
    for k in ('completionPlanSha256','sourceInventorySha256','sourceBindingSha256','snapshotSha256','fullResponseSha256','ledgerSha256'):
        require(type(value[k]) is str and re.fullmatch('[a-f0-9]{64}',value[k]),'CANDIDATE_COMPLETION_NATIVE_HASH')
    require(type(value['appliedSqlCount']) is int and value['appliedSqlCount']==len(rows) and
        all(type(value[k]) is int and value[k]==0 for k in ('pendingCount','driftCount','unknownAppliedCount')) and
        value['ledgerSha256']==ledger_sha(rows),'CANDIDATE_COMPLETION_LIVE_LEDGER')
    clock=time.time() if now is None else now
    stamps=[]
    for k in ('capturedAt','providerFinishedAt','expiresAt'):
        require(type(value[k]) is str and re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z',value[k]),
            'CANDIDATE_COMPLETION_TIMESTAMP')
        stamps.append(datetime.datetime.fromisoformat(value[k].replace('Z','+00:00')).timestamp())
    captured,finished,expires=stamps
    require(all(v<=clock and clock-v<3600 for v in (captured,finished)) and clock<expires and
        expires<=min(captured,finished)+3600 and expires>max(captured,finished),'CANDIDATE_COMPLETION_FRESHNESS')
    return value['ledgerSha256']


def validate_completed(receipt,identity,ledger,now=None,*,expected_release=None):
    """Shared retained actor API; identity comes from its approved source plan."""
    return verify_completion(receipt,{'identity':identity},ledger,now,expected_release=expected_release)
