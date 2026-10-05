"""Fixed APP read-only health routes through existing API runtime; no model/run."""
import datetime,json,re,time
from writer_fence import require,digest
APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
# Node is already in the fixed API image. No user URL, script, env, credential,
# provider endpoint or SQL is accepted. Unix sandbox is network_mode=none.
from candidate_readonly_docker import HEALTH_PROBE as PROBE,invoke_readonly_docker
def collect_service_health(transport,marker,now=time.time):
    transport.require_lock();plan=transport.plan
    require(plan['identity']['sourceRevision']==APP and type(marker) is str and marker,'SERVICE_HEALTH_BINDING')
    api=[w for w in plan['candidateWriters'] if w['binding'].get('service')=='api'];require(len(api)==1,'SERVICE_HEALTH_API_BINDING')
    b=api[0]['binding'];require(re.fullmatch('[a-f0-9]{64}',b['containerId']),'SERVICE_HEALTH_CONTAINER_ID')
    inventory=transport.host.docker_inventory();actual=[v for v in inventory if v.get('Id')==b['containerId']]
    require(len(actual)==1 and actual[0]['Image']==b['imageId'] and digest(actual[0]['Config'])==b['configSha256'] and actual[0]['State'].get('Status')=='running','SERVICE_HEALTH_RUNTIME_DRIFT')
    import compiled_maintenance_activation as source
    profile_raw=source.private('/etc/workspacex-cn/trusted-tool-binding.json')
    raw=invoke_readonly_docker(source,profile_raw,'service-health',api_id=b['containerId']);require(type(raw) is bytes and 0<len(raw)<=262144,'SERVICE_HEALTH_OUTPUT_BOUND')
    value=json.loads(raw);require(type(value) is dict and set(value)=={'web','api','agent','sandbox'},'SERVICE_HEALTH_SCHEMA')
    require(value['web'].get('deploymentMarker')==marker and value['api'].get('deploymentMarker')==marker and value['api'].get('trustworthy') is True and value['agent']=={'ok':True,'runtime':'workspacex-self-hosted'} and value['agent']['ok'] is True and value['sandbox']=={'ok':True} and value['sandbox']['ok'] is True,'SERVICE_HEALTH_REJECTED')
    transport.require_lock()
    return dict(schemaVersion=1,kind='fixed-app-service-health',identity=plan['identity'],deploymentMarker=marker,observedAt=datetime.datetime.fromtimestamp(now(),datetime.timezone.utc).isoformat().replace('+00:00','Z'),apiContainerId=b['containerId'],probeSha256=digest(PROBE),responses=value,services={k:'healthy' for k in value})

def persist_service_health(transport,marker,now=time.time):
    from acceptance_receipt_store import publish_receipt
    return publish_receipt(transport.plan['identity'],'services',collect_service_health(transport,marker,now))
