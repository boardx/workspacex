#!/usr/bin/env python3
"""Offline renderer. Writes private files; never connects to any service."""
import argparse,hashlib,json,os,re,secrets,uuid
from pathlib import Path
P=Path(__file__).resolve().parents[1]
def need(ok,message):
    if not ok:raise ValueError(message)
def private(path,raw):
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write(raw)
def env(path,values):
    for k,v in values.items():need(isinstance(v,str) and not any(c in v for c in '\r\n\0'),'Invalid env value: '+k)
    private(path,''.join(k+'='+v+'\n' for k,v in values.items()))
def validate(c):
    need(set(c)=={'domain','registryPrefix','releaseTag','sourceRevision','redisImage','adminEmail','adminName','orgName','modelBaseUrl','modelId','modelApiKey'},'Invalid settings keys')
    need('REPLACE_' not in json.dumps(c),'Replace every REPLACE_ value first')
    need(all(isinstance(v,str) and v and not any(x in v for x in '\r\n\0') for v in c.values()),'Settings must be nonempty single-line strings')
    need(len(c['domain'])<=253 and '.' in c['domain'] and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',v) for v in c['domain'].split('.')),'Invalid domain')
    need(bool(re.fullmatch(r'[a-f0-9]{40}',c['sourceRevision'])),'Use full source SHA')
    need(bool(re.fullmatch(r'[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}',c['releaseTag'])) and c['releaseTag'].lower()!='latest','Invalid image tag')
    need(bool(re.fullmatch(r'[a-z0-9][a-z0-9.-]*(?::[0-9]+)?/[a-z0-9]+(?:[._-][a-z0-9]+)*',c['registryPrefix'])),'Invalid registry prefix')
    need(bool(re.fullmatch(r'[a-z0-9][a-zA-Z0-9.:/_-]*@sha256:[a-f0-9]{64}',c['redisImage'])),'Redis must be digest pinned')
    need(bool(re.fullmatch(r'https://[A-Za-z0-9.-]+(?::[0-9]+)?(?:/[A-Za-z0-9._~-]+)*/?',c['modelBaseUrl'])),'Invalid HTTPS model URL')
    need(bool(re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+',c['adminEmail'])),'Invalid admin email')
    need(not c['modelApiKey'].startswith(('sk-example','example')),'Supply real model API key')
    return c
def render(c,out):
    validate(c);need(not out.exists(),'Output already exists; stable secrets must not be regenerated')
    out.mkdir(mode=0o700,parents=True)
    private(out/'settings.json',json.dumps(c,indent=2)+'\n')
    s={k:secrets.token_hex(32) for k in ['owner','app','diag','agent','memory','memoryOwner','redis','modelCipher','emailVerification','nativeBinding','serviceKey','admin']}
    private(out/'stable-secrets.json',json.dumps(s,indent=2)+'\n')
    marker=str(uuid.uuid5(uuid.NAMESPACE_URL,'workspacex-selfhost:'+c['sourceRevision']))
    pg={'PGHOST':'postgres','PGPORT':'5432','PGDATABASE':'workspacex','PGSSLMODE':'disable','APP_DB_USER':'app_rw','APP_DB_PASSWORD':s['app'],'DIAG_DB_USER':'app_diag_ro','DIAG_DB_PASSWORD':s['diag']}
    model={'KERNEL_MODEL_MAX_OUTPUT_TOKENS':'4096','KERNEL_MODEL_PROVIDER':'openai-compatible','KERNEL_MODEL_BASE_URL':c['modelBaseUrl'],'KERNEL_MODEL_API_KEY':c['modelApiKey'],'KERNEL_DEEP_AGENT_MODEL_ID':c['modelId'],'KERNEL_DEFAULT_AGENT_MODEL_ID':c['modelId']}
    native={'DEEP_AGENT_SERVICE_INTERNAL_KEY':s['serviceKey'],'NATIVE_SESSION_SOCKET':'/run/sessions/skill-sandbox.sock'}
    api={**pg,**model,**native,'REDIS_HOST':'redis','REDIS_PORT':'6379','REDIS_PASSWORD':s['redis'],'REDIS_TLS':'false','NODE_ENV':'production','PORT':'3200','APP_PUBLIC_URL':'https://'+c['domain'],'MODEL_CREDENTIAL_KEY':s['modelCipher'],'EMAIL_VERIFICATION_SECRET':s['emailVerification'],'NATIVE_SESSION_BINDING_KEY':s['nativeBinding'],'KERNEL_NATIVE_RUNTIME':'1','KERNEL_MODEL_STREAM_ENABLED':'1','KERNEL_DEEP_AGENT_BASE_URL':'http://agent:8000','KERNEL_SUBTASK_CALLBACK_BASE_URL':'http://api:3200','KERNEL_SKILL_SANDBOX_SOCKET':'/run/sandbox/skill-sandbox.sock','WORKSPACEX_OBJECT_STORE':'fs','WORKSPACEX_OBJECT_ROOT':'/var/lib/workspacex/objects','WORKSPACEX_DEPLOYMENT_MARKER':marker,'WORKSPACEX_CREDIT_RECEIPT_DIR':'/var/lib/workspacex/credit-receipts'}
    agent={**model,**native,'DEEP_AGENT_USAGE_SPOOL_DIR':'/var/lib/workspacex-agent-usage','DEEP_AGENT_USAGE_CALLBACK_BASE_URL':'http://api:3200','DEEP_AGENT_USAGE_IDLE_REPLAY_ENABLED':'1','NATIVE_SESSION_SERVICE_BASE_URL':'http://api:3200','NATIVE_SESSION_SERVICE_KEY':s['serviceKey'],'DATABASE_URI':'postgresql://agent_server:'+s['agent']+'@postgres:5432/workspacex_agent','REDIS_URI':'redis://:'+s['redis']+'@redis:6379/1','MEMORY_STORE_DATABASE_URL':'postgresql://memory_rw:'+s['memory']+'@postgres:5432/workspacex_memory','MEMORY_STORE_SCHEMA':'workspacex_memory'}
    agent['DEEP_AGENT_CHECKPOINT_DB']=agent['DATABASE_URI']
    migration={**pg,'WORKSPACEX_DEPLOY_PROFILE':'starter','MIGRATION_DB_USER':'postgres','MIGRATION_DB_PASSWORD':s['owner'],'AGENT_DB_USER':'agent_server','AGENT_DB_PASSWORD':s['agent'],'AGENT_DB_DATABASE':'workspacex_agent','MEMORY_DB_USER':'memory_rw','MEMORY_DB_PASSWORD':s['memory'],'MEMORY_DB_OWNER':'memory_owner','MEMORY_DB_OWNER_PASSWORD':s['memoryOwner'],'MEMORY_DB_DATABASE':'workspacex_memory'}
    bootstrap={**pg,'PROVISION_ADMIN_EMAIL':c['adminEmail'],'PROVISION_ADMIN_PASSWORD':s['admin'],'PROVISION_ADMIN_NAME':c['adminName'],'PROVISION_ORG_NAME':c['orgName'],'KERNEL_DEFAULT_AGENT_MODEL_ID':c['modelId']}
    memory={'PROVISION_TIMEOUT_MS':'240000','MEMORY_STORE_DATABASE_URL':agent['MEMORY_STORE_DATABASE_URL'],'MEMORY_STORE_MIGRATION_DATABASE_URL':'postgresql://memory_owner:'+s['memoryOwner']+'@postgres:5432/workspacex_memory','MEMORY_STORE_SCHEMA':'workspacex_memory'}
    probe={**api,**bootstrap,'PROVISION_PUBLIC_URL':'https://'+c['domain'],'PROVISION_TIMEOUT_MS':'90000','PROVISION_ORG_ID':'FILL_FROM_BOOTSTRAP','PROVISION_DEFAULT_AGENT_ID':'FILL_FROM_BOOTSTRAP'}
    for name,values in {'api':api,'agent':agent,'migration':migration,'bootstrap':bootstrap,'memory-migration':memory,'probe':probe,'postgres':{'POSTGRES_USER':'postgres','POSTGRES_PASSWORD':s['owner'],'POSTGRES_DB':'workspacex'},'web':{'NODE_ENV':'production','PORT':'3000','API_INTERNAL_URL':'http://api:3200','WORKSPACEX_DEPLOYMENT_MARKER':marker}}.items():env(out/(name+'.env'),values)
    images={role.upper()+'_IMAGE':c['registryPrefix']+'/'+repo+':'+c['releaseTag'] for role,repo in {'api':'api','web':'web','agent':'deep-agent','sandbox':'skill-sandbox','postgres':'postgres-age'}.items()};images['REDIS_IMAGE']=c['redisImage']
    env(out/'compose.env',images)
    private(out/'compose.json',(P/'templates/compose.json').read_text())
    private(out/'redis.conf','bind 0.0.0.0\nprotected-mode yes\nappendonly yes\nrequirepass '+s['redis']+'\n')
    private(out/'nginx.conf',(P/'templates/nginx.conf').read_text().replace('REPLACE_US_DOMAIN',c['domain']))
    print('Private configuration generated at '+str(out)+'; no server was contacted')
def main():
    a=argparse.ArgumentParser();a.add_argument('settings',type=Path);a.add_argument('output',type=Path);args=a.parse_args()
    render(json.loads(args.settings.read_text()),args.output)
if __name__=='__main__':
    try:main()
    except (ValueError,OSError,json.JSONDecodeError) as e:raise SystemExit(str(e))
