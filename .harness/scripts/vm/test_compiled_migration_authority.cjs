'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),crypto=require('node:crypto');
const {createRequire,Module}=require('node:module');
const root=path.resolve(__dirname,'../../..');
const esbuild=require(createRequire(require.resolve('tsx')).resolve('esbuild'));
test('actual compiled migrator shares issued authority and refuses forged/drifted inputs',()=>{
 const output=esbuild.buildSync({entryPoints:[path.join(root,'packages/cloud-deploy/src/cn-maintenance-host/migration_library.ts')],bundle:true,write:false,minify:true,platform:'node',format:'cjs',target:'node20',absWorkingDir:root});
 const mod=new Module(path.join(root,'compiled-migrator-fixture.cjs'),module);mod.filename=path.join(root,'compiled-migrator-fixture.cjs');mod.paths=module.paths;mod._compile(Buffer.from(output.outputFiles[0].contents).toString(),mod.filename);
 const library=mod.exports,sourceRevision='a1cb4c7683768566b0cf38ffe6a27b0a8c13f4f0',tool='c'.repeat(40),pin='d'.repeat(64);
 const identity={sourceRevision,baselineRevision:'ba6343199f3c834d6a198f83d0c771614292c82b',migrationPlanSha256:'a'.repeat(64),attemptId:'compiled-bridge'};
 const source={schemaVersion:1,mode:'maintenance-all-writer-fence',productionActionsAuthorized:true,runtimeSessionBootstrapAuthorized:true,identity,toolRevision:tool};let raw=Buffer.from(JSON.stringify(source)+'\n');
 const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const hold='/usr/local/lib/workspacex-cn/cn_maintenance_hold.py',fence='/usr/local/lib/workspacex-cn/host_transport.py',sourcePath='.harness/scripts/vm/maintenance_source_operations.py';
 const host={identity,writerPlanPath:'/etc/workspacex-cn/compiled-writer-plan.json',writerPlanSha256:hash(raw),writerPlanCanonicalSha256:hash(canonical(source)),hold:{path:hold,sha256:pin},writerFence:{path:fence,sha256:pin}};
 const profile={toolRevision:tool,originalWriterPlan:{path:host.writerPlanPath,sha256:host.writerPlanSha256},maintenanceSourceOperations:{schemaVersion:1,sourcePath,sha256:pin},filesSha256:{[sourcePath]:pin},installedFilesSha256:{[hold]:pin,[fence]:pin,'/usr/local/lib/workspacex-cn/maintenance_source_operations.py':pin}};
 const authority=library.readOriginalPlanAuthority(host,tool,profile,p=>p==='/etc/workspacex-cn/trusted-tool-binding.json'?Buffer.from(JSON.stringify(profile)):raw),dir=`/var/lib/workspacex-cn/releases/${sourceRevision}/apps/api/migrations`;
 library.verifyExistingMigrationAuthority(authority,dir);assert.throws(()=>library.verifyExistingMigrationAuthority({...authority},dir));assert.throws(()=>library.verifyExistingMigrationAuthority(authority,'/tmp/untrusted/apps/api/migrations'));raw=Buffer.from('{}');assert.throws(()=>library.verifyExistingMigrationAuthority(authority,dir));
});
