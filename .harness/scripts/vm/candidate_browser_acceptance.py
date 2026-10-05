"""Actual candidate browser receipt entry; root provides byte-pinned helper module.
No legacy runtime names, new DB clients, or command runs on import.
"""
import datetime,hashlib,json,pathlib,re,stat,time
from writer_fence import require
APP='9b25bfa65662b96c0826fe67506b562ea46aa6d0'
BASE='ba6343199f3c834d6a198f83d0c771614292c82b'
JOURNEYS=('login','hello','asr','githubFeedbackRead','skillTool','pdfDownload')

def _runtime_files(runtime,tool):
    root=pathlib.Path(runtime['playwrightRoot'])
    require(str(root).startswith('/opt/workspacex-cn/release-tools/'+tool+'/') and '..' not in root.parts,'CANDIDATE_BROWSER_PLAYWRIGHT_SCOPE')
    for parent in (root,*root.parents):
        value=parent.lstat();require(stat.S_ISDIR(value.st_mode) and value.st_uid==0 and not value.st_mode&0o022,'CANDIDATE_BROWSER_RUNTIME_PARENT')
    actual={}
    for path in root.rglob('*'):
        value=path.lstat();require(not path.is_symlink() and value.st_uid==0 and value.st_gid==0 and not value.st_mode&0o022,'CANDIDATE_BROWSER_RUNTIME_TRUST')
        if path.is_file():actual[str(path.relative_to(root))]=hashlib.sha256(path.read_bytes()).hexdigest()
    require(actual and actual==runtime['filesSha256'],'CANDIDATE_BROWSER_RUNTIME_HASH')
    chrome=pathlib.Path(runtime['chromiumPath'])
    require(str(chrome) in ('/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'),'CANDIDATE_BROWSER_CHROMIUM_SCOPE')
    value=chrome.lstat();require(stat.S_ISREG(value.st_mode) and value.st_uid==0 and value.st_gid==0 and value.st_nlink==1 and not value.st_mode&0o022 and hashlib.sha256(chrome.read_bytes()).hexdigest()==runtime['chromiumSha256'],'CANDIDATE_BROWSER_CHROMIUM_HASH')

def candidate_browser_receipt(transport,binding,now=time.time):
    import compiled_maintenance_activation as source
    require(type(binding) is dict and set(binding)=={'identity','browserPlan','nodeBinary'},'CANDIDATE_BROWSER_BINDING')
    identity=binding['identity'];require(type(identity) is dict and set(identity)=={'sourceRevision','baselineRevision','migrationPlanSha256','attemptId'} and identity['sourceRevision']==APP and identity['baselineRevision']==BASE and re.fullmatch('[a-f0-9]{64}',identity['migrationPlanSha256']) and re.fullmatch('[A-Za-z0-9-]{1,128}',identity['attemptId']),'CANDIDATE_BROWSER_IDENTITY')
    require(identity==transport.plan['identity'],'CANDIDATE_BROWSER_TRANSPORT_IDENTITY');transport.require_lock();transport._guard(transport.plan)
    ref=binding['browserPlan'];require(type(ref) is dict and set(ref)=={'path','sha256'} and ref['path'].startswith(f"/etc/workspacex-cn/maintenance-activation/{APP}/{identity['attemptId']}/") and '..' not in pathlib.Path(ref['path']).parts and re.fullmatch('[a-f0-9]{64}',ref['sha256']),'CANDIDATE_BROWSER_PLAN_SCOPE')
    raw=source.private(ref['path'],ref['sha256']);request=json.loads(raw)
    profile_raw=source.private('/etc/workspacex-cn/trusted-tool-binding.json');profile=json.loads(profile_raw)
    runtime=profile.get('maintenanceBrowserRuntime');require(type(runtime) is dict and set(runtime)=={'playwrightRoot','filesSha256','chromiumPath','chromiumSha256','nodeSha256'} and re.fullmatch('[a-f0-9]{40}',profile['toolRevision']),'CANDIDATE_BROWSER_RUNTIME_SCHEMA')
    require(binding['nodeBinary']=={'path':'/usr/bin/node','sha256':runtime['nodeSha256']} and request['playwrightModule']==runtime['playwrightRoot'] and request['browserExecutable']==runtime['chromiumPath'],'CANDIDATE_BROWSER_RUNTIME_BINDING')
    require(request['audioPath'].startswith(str(pathlib.Path(ref['path']).parent)+'/') and '..' not in pathlib.Path(request['audioPath']).parts,'CANDIDATE_BROWSER_AUDIO_SCOPE')
    source.private(request['audioPath'],request['audioSha256']);_runtime_files(runtime,profile['toolRevision'])
    # Verifier bytes themselves come from the exact installed profile closure.
    # It revalidates browser and producer bytes and injects concrete compiled refs.
    code=source.installed_code('acceptance_source_closure.cjs').decode()+"\nlet raw='';process.stdin.on('data',b=>{raw+=b;if(Buffer.byteLength(raw)>1048576)process.exit(1)});process.stdin.on('end',()=>{const p=JSON.parse(raw);const closure=module.exports.loadPinnedAcceptanceClosure();closure.producer.browserReceipt(p.browserPlan,p.identity,require(p.browserPlan.playwrightModule).chromium).then(v=>process.stdout.write(JSON.stringify(v))).catch(()=>process.exit(1));});"
    result=json.loads(source.invoke({'binaries':{'node':binding['nodeBinary']}},'node',['-e',code],json.dumps(dict(identity=identity,browserPlan=request)).encode()))
    require(type(result) is dict and set(result)=={'schemaVersion','kind','identity','deploymentMarker','observedAt','ownedAcceptanceRunIds','checks'} and result['schemaVersion']==1 and result['kind']=='browser-acceptance-completed' and result['identity']==identity and result['deploymentMarker']==request['deploymentMarker'] and type(result['checks']) is dict and set(result['checks'])==set(JOURNEYS) and all(v is True for v in result['checks'].values()),'CANDIDATE_BROWSER_RECEIPT_REJECTED')
    ids=result['ownedAcceptanceRunIds'];require(type(ids) is list and len(ids)==3 and len(set(ids))==3 and all(type(v) is str and re.fullmatch('[A-Za-z0-9_-]{1,128}',v) for v in ids),'CANDIDATE_BROWSER_ACTUAL_IDS')
    stamp=datetime.datetime.fromisoformat(result['observedAt'].replace('Z','+00:00'));require(stamp.tzinfo is not None and 0<=now()-stamp.timestamp()<=30,'CANDIDATE_BROWSER_RECEIPT_STALE')
    _runtime_files(runtime,profile['toolRevision']);require(source.private('/etc/workspacex-cn/trusted-tool-binding.json')==profile_raw and source.private(ref['path'],ref['sha256'])==raw,'CANDIDATE_BROWSER_SOURCE_CHANGED')
    transport.require_lock();transport._guard(transport.plan)
    return result

def persist_candidate_browser_receipt(transport,binding,now=time.time):
    from acceptance_receipt_store import publish_receipt
    return publish_receipt(binding['identity'],'browser',candidate_browser_receipt(transport,binding,now))
