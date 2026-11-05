#!/usr/bin/env python3
"""Fixed devapp-only aggregate diagnosis. Never prints inspect/env/SQL/error text."""
import json, subprocess

# Read-only filesystem checks run as the API container's configured user.
STORAGE = r'''
import {lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
const e=process.env,p=e.WORKSPACEX_CREDIT_RECEIPT_DIR;
const out={production:e.NODE_ENV==='production',asrConfigured:['KERNEL_ASR_PROVIDER','KERNEL_ASR_BASE_URL','KERNEL_ASR_API_KEY','KERNEL_ASR_MODEL'].every(k=>!!e[k]),productQuotaEnabled:e.KERNEL_AI_PRODUCT_QUOTA_ENABLED==='1',receiptDirectoryConfigured:!!p,receiptDirectoryExists:false,receiptDirectoryPrivate:false,receiptDirectoryWritable:false};
if(p){try{const s=await lstat(p);out.receiptDirectoryExists=s.isDirectory()&&!s.isSymbolicLink();out.receiptDirectoryPrivate=out.receiptDirectoryExists&&(s.mode&0o077)===0;try{await access(p,constants.W_OK|constants.X_OK);out.receiptDirectoryWritable=true;}catch{}}catch{}}
console.log(JSON.stringify(out));
'''

def call(args, data=None):
    result=subprocess.run(args,input=data,text=True,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=25,check=False)
    if result.returncode:raise ValueError('probe_command_unavailable')
    return result.stdout

def env(row):
    return dict(v.split('=',1)for v in row.get('Config',{}).get('Env',[])if '=' in v)

def persistent_mount(row,path):
    if not path or not path.startswith('/') or '..' in path.split('/'):return False
    mounts=[m for m in row.get('Mounts',[])if path==m.get('Destination')or path.startswith(m.get('Destination','').rstrip('/')+'/')]
    if not mounts:return False
    mount=max(mounts,key=lambda m:len(m['Destination']))
    return mount.get('Type')in('bind','volume')and mount.get('RW')is True

def literal(value):
    return "'"+value.replace("'","''")+"'"

def run():
    ids=call(['docker','ps','--filter','label=com.docker.compose.project=workspacex-image','--format','{{.ID}}']).split()
    if not ids:raise ValueError('devapp_project_unavailable')
    rows=json.loads(call(['docker','inspect',*ids]))
    apis=[r for r in rows if r.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')=='api'and r.get('State',{}).get('Running')is True]
    if len(apis)!=1:raise ValueError('unique_devapp_api_unavailable')
    api=apis[0];ae=env(api)
    report=json.loads(call(['docker','exec','-i',api['Id'],'node','--input-type=module'],STORAGE))
    report['receiptDirectoryPersistentRwMount']=persistent_mount(api,ae.get('WORKSPACEX_CREDIT_RECEIPT_DIR'))
    report['tariffQueryAvailable']=False
    # Aggregate ONLY fixed internal diagnostic tokens; raw logs never leave this process.
    reasons=('credit_receipt_store_unavailable','credit_native_tariff_missing','credit_payer_provenance_missing','team_license_accounting_unavailable','ASR_USAGE_TERMINAL_FAILED','ASR_ACCOUNTING_REPAIR_REQUIRED','CREDIT_ACCOUNTING_UNAVAILABLE')
    try:
        logs=subprocess.run(['docker','logs','--since','30m','--tail','2000',api['Id']],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,check=False)
        report['recentErrorCounts']={r:(logs.stdout+logs.stderr).count(r)for r in reasons}
        report['recentLogsReadAvailable']=logs.returncode==0
    except Exception:report['recentLogsReadAvailable']=False
    # Only local DB whose network aliases AND DB name match this actual API.
    databases=[]
    for row in rows:
        if row.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')!='postgres':continue
        de=env(row)
        aliases={a for n in row.get('NetworkSettings',{}).get('Networks',{}).values()for a in n.get('Aliases',[])or []}
        aliases.add(row.get('Name','').lstrip('/'))
        if ae.get('PGHOST')in aliases and ae.get('PGDATABASE')==de.get('POSTGRES_DB')and ae.get('PGPORT','5432')=='5432':databases.append(row)
    if len(databases)==1 and ae.get('KERNEL_ASR_PROVIDER')and ae.get('KERNEL_ASR_MODEL'):
        db=databases[0];de=env(db)
        sql="BEGIN READ ONLY; SET LOCAL statement_timeout='5000ms'; SELECT json_build_object('matchingTariffs',count(*),'pricedOrganizations',count(DISTINCT org_id)) FROM credit_native_tariffs WHERE model_provider="+literal(ae['KERNEL_ASR_PROVIDER'])+" AND model_id="+literal(ae['KERNEL_ASR_MODEL'])+" AND unit='millisecond'; COMMIT;"
        try:
            raw=call(['docker','exec','-i',db['Id'],'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',de.get('POSTGRES_USER','postgres'),'-d',ae['PGDATABASE']],sql)
            aggregate=json.loads(raw.strip());report.update(aggregate);report['tariffQueryAvailable']=True
        except Exception:pass
    print(json.dumps(report,sort_keys=True))

if __name__=='__main__':
    try:run()
    except Exception:print(json.dumps({'probeAvailable':False,'reason':'devapp_readonly_probe_unavailable'}));raise SystemExit(1)
