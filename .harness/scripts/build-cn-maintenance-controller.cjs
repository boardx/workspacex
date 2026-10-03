#!/usr/bin/env node
// Build-time dependency only. Runtime artifacts contain source-owned consumers.
const path=require('node:path'),fs=require('node:fs');
const {createRequire}=require('node:module');
const esbuild=require(createRequire(require.resolve('tsx')).resolve('esbuild'));
const root=path.resolve(__dirname,'../..');
const check=process.argv.slice(2).join(' ')==='--check';
if(process.argv.length>2&&!check)throw Error('BUILD_USAGE');
function build(source,target,banner){
 const artifact=path.join(root,target);
 const result=esbuild.buildSync({entryPoints:[path.join(root,source)],outfile:artifact,write:false,bundle:true,absWorkingDir:root,minify:true,platform:'node',format:'cjs',target:'node20',legalComments:'none',banner:{js:banner}});
 const bytes=result.outputFiles[0].contents;
 if(check){if(!fs.existsSync(artifact)||!Buffer.from(bytes).equals(fs.readFileSync(artifact)))throw Error('COMMITTED_TOOL_BUNDLE_DRIFT:'+target);}
 else fs.writeFileSync(artifact,bytes);
}
build('packages/cloud-deploy/src/cn-maintenance-host/entry.ts','.harness/scripts/vm/cn-maintenance-host-controller.cjs','// Generated from packages/cloud-deploy/src/cn-maintenance-host/entry.ts. Source-bound tool artifact; READY=false.');
build('packages/cloud-deploy/src/cn-maintenance-host/migration_snapshot_query.ts','.harness/scripts/vm/cn-migration-snapshot-query.cjs','// Generated readonly migration snapshot producer. Source-bound tool artifact; READY=false.');

build('packages/cloud-deploy/src/cn-maintenance-host/migration_library.ts','.harness/scripts/vm/cn-maintenance-migrator.cjs','// Generated fixed 9b25 migrator using an existing sealed control session. READY=false.');
