'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {BackupConnection,scramVerifier}=require('./backup_connection.cjs');
function fixture(){
 const session=new BackupConnection(()=>{throw Error('no connection allowed');});
 const binding={role:'migration_admin',peer:{database:'workspacex'}};
 const calls=[];
 session.binding=binding;session.db='workspacex';
 session.host={backup:{authorization:{notBefore:Date.now()/1000-10,expiresAt:Date.now()/1000+100}},statements:{workspacex:{begin:['BEGIN'],commit:['COMMIT'],rollback:['ROLLBACK'],grant:['GRANT SELECT ON TABLE public.t TO wsx_release_backup_ro'],close:['ALTER ROLE wsx_release_backup_ro NOLOGIN']}}};
 session.table={ledger:{sql:'SELECT name FROM public._kernel_migrations',params:[]}};
 session.control={identity:async()=>binding,client:{query:async(sql,params)=>{calls.push({sql,params});return {rows:[],fields:[]};}}};
 return {session,calls};
}
test('fixed query refuses caller SQL and unknown query IDs before database use',async()=>{
 for(const message of [{operation:'query',queryId:'ledger',sql:'DROP DATABASE workspacex'},{operation:'query',queryId:'arbitrary'}]){
  const f=fixture();await assert.rejects(f.session.handle({...message,sequence:1}));assert.equal(f.calls.length,0);
 }
});
test('fixed mutations reject overridden SQL and out of range statement',async()=>{
 for(const message of [{operation:'mutation',action:'grant',statement:0,sql:'DROP ROLE app'},{operation:'mutation',action:'grant',statement:99}]){
  const f=fixture();await assert.rejects(f.session.handle({...message,sequence:1}));assert.equal(f.calls.length,0);
 }
});
test('expired lease cannot commit pending grant; rollback remains possible',async()=>{
 const f=fixture();await f.session.handle({sequence:1,operation:'mutation',action:'begin',statement:0});
 await f.session.handle({sequence:2,operation:'mutation',action:'grant',statement:0});
 f.session.host.backup.authorization.expiresAt=Date.now()/1000-1;
 await assert.rejects(f.session.handle({sequence:3,operation:'mutation',action:'commit',statement:0}));
 assert.equal(f.calls.some(c=>c.sql==='COMMIT'),false);
 await f.session.handle({sequence:4,operation:'mutation',action:'rollback',statement:0});
 assert.equal(f.calls.at(-1).sql,'ROLLBACK');
});
test('SCRAM verifier contains no plaintext password and rejects unsafe input',()=>{
 const password='A'.repeat(48),value=scramVerifier(password,Buffer.alloc(16,1));
 assert.match(value,/^SCRAM-SHA-256\$4096:/);assert.equal(value.includes(password),false);
 assert.throws(()=>scramVerifier("password'; DROP ROLE app;"));
});
test('cleanup-only channel rejects create grant login before querying',async()=>{
 for(const action of ['create','grant','login']){const f=fixture();f.session.cleanupOnly=true;
  await assert.rejects(f.session.handle({sequence:1,operation:'mutation',action,statement:0,password:'A'.repeat(48)}),/CLEANUP_ONLY/);
  assert.equal(f.calls.length,0);
 }
});
test('approval path full keys functions and PUBLIC TEMP scope are exact before connection',async()=>{
 const crypto=require('node:crypto'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
 for(const defect of ['path','extra-key','functions','role-temp','duplicate-temp']){
  const now=Date.now()/1000,identity={sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'fixture'};
  const a={identity,action:'bounded-three-db-backup-read',notBefore:now-10,expiresAt:now+100,rdsInstanceId:'pgm-uf6rg214cp381l49',ecsInstanceId:'i-uf6ga92ewloganobbln6'};
  const record={schemaVersion:1,role:'wsx_release_backup_ro',functions:{fixed:'b'.repeat(64)},allowedPublicTemp:[],...a};
  if(defect==='extra-key')record.arbitrary=true;
  if(defect==='functions')record.functions={foreign:'b'.repeat(64)};
  if(defect==='role-temp')record.allowedPublicTemp=['workspacex'];
  if(defect==='duplicate-temp')record.allowedPublicTemp=['workspacex','workspacex'];
  const approval=Buffer.from(JSON.stringify(record)),ref={path:'/etc/workspacex-cn/backup-approvals/fixture/role.json',sha256:sha(approval)};
  if(defect==='path')ref.path='/etc/workspacex-cn/backup-approvals/other/role.json';
  a.roleApprovalSha256=ref.sha256;
  const host={identity,backup:{identity,authorization:a,toolRevision:'c'.repeat(40),functionBodies:{fixed:'b'.repeat(64)}},roleApproval:ref};
  const path='/etc/workspacex-cn/maintenance-backup/'+identity.sourceRevision+'/fixture/host-plan.json',raw=Buffer.from(JSON.stringify(host)),hash=sha(raw);
  const profile={toolRevision:host.backup.toolRevision,backupHostPlan:{path,sha256:hash}};
  let connected=false;
  const s=new BackupConnection(()=>{connected=true;throw Error('unexpected connection');},()=>profile,p=>p===path?raw:approval);
  await assert.rejects(s.connect(path,hash,'workspacex'),/APPROVAL_(PATH|SCOPE)/);assert.equal(connected,false);
 }
});
