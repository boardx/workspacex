"""独立候选五镜像协议；不构造旧归档计划，不授予发布权限。"""
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import re
import tarfile
import cn_image_archive as a
SOURCE = '55d904af3edcca54b2fbe17bba59ed2eed09323b'
# Preserve historical/diagnostic identity; formal builds admit only reviewed exact sources.
FORMAL_SOURCES = frozenset((SOURCE, '5285bef9a6c91bbb9857ede42779aafa64b98f32'))
KIND = 'cn-image-candidate-v2'
LABEL = 'org.workspacex.candidate-build-identity'
spec = importlib.util.spec_from_file_location('candidate_hosted', Path(__file__).with_name('hosted-release.py'))
hosted = importlib.util.module_from_spec(spec); spec.loader.exec_module(hosted)
require = a.require

def validate_plan(p):
    require(type(p) is dict, 'CANDIDATE_PLAN_FIELDS')
    profile=p.get('budgetProfile')
    require(profile is None or profile == 'formal-4g-v1', 'CANDIDATE_BUDGET_PROFILE')
    require(('budgetProfile' not in p) or profile == 'formal-4g-v1', 'CANDIDATE_BUDGET_PROFILE')
    require(set(p)-({'budgetProfile'} if profile else set()) == {'kind','schemaVersion','sourceRevision','controlRevision','attemptId','platform','baseImages','sourceContracts','maxArchiveBytes','maxTotalBytes','storageMarginBytes'}, 'CANDIDATE_PLAN_FIELDS')
    require(p['kind'] == KIND and type(p['schemaVersion']) is int and p['schemaVersion'] == 2, 'CANDIDATE_SCHEMA')
    require(isinstance(p['sourceRevision'],str) and p['sourceRevision'] in FORMAL_SOURCES and a.hex_string(p['controlRevision'],40), 'CANDIDATE_EXACT_SHA')
    require(isinstance(p['attemptId'],str) and re.fullmatch('[a-z0-9][a-z0-9-]{0,63}',p['attemptId']), 'CANDIDATE_ATTEMPT')
    require(p['platform'] == 'linux/amd64', 'CANDIDATE_PLATFORM')
    bases=p['baseImages']; require(type(bases) is dict and set(bases)=={'node','python','postgres'}, 'CANDIDATE_BASES')
    for k,r in {'node':'docker.io/library/node','python':'docker.io/library/python','postgres':'docker.io/pgvector/pgvector'}.items():
        require(isinstance(bases[k],str) and re.fullmatch(re.escape(r)+'@sha256:[a-f0-9]{64}',bases[k]), 'CANDIDATE_BASE_DIGEST')
    contracts=p['sourceContracts']; require(type(contracts) is dict and set(contracts)==set(hosted.SERVICES), 'CANDIDATE_CONTRACT_SET')
    for service,(repo,dockerfile,context,basekeys) in hosted.SERVICES.items():
        v=contracts[service]; require(type(v) is dict and set(v)=={'repository','dockerfile','context','bases','dockerfileSha256'}, 'CANDIDATE_CONTRACT_FIELDS')
        require(v['repository']==repo and v['dockerfile']==dockerfile and v['context']==context and v['bases']==list(basekeys) and a.hex_string(v['dockerfileSha256'],64), 'CANDIDATE_SOURCE_CONTRACT')
    require(type(p['maxArchiveBytes']) is int and p['maxArchiveBytes']==(4 if profile else 2)*1024**3 and type(p['maxTotalBytes']) is int and p['maxTotalBytes']==10*1024**3 and type(p['storageMarginBytes']) is int and p['storageMarginBytes']==2*1024**3, 'CANDIDATE_FIXED_BUDGET')
    return p

def validate_diagnostic_plan(p):
    validate_plan(p)
    require(p['sourceRevision']==SOURCE,'DIAGNOSTIC_SOURCE_NOT_ALLOWED')
    require('budgetProfile' not in p and p['maxArchiveBytes']==2*1024**3,'DIAGNOSTIC_FIXED_BUDGET')
    return p

