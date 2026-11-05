#!/usr/bin/env python3
"""Fixed devapp/CN aggregate diagnosis. Never prints inspect/env/SQL/error text."""
import json, os, re, subprocess
from urllib.parse import urlsplit

# Read-only filesystem checks run as the API container's configured user.
STORAGE = r'''
import {lstat,access} from 'node:fs/promises';
import {constants} from 'node:fs';
const e=process.env,p=e.WORKSPACEX_CREDIT_RECEIPT_DIR;
const out={production:e.NODE_ENV==='production',asrConfigured:['KERNEL_ASR_PROVIDER','KERNEL_ASR_BASE_URL','KERNEL_ASR_API_KEY','KERNEL_ASR_MODEL'].every(k=>!!e[k]),productQuotaEnabled:e.KERNEL_AI_PRODUCT_QUOTA_ENABLED==='1',receiptDirectoryConfigured:!!p,receiptDirectoryExists:false,receiptDirectoryPrivate:false,receiptDirectoryWritable:false};
if(p){try{const s=await lstat(p);out.receiptDirectoryExists=s.isDirectory()&&!s.isSymbolicLink();out.receiptDirectoryPrivate=out.receiptDirectoryExists&&(s.mode&0o077)===0;try{await access(p,constants.W_OK|constants.X_OK);out.receiptDirectoryWritable=true;}catch{}}catch{}}
console.log(JSON.stringify(out));
'''

