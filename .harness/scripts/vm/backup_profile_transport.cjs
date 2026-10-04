'use strict';
// Fixed read-only canonical provider verifier. No SQL or credential access.
const crypto=require('node:crypto');
const {trustedBytes}=require('./control_connection.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const need=(v,c)=>{if(!v)throw Error(c);};
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
function verify(host,configurationBytes,library){
 const p=host.backup,env=JSON.parse(configurationBytes).environment,now=Date.now()/1000;
 need(sha(configurationBytes)===p.configurationSha256&&env.profile==='production'&&env.ecsInstanceId==='i-uf6ga92ewloganobbln6'&&env.rdsInstanceId==='pgm-uf6rg214cp381l49','BACKUP_PROFILE_CONFIGURATION');
 need(typeof library.approveExistingMaintenanceTransportInputs==='function','BACKUP_CANONICAL_LIBRARY');
 const proofs={};
 for(const db of ['workspacex','workspacex_agent','workspacex_memory']){
  const a=host.connection.transport[db];
  need(a.kind==='existing-production-maintenance-transport'&&a.schemaVersion===1&&JSON.stringify(canonical(a.identity))===JSON.stringify(canonical(p.identity))&&a.toolRevision===p.toolRevision&&a.source.database===db&&a.source.user==='migration_admin'&&a.source.configurationSha256===p.configurationSha256&&a.notBefore<=now&&now-a.notBefore<=300&&now<a.expiresAt&&a.expiresAt-a.notBefore<=3600,'BACKUP_PROFILE_PROVIDER_FRESH_BINDING');
  const endpoint=library.approveExistingMaintenanceTransportInputs(a);
  need(endpoint.privateAddress==='192.168.100.44'&&a.source.providerEvidenceSha256,'BACKUP_PROFILE_PROVIDER_ENDPOINT');
  proofs[db]=a.source.providerEvidenceSha256;
 }
 return {kind:'canonical-existing-transport-verified',identity:p.identity,configurationSha256:p.configurationSha256,providerEvidenceSha256:sha(JSON.stringify(canonical(proofs)))};
}
function main(){
 need(process.getuid()===0&&process.platform==='linux'&&process.argv.length===5&&process.argv[2]==='--protected-backup-profile','BACKUP_PROFILE_ENTRY');
 const raw=trustedBytes(process.argv[3],0o600);need(sha(raw)===process.argv[4],'BACKUP_PROFILE_HOST_PIN');const h=JSON.parse(raw);
 const profile=JSON.parse(trustedBytes('/etc/workspacex-cn/trusted-tool-binding.json',0o600));
 const self='/usr/local/lib/workspacex-cn/backup_profile_transport.cjs',libraryPath='/usr/local/lib/workspacex-cn/cn-maintenance-migrator.cjs';
 need(profile.toolRevision===h.backup.toolRevision&&sha(trustedBytes(self,0o700))===profile.installedFilesSha256[self],'BACKUP_PROFILE_VERIFIER_PIN');
 const first=h.connection.transport.workspacex;
 need(sha(trustedBytes(libraryPath,0o700))===profile.installedFilesSha256[libraryPath]&&first.librarySha256===profile.installedFilesSha256[libraryPath],'BACKUP_PROFILE_LIBRARY_PIN');
 const configuration=trustedBytes(first.configurationPath,0o600);
 process.stdout.write(JSON.stringify(verify(h,configuration,require(libraryPath)))+'\n');
}
module.exports={verify};
if(require.main===module){try{main();}catch{process.stderr.write('BACKUP_PROFILE_TRANSPORT_REJECTED\n');process.exitCode=1;}}
