set -eu
/usr/bin/python3 -I -S -B <<'PIN_ENV'
import os,stat,hashlib
p='/var/lib/workspacex-cn/runtime/a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0-newdb-20261006/migration.env'
f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
with os.fdopen(f,'rb') as s:
 st=os.fstat(s.fileno());assert stat.S_ISREG(st.st_mode) and st.st_uid==st.st_gid==0 and stat.S_IMODE(st.st_mode)==0o600
 assert hashlib.sha256(s.read()).hexdigest()=='d0199bc4e0674ea70348832b4fd82fe2be695253bcbc2ae0447eb45094510773'
PIN_ENV
if ! /usr/bin/docker --host unix:///run/docker.sock run --rm -i --pull=never --read-only --tmpfs /tmp:rw,nosuid,nodev,size=16m,mode=1777 --network=host --env-file /var/lib/workspacex-cn/runtime/a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0-newdb-20261006/migration.env --mount type=bind,src=/var/lib/workspacex-cn/runtime/ba6343199f3c834d6a198f83d0c771614292c82b/certs,dst=/run/certs,readonly --workdir /opt/workspacex/apps/api --entrypoint node workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod/api@sha256:4d05393c401858eb443707ee0386a6f7561ceeadaa62ed51be1caea621f7ecff --import tsx --input-type=module 2>/dev/null <<'OWNER_READONLY'
import pg from 'pg';import {migrationConfig} from './src/infrastructure/db/pg-config.ts';
const cfg=migrationConfig();if(cfg.database!=='workspacex_a1cb_20261006')throw Error('DATABASE_BINDING');
const c=new pg.Client({...cfg,options:'-c default_transaction_read_only=on',statement_timeout:5000});
try{await c.connect();await c.query('BEGIN READ ONLY');const {rows:[role]}=await c.query(`SELECT current_user actor,current_setting('transaction_read_only') readonly,rolsuper superuser,pg_has_role(current_user,'pg_read_all_stats','MEMBER') fullStatsMember FROM pg_roles WHERE rolname=current_user`);const {rows}=await c.query(`SELECT datname database,usename actor,coalesce(backend_type,'unknown') backend_type,coalesce(state,'hidden') state,count(*)::int count FROM pg_stat_activity WHERE datname IN ('workspacex_a1cb_20261006','workspacex_agent_a1cb_20261006','workspacex_memory_a1cb_20261006') AND pid<>pg_backend_pid() GROUP BY datname,usename,backend_type,state ORDER BY 1,2,3,4`);await c.query('ROLLBACK');if(role.readonly!=='on')throw Error('NOT_READONLY');console.log(JSON.stringify({role,databaseSessions:rows,clientSessions:rows.filter(r=>r.backend_type==='client backend').reduce((a,r)=>a+r.count,0),hiddenSessions:rows.filter(r=>r.state==='hidden').reduce((a,r)=>a+r.count,0),ddlExecuted:false,permissionsChanged:false}));}catch{await c.query('ROLLBACK').catch(()=>{});console.log(JSON.stringify({ok:false,code:'EXISTING_MIGRATION_ROLE_READ_FAILED'}));process.exitCode=1;}finally{await c.end().catch(()=>{});}

OWNER_READONLY
then
 printf '%s\n' '{"ok":false,"code":"EXISTING_MIGRATION_ROLE_PROBE_FAILED"}'
 exit 1
fi
