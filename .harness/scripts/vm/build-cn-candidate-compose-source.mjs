#!/usr/bin/env node
// Local source compilation only. No installation, Docker, network or host changes.
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const output=process.argv[2];
if(process.argv.length!==3||!isAbsolute(output)||!output.endsWith('.cjs'))throw Error('CANDIDATE_COMPOSE_BUILD_USAGE');
const frozen={
 'packages/cloud-deploy/src/compose.ts':'d9dc2c92e756009e1c8ce0f5bfcc97fb5344a982',
 'packages/cloud-deploy/src/config.ts':'557e16d925acd1d564c05d3ed33cfcf1542947b8',
 'packages/cloud-deploy/src/storage-config.ts':'648f2e64f8fba8bdeb6f3b10bd4a6c30a1239aa3',
 'packages/cloud-deploy/src/release.ts':'e3961929b341788378d8225c1433ea64039fdef8',
 'packages/cloud-deploy/src/image-reference.ts':'ee0dc00425423728d820360869cf8401890d0ad0',
 'packages/cloud-deploy/src/runtime-bundle.ts':'17cfea0b613b86a8c53edaa37d80ae6788ae6bbe',
};
const sources={};
for(const [path,blob]of Object.entries(frozen)){
 const raw=readFileSync(resolve(root,path));
 const actual=createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
 if(actual!==blob)throw Error('CANDIDATE_COMPOSE_FROZEN_SOURCE_DRIFT');
 sources[path]={gitBlob:blob,sha256:createHash('sha256').update(raw).digest('hex')};
}
const entry='packages/cloud-deploy/src/cn-candidate-compose-source-cli.ts';
const local=['packages/cloud-deploy/src/cn-candidate-compose-source.ts',entry,'.harness/scripts/vm/build-cn-candidate-compose-source.mjs'];
for(const path of local)sources[path]={sha256:createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex')};
// Reuse the frozen workspace's existing desktop esbuild dependency, never download.
const require=createRequire(resolve(root,'apps/desktop/package.json'));
const esbuild=require('esbuild');
if(esbuild.version!=='0.24.2')throw Error('CANDIDATE_COMPOSE_COMPILER_VERSION');
const result=await esbuild.build({absWorkingDir:root,entryPoints:[entry],bundle:true,platform:'node',format:'cjs',
 target:'node22',outfile:output,write:false,metafile:true,logLevel:'silent'});
for(const path of Object.keys(result.metafile.inputs))if(!path.startsWith('node_modules/') && !sources[path])throw Error('CANDIDATE_COMPOSE_UNPINNED_SOURCE');
const dependencies={};
for(const path of Object.keys(result.metafile.inputs))if(path.startsWith('node_modules/'))dependencies[path]=createHash('sha256').update(readFileSync(resolve(root,path))).digest('hex');
const raw=result.outputFiles[0].contents;
const closure={schemaVersion:1,sourceRevision:'9b25bfa65662b96c0826fe67506b562ea46aa6d0',compiler:{name:'esbuild',version:esbuild.version},
 sources,dependencies,lockfileSha256:createHash('sha256').update(readFileSync(resolve(root,'pnpm-lock.yaml'))).digest('hex'),bundleSha256:createHash('sha256').update(raw).digest('hex'),bundledInputs:Object.keys(result.metafile.inputs).sort()};
// Create-once local output. Root installation/profile binding is a separate reviewed action.
writeFileSync(output,raw,{flag:'wx',mode:0o600});
writeFileSync(output+'.source-closure.json',JSON.stringify(closure,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({bundleSha256:closure.bundleSha256,sourceClosure:output+'.source-closure.json'}));