DATABASE = r'''
import {Pool} from 'pg';
import {appConfig,migrationConfig} from './src/infrastructure/db/pg-config.ts';
import {readProductConfiguration,personalConfiguredProducts} from './src/infrastructure/billing/product-catalog-configuration.ts';
const e=process.env,ownerConfigured=!!e.MIGRATION_DB_USER&&!!e.MIGRATION_DB_PASSWORD;
const label=v=>typeof v==='string'&&/^[A-Za-z0-9._:/-]{1,160}$/.test(v)?v:'unavailable';
const out={tariffQueryAvailable:false,configuredOwnerCredentialAvailable:ownerConfigured};
let pool,client;
try{
 const config=ownerConfigured?migrationConfig():appConfig();
 pool=new Pool({...config,connectionTimeoutMillis:5000,statement_timeout:5000,max:1});
 client=await pool.connect();
 await client.query('BEGIN READ ONLY');
 // Fail rather than silently return an RLS-filtered zero across organizations.
 await client.query('SET LOCAL row_security=off');
 const row=(await client.query("SELECT count(*)::integer AS \"matchingTariffs\",count(DISTINCT org_id)::integer AS \"pricedOrganizations\" FROM credit_native_tariffs WHERE model_provider=$1 AND model_id=$2 AND unit='millisecond'",[e.KERNEL_ASR_PROVIDER,e.KERNEL_ASR_MODEL])).rows[0];
 const millisecondTariffs=(await client.query("SELECT model_provider,model_id,quantum::text,hundredths_per_quantum::text,count(*)::integer AS \"organizationCount\",count(DISTINCT version)::integer AS \"versionCount\" FROM credit_native_tariffs WHERE unit='millisecond' GROUP BY model_provider,model_id,quantum,hundredths_per_quantum ORDER BY model_provider,model_id LIMIT 50")).rows;
 const configured=await readProductConfiguration(client,'cn');
 const products=personalConfiguredProducts(configured.rows).filter(p=>p.kind==='credit_topup'&&p.currency==='CNY').sort((a,b)=>a.amountMinor-b.amountMinor);
 const first=products[0],ambiguous=!!first&&products[1]?.amountMinor===first.amountMinor;
 out.creditBasis=first&&!ambiguous?{catalogVersion:configured.version,sku:first.sku,amountMinor:first.amountMinor,credits:first.credits,currency:'CNY',market:'cn'}:{available:false,ambiguous};
 out.organizationCount=Number((await client.query('SELECT count(*)::integer AS count FROM organizations')).rows[0].count);
 out.repairAuditCount=Number((await client.query("SELECT count(*)::integer AS count FROM credit_native_tariff_changes WHERE new_tariff->>'version'=$1 AND new_tariff->'maintenance'->>'issue'=$2 AND old_tariff IS NULL",['asr-credit-6275-v1','6275'])).rows[0].count);
 out.recentAsrRequestStates=(await client.query("SELECT state,count(*)::integer AS count FROM credit_consumption_requests WHERE model_provider=$1 AND model_id=$2 AND created_at>now()-interval '30 minutes' GROUP BY state ORDER BY state",[e.KERNEL_ASR_PROVIDER,e.KERNEL_ASR_MODEL])).rows;
 out.recentAsrTerminals=(await client.query("SELECT outcome,native_source,count(*)::integer AS count,count(*) FILTER(WHERE native_quantity>0)::integer AS \"withAudio\" FROM token_usage_events WHERE model_provider=$1 AND model_id=$2 AND call_purpose='native-asr' AND request_started_at>now()-interval '30 minutes' GROUP BY outcome,native_source ORDER BY outcome,native_source",[e.KERNEL_ASR_PROVIDER,e.KERNEL_ASR_MODEL])).rows;
 await client.query('COMMIT');Object.assign(out,row,{tariffQueryAvailable:true,millisecondTariffs:millisecondTariffs.map(r=>({...r,model_provider:label(r.model_provider),model_id:label(r.model_id)}))});
}catch(error){out.databaseProbeCode=['42501','42P01','28P01','ECONNREFUSED','ETIMEDOUT','ENOTFOUND'].includes(error?.code)?error.code:'database_probe_unavailable';}
finally{client?.release();await pool?.end();}
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

def runtime_configuration(values):
    label=lambda v:v if isinstance(v,str)and re.fullmatch(r'[A-Za-z0-9._:/-]{1,160}',v)else 'unavailable'
    region='unverified'
    try:
        url=urlsplit(values.get('KERNEL_ASR_BASE_URL',''))
        if url.scheme=='wss'and not url.username and not url.password and url.port is None:
            region={'dashscope.aliyuncs.com':'cn-beijing','dashscope-intl.aliyuncs.com':'sg-international'}.get(url.hostname,'unverified')
    except ValueError:pass
    return {'asrProvider':label(values.get('KERNEL_ASR_PROVIDER')),'asrModel':label(values.get('KERNEL_ASR_MODEL')),'asrRegion':region}

def run():
    target=os.environ.get('ASR_PROBE_TARGET','devapp')
    projects={'devapp':'workspacex-image','cn':'workspacex-cn'}
    if target not in projects:raise ValueError('fixed_probe_target_required')
    ids=call(['docker','ps','--filter','label=com.docker.compose.project='+projects[target],'--format','{{.ID}}']).split()
    if not ids:raise ValueError('devapp_project_unavailable')
    rows=json.loads(call(['docker','inspect',*ids]))
    apis=[r for r in rows if r.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')=='api'and r.get('State',{}).get('Running')is True]
    if len(apis)!=1:raise ValueError('unique_devapp_api_unavailable')
    api=apis[0];ae=env(api)
    report=json.loads(call(['docker','exec','-i',api['Id'],'node','--input-type=module'],STORAGE))
    report.update(runtime_configuration(ae));report['target']=target
    report['receiptDirectoryPersistentRwMount']=persistent_mount(api,ae.get('WORKSPACEX_CREDIT_RECEIPT_DIR'))
    report['tariffQueryAvailable']=False
    # Aggregate ONLY fixed internal diagnostic tokens; raw logs never leave this process.
    reasons=('credit_receipt_store_unavailable','credit_native_tariff_missing','credit_payer_provenance_missing','team_license_accounting_unavailable','ASR_USAGE_TERMINAL_FAILED','ASR_ACCOUNTING_REPAIR_REQUIRED','CREDIT_ACCOUNTING_UNAVAILABLE')
    try:
        logs=subprocess.run(['docker','logs','--since','30m','--tail','2000',api['Id']],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20,check=False)
        report['recentErrorCounts']={r:(logs.stdout+logs.stderr).count(r)for r in reasons}
        report['recentLogsReadAvailable']=logs.returncode==0
    except Exception:report['recentLogsReadAvailable']=False
    try:
        report.update(json.loads(call(['docker','exec','-i',api['Id'],'node','--import','tsx','--input-type=module'],DATABASE)))
    except Exception:report['databaseProbeCode']='database_probe_unavailable'
    # Local owner fallback only when network aliases AND DB name match this actual API.
    dbids=call(['docker','ps','--filter','label=com.docker.compose.service=postgres','--format','{{.ID}}']).split()
    if dbids:rows=json.loads(call(['docker','inspect',*dbids]))
    databases=[]
    for row in rows:
        if row.get('Config',{}).get('Labels',{}).get('com.docker.compose.service')!='postgres':continue
        de=env(row)
        aliases={a for n in row.get('NetworkSettings',{}).get('Networks',{}).values()for a in n.get('Aliases',[])or []}
        aliases.add(row.get('Name','').lstrip('/'))
        if ae.get('PGHOST')in aliases and ae.get('PGDATABASE')==de.get('POSTGRES_DB')and ae.get('PGPORT','5432')=='5432'and set(api.get('NetworkSettings',{}).get('Networks',{}))&set(row.get('NetworkSettings',{}).get('Networks',{})):databases.append(row)
    if not report['tariffQueryAvailable'] and len(databases)==1 and ae.get('KERNEL_ASR_PROVIDER')and ae.get('KERNEL_ASR_MODEL'):
        db=databases[0];de=env(db)
        sql="BEGIN READ ONLY; SET LOCAL row_security=off; SET LOCAL statement_timeout='5000ms'; SELECT json_build_object('matchingTariffs',count(*),'pricedOrganizations',count(DISTINCT org_id)) FROM credit_native_tariffs WHERE model_provider="+literal(ae['KERNEL_ASR_PROVIDER'])+" AND model_id="+literal(ae['KERNEL_ASR_MODEL'])+" AND unit='millisecond'; COMMIT;"
        try:
            raw=call(['docker','exec','-i',db['Id'],'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U',de.get('POSTGRES_USER','postgres'),'-d',ae['PGDATABASE']],sql)
            aggregate=json.loads(raw.strip());report.update(aggregate);report['tariffQueryAvailable']=True
        except Exception:pass
    print(json.dumps(report,sort_keys=True))

if __name__=='__main__':
    try:run()
    except Exception:print(json.dumps({'probeAvailable':False,'reason':'devapp_readonly_probe_unavailable'}));raise SystemExit(1)