def identity(p):
    validate_plan(p)
    bound={k:p[k] for k in ('kind','schemaVersion','sourceRevision','controlRevision','platform','baseImages','sourceContracts')}
    if 'budgetProfile' in p:bound['budgetProfile']=p['budgetProfile']
    return a.sha(a.json_bytes(bound))

def tag(p,s):
    require(s in hosted.SERVICES,'CANDIDATE_SERVICE')
    return 'wsx-candidate-'+p['attemptId']+'/'+hosted.SERVICES[s][0]+':'+p['sourceRevision']

def inspect(path,p,s):
    validate_plan(p); require(0<Path(path).stat().st_size<=p['maxArchiveBytes'],'CANDIDATE_SIZE')
    with tarfile.open(path,'r:') as t:
        ix=a.members(t); require('manifest.json' in ix,'CANDIDATE_MANIFEST')
        m=a.decode(a.small_member(t,ix['manifest.json'])); require(type(m) is list and len(m)==1,'CANDIDATE_ONE_IMAGE')
        v=m[0]; require(type(v) is dict and set(v)=={'Config','RepoTags','Layers'} and v['RepoTags']==[tag(p,s)],'CANDIDATE_TAG')
        names=v['Layers']; require(type(names) is list and 0<len(names)<=128 and len(names)==len(set(names)),'CANDIDATE_LAYERS')
        for n in [v['Config'],*names]: a.safe_name(n)
        needed={'manifest.json',v['Config'],*names}; require(set(n for n,x in ix.items() if x.isfile())==needed and needed<=set(ix),'CANDIDATE_MEMBERS')
        raw=a.small_member(t,ix[v['Config']]); config=a.decode(raw)
        require(config.get('os')=='linux' and config.get('architecture')=='amd64','CANDIDATE_IMAGE_PLATFORM')
        labels=config.get('config',{}).get('Labels',{}); require(type(labels) is dict and labels.get('org.opencontainers.image.revision')==p['sourceRevision'] and labels.get(LABEL)==identity(p) and 'org.workspacex.archive-build-identity' not in labels,'CANDIDATE_LABELS')
        layers=[{'name':n,'size':ix[n].size,'sha256':a.member_digest(t,ix[n])} for n in names]
        root=config.get('rootfs',{}); require(root.get('type')=='layers' and root.get('diff_ids')==['sha256:'+x['sha256'] for x in layers],'CANDIDATE_DIFF_IDS')
        return {'configSha256':a.sha(raw),'imageId':'sha256:'+a.sha(raw),'layers':layers,'stagingTag':tag(p,s)}

def validate_historical_receipt(raw,p,expected):
    """Structure/identity only; NEVER authorizes consuming an expired receipt."""
    require(len(raw)<=256*1024 and a.sha(raw)==expected,'CANDIDATE_RECEIPT_RAW_HASH')
    v=a.decode(raw); require(type(v) is dict and set(v)=={'kind','schemaVersion','planRawSha256','planSha256','identity','attemptId','producedAt','expiresAt','images','releaseReady','productionReady'},'CANDIDATE_RECEIPT_FIELDS')
    require(v['kind']==KIND and type(v['schemaVersion']) is int and v['schemaVersion']==2 and v['identity']==identity(p) and v['attemptId']==p['attemptId'] and v['planSha256']==a.sha(a.json_bytes(p)) and a.hex_string(v['planRawSha256'],64),'CANDIDATE_RECEIPT_IDENTITY')
    require(v['releaseReady'] is False and v['productionReady'] is False,'CANDIDATE_NON_AUTHORIZING')
    first=a.timestamp(v['producedAt']);last=a.timestamp(v['expiresAt']);require(first<last and (last-first).total_seconds()<=3600 ,'CANDIDATE_EXPIRED')
    require(type(v['images']) is dict and 0<len(v['images'])<=5 and set(v['images'])<=set(hosted.SERVICES),'CANDIDATE_SERVICE_SET')
    return v

