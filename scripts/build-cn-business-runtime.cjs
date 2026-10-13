#!/usr/bin/env node
'use strict';
// Offline bundle materializer. No downloads, installation, chmod outside output.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
async function build(output,playwright){
 if(fs.existsSync(output))throw Error('OUTPUT_EXISTS');
 const pw=fs.realpathSync(playwright),core=fs.realpathSync(require.resolve('playwright-core/package.json',{paths:[pw]}));
 fs.mkdirSync(output,{mode:0o700});
 const copy=(source,dest)=>{const stat=fs.lstatSync(source);if(stat.isSymbolicLink())throw Error('SOURCE_SYMLINK');if(stat.isDirectory()){fs.mkdirSync(dest,{recursive:true,mode:0o700});for(const n of fs.readdirSync(source))copy(path.join(source,n),path.join(dest,n));}else if(stat.isFile()){fs.mkdirSync(path.dirname(dest),{recursive:true,mode:0o700});fs.writeFileSync(dest,fs.readFileSync(source),{flag:'wx',mode:0o600});}else throw Error('SOURCE_SPECIAL_FILE');};
 copy(pw,path.join(output,'node_modules/playwright'));copy(path.dirname(core),path.join(output,'node_modules/playwright-core'));
 const canonical='.harness/scripts/vm/cn-maintenance-browser.cjs';copy(path.join(root,canonical),path.join(output,canonical));
 const esbuild=require(require('node:module').createRequire(require.resolve('tsx')).resolve('esbuild'));
 await esbuild.build({absWorkingDir:root,entryPoints:['scripts/cn-release-business-entry.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:path.join(output,'scripts/cn-release-business-entry.mjs'),logLevel:'silent'});
 fs.chmodSync(path.join(output,'scripts/cn-release-business-entry.mjs'),0o600);
 const files={};function scan(dir){for(const n of fs.readdirSync(dir).sort()){const file=path.join(dir,n);if(fs.statSync(file).isDirectory())scan(file);else files[path.relative(output,file)]=hash(fs.readFileSync(file));}}scan(output);
 const sourcePins={};for(const name of ['scripts/cn-release-business-entry.ts','scripts/cn-release-business-runner.ts',canonical,'packages/cloud-deploy/src/cn-release-browser-contract.ts','packages/cloud-deploy/src/cn-maintenance-host/acceptance_contract.ts'])sourcePins[name]=hash(fs.readFileSync(path.join(root,name)));
 const result={kind:'cn-business-runtime-build-v1',entryRelative:'scripts/cn-release-business-entry.mjs',playwrightRelative:'node_modules/playwright',filesSha256:files,sourcePins,installationPerformed:false};
 // Manifest is outside the runtime tree so exact closure has no self-reference.
 fs.writeFileSync(output+'.manifest.json',JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600});return result;
}
module.exports={build};
if(require.main===module){if(process.argv.length!==4)throw Error('EXPECTED_OUTPUT_AND_LOCAL_PLAYWRIGHT');build(path.resolve(process.argv[2]),path.resolve(process.argv[3])).then(x=>process.stdout.write(JSON.stringify({files:Object.keys(x.filesSha256).length,installationPerformed:false})+'\n')).catch(()=>{process.stderr.write('BUSINESS_RUNTIME_BUILD_FAILED\n');process.exitCode=1;});}
