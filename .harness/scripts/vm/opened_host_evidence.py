"""Read-only opened evidence on existing retained diagnostic session; no entrypoint."""
import copy,datetime,hashlib,json,re,time
from host_transport import private
from opened_service_health import collect_service_health
from writer_fence import require,digest
APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
BASE='ba6343199f3c834d6a198f83d0c771614292c82b'
SERVICES=('web','api','agent','sandbox')
ID=re.compile(r'^[A-Za-z0-9_-]{1,128}$')
MAX_SAFE=9007199254740991

def collect_opened_host_evidence(transport,binding,read_private=private,now=time.time,*,expected_identity):
    require(type(binding) is dict and set(binding)=={'identity','deploymentMarker','canonicalReceipt','browserReceipt'},'OPENED_BINDING_SCHEMA')
    identity=binding['identity'];plan=transport.plan
    require(type(identity) is dict and set(identity)=={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'} and identity==expected_identity and identity==plan['identity'] and type(identity['sourceRevision']) is str and re.fullmatch('[a-f0-9]{40}',identity['sourceRevision']) and identity['baselineRevision']==BASE and re.fullmatch('[a-f0-9]{64}',identity['migrationPlanSha256']) and ID.fullmatch(identity['attemptId']),'OPENED_IDENTITY')
    require(type(binding['deploymentMarker']) is str and binding['deploymentMarker'],'OPENED_MARKER')
    transport.require_lock()
    owned=[]
    for lane in ('canonical','browser'):
        ref=binding[lane+'Receipt']
        path=f"/etc/workspacex-cn/maintenance-acceptance/{identity['sourceRevision']}/{identity['attemptId']}/{lane}.json"
        require(type(ref) is dict and set(ref)=={'path','sha256'} and ref['path']==path and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'OPENED_RECEIPT_BINDING')
        raw=read_private(path);require(type(raw) is bytes and 0<len(raw)<=1024*1024 and hashlib.sha256(raw).hexdigest()==ref['sha256'],'OPENED_RECEIPT_HASH')
        value=json.loads(raw)
        require(type(value) is dict and set(value)=={'schemaVersion','kind','identity','deploymentMarker','observedAt','ownedAcceptanceRunIds','checks'} and value['schemaVersion']==1 and value['kind']==lane+'-acceptance-completed' and value['identity']==identity and value['deploymentMarker']==binding['deploymentMarker'],'OPENED_RECEIPT_IDENTITY')
        stamp=datetime.datetime.fromisoformat(value['observedAt'].replace('Z','+00:00')).timestamp()
        require(0<=now()-stamp<=300,'OPENED_RECEIPT_STALE')
        checks={'status':'passed','lockRetained':True,'passedStages':8} if lane=='canonical' else {k:True for k in ('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')}
        require(type(value['checks']) is dict and value['checks']==checks and (type(value['checks'].get('passedStages')) is int and value['checks'].get('lockRetained') is True if lane=='canonical' else all(v is True for v in value['checks'].values())),'OPENED_RECEIPT_CHECKS')
        ids=value['ownedAcceptanceRunIds'];require(type(ids) is list and (0 if lane=='canonical' else 1)<=len(ids)<=128 and all(type(v) is str and ID.fullmatch(v) for v in ids) and len(set(ids))==len(ids),'OPENED_RECEIPT_RUN_IDS')
        owned.extend(ids)
    require(len(owned)<=128 and len(set(owned))==len(owned),'OPENED_OWNED_RUNS_DUPLICATE')
    observation=transport.observe_opened_candidate(copy.deepcopy(plan),transport.collector.collect_opened)
    require(type(observation) is dict and type(observation.get('observedAt')) in (int,float) and 0<=now()-observation['observedAt']<=30,'OPENED_OBSERVATION_STALE')
    queue=observation.get('runDrain');require(type(queue) is dict and set(queue)=={'queued','running','writebackPending'} and all(type(v) is int and 0<=v<=MAX_SAFE for v in queue.values()),'OPENED_QUEUE_SCHEMA')
    held=transport.host.read_hold()
    require(type(held) is dict and set(held)=={'schemaVersion','state','generation','identity','sha256','device','inode'} and held['schemaVersion']==1 and held['state']=='cleared' and held['identity']==identity and held['generation']==plan['holdGeneration'] and re.fullmatch('[a-f0-9]{64}',held['sha256']) and all(type(held[k]) is int and 0<=held[k]<=MAX_SAFE for k in ('device','inode')),'OPENED_HOLD_CAS')
    inventory=transport.host.docker_inventory();require(type(inventory) is list,'OPENED_DOCKER_INVENTORY')
    health={}
    for service in SERVICES:
        writers=[w for w in plan['candidateWriters'] if w['binding']['service']==service];require(len(writers)==1,'OPENED_SERVICE_BINDING')
        b=writers[0]['binding'];matches=[v for v in inventory if v.get('Id')==b['containerId']];require(len(matches)==1,'OPENED_CONTAINER_MISSING')
        v=matches[0];require(v.get('Image')==b['imageId'] and digest(v['Config'])==b['configSha256'] and v['Config']['Labels'].get('com.docker.compose.service')==service and v['State'].get('Status')=='running','OPENED_SERVICE_UNHEALTHY')
        health[service]='running-identity-verified'
    service_proof=collect_service_health(transport,binding['deploymentMarker'],now,expected_identity=expected_identity)
    health=service_proof['services']
    connection=transport.host.diagnostic_connections['workspacex']
    # The fixed helper must implement this parameterized operation; missing helper
    # support rejects naturally. Never open a new connection or execute caller SQL.
    result=connection.query('owned-release-runs',{'runIds':sorted(owned)})
    rows=result.get('rows') if type(result) is dict else None
    require(type(rows) is list and len(rows)==len(owned) and all(type(v) is dict and set(v)=={'id','status'} and v['status']=='succeeded' for v in rows) and sorted(v['id'] for v in rows)==sorted(owned),'OPENED_OWNED_RUNS_NOT_SUCCEEDED')
    transport.require_lock();require(transport.host.read_hold()==held,'OPENED_HOLD_DRIFT')
    return dict(identity=copy.deepcopy(identity),deploymentMarker=binding['deploymentMarker'],observedAt=datetime.datetime.fromtimestamp(now(),datetime.timezone.utc).isoformat().replace('+00:00','Z'),hold={k:held[k] for k in ('state','generation','sha256','device','inode')},queue=queue,ownedRuns=[dict(runId=r['id'],status=r['status']) for r in rows],services=health)