def validate_receipt(raw,p,expected,now=None):
    v=validate_historical_receipt(raw,p,expected)
    require(a.timestamp(v['producedAt']) <= (now or datetime.now(timezone.utc)) < a.timestamp(v['expiresAt']), 'CANDIDATE_EXPIRED')
    return v

def verify_bundle(folder,p,raw,expected,raw_plan_sha,now=None,complete=True):
    validate_receipt(raw,p,expected,now)
    return verify_historical_bundle(folder,p,raw,expected,raw_plan_sha,complete)

def verify_historical_bundle(folder,p,raw,expected,raw_plan_sha,complete=True):
    """Byte verification only. Caller must separately admit provenance/freshness."""
    v=validate_historical_receipt(raw,p,expected);require(v['planRawSha256']==raw_plan_sha,'CANDIDATE_ORIGINAL_PLAN_BINDING')
    if complete:require(set(v['images'])==set(hosted.SERVICES),'CANDIDATE_COMPLETE_FIVE')
    total=0
    for s,entry in v['images'].items():
        require(type(entry) is dict and set(entry)=={'file','size','sha256','configSha256','imageId','layers','stagingTag'} and entry['file']==s+'.tar','CANDIDATE_IMAGE_FIELDS')
        path=Path(folder)/entry['file'];require(path.is_file() and not path.is_symlink(),'CANDIDATE_FILE_TRUST')
        size,digest=a.file_digest(path,p['maxArchiveBytes']);require(type(entry['size']) is int and size==entry['size'] and digest==entry['sha256'],'CANDIDATE_TAR_HASH')
        require(inspect(path,p,s)=={k:entry[k] for k in ('configSha256','imageId','layers','stagingTag')},'CANDIDATE_CONFIG_BINDING');total+=size
    require(total<=p['maxTotalBytes'],'CANDIDATE_TOTAL')
    return v

def offline_assembly(p,candidate_raw,candidate_sha,assembly_raw,assembly_sha,folder,raw_plan_sha):
    """输入一致性而非认证：真实 Redis 信任路由尚未实现，始终 NOT_READY。"""
    require(len(assembly_raw)<=16384 and a.sha(assembly_raw)==assembly_sha,'ASSEMBLY_RAW_HASH')
    candidate=verify_bundle(folder,p,candidate_raw,candidate_sha,raw_plan_sha)
    require(set(candidate['images'])==set(hosted.SERVICES),'ASSEMBLY_COMPLETE_FIVE')
    v=a.decode(assembly_raw);require(type(v) is dict and set(v)=={'kind','schemaVersion','candidateRawSha256','candidateIdentity','redisImage','release'},'ASSEMBLY_FIELDS')
    require(v['kind']=='cn-image-candidate-assembly-v2' and type(v['schemaVersion']) is int and v['schemaVersion']==2 and v['candidateRawSha256']==candidate_sha and v['candidateIdentity']==identity(p),'ASSEMBLY_BINDING')
    require(isinstance(v['redisImage'],str) and re.fullmatch(re.escape(a.PREFIX+'/base-redis')+'@sha256:[a-f0-9]{64}',v['redisImage']),'ASSEMBLY_REDIS_REFERENCE')
    require(isinstance(v['release'],str) and re.fullmatch(r'v?\d+\.\d+\.\d+(?:-[a-zA-Z0-9]+(?:[.-][a-zA-Z0-9]+)*)?',v['release']),'ASSEMBLY_RELEASE')
    return {'status':'NOT_READY','inputConsistent':True,'candidateRawSha256':candidate_sha,'assemblyRawSha256':assembly_sha,'productionReady':False,'releaseReady':False,'blockers':['AUTHENTICATED_FRESH_REDIS_TRUST_ROUTING_NOT_IMPLEMENTED','VERSIONED_ASSEMBLY_PUBLISH_CONSUMER_NOT_IMPLEMENTED']}
