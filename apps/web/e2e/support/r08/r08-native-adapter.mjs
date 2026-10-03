import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {lstat,readFile,writeFile,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {fixedUpstream} from './wsx-r08-proxy-policy.mjs';

const modules=['wsx-r08-owned-proxy-bridge.mjs','wsx-r08-fault-proxy.mjs','wsx-r08-proxy-policy.mjs'];

async function assertPrivatePath(path,directory=false){
 const stat=await lstat(path);
 assert(!stat.isSymbolicLink()&&(directory?stat.isDirectory():stat.isFile())&&stat.uid===process.getuid()&&(stat.mode&0o777)===(directory?0o700:0o600),'PRIVATE_R08_PATH_REQUIRED');
 assert.equal(await realpath(path),resolve(path));
}

export function prepareArguments({proxyPort}){
 assert(Number.isInteger(proxyPort)&&proxyPort>=1024&&proxyPort<=65535,'INVALID_R08_PROXY_PORT');
 return ['--proxy-ws-port',String(proxyPort)];
}

export function assertPlanBinding(plan,manifest,root){
 assert.equal(plan.prepared,true);
 assert.equal(manifest.ready,true);
 assert.equal(resolve(plan.root),resolve(root));
 assert.equal(resolve(manifest.webRoot),resolve(root));
 assert.equal(resolve(manifest.apiRoot),resolve(root));
 assert.equal(plan.head,manifest.head);
 assert.equal(fixedUpstream(plan),manifest.apiBase);
 assert.equal(manifest.proxyWebSocketUrl,`ws://127.0.0.1:${plan.proxyWebSocketPort}`);
 prepareArguments({proxyPort:plan.proxyWebSocketPort});
}

// The shared producer remains the sole source/PID/listener authority.
export async function prepareEnvironment({root,privateRoot,planPath,manifestPath}){
 await assertPrivatePath(privateRoot,true);
 await assertPrivatePath(planPath);
 await assertPrivatePath(manifestPath);
 const authority=await import(pathToFileURL(join(root,'apps/web/e2e/support/native-runtime/runtime-attestation.mjs')).href);
 const plan=JSON.parse(await readFile(planPath,'utf8'));
 const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
 assertPlanBinding(plan,manifest,root);
 await assertPrivatePath(plan.data,true);
 assert.equal(resolve(planPath),join(resolve(plan.data),'native-runtime-plan.json'));
 assert.equal(resolve(manifestPath),join(resolve(plan.data),'runtime-manifest.json'));
 const child=relative(resolve(plan.data),resolve(privateRoot));
 assert(child&&!child.startsWith('..')&&!isAbsolute(child),'R08_DIRECTORY_MUST_BE_OWNED_RUNTIME_CHILD');
 authority.nativeAcceptanceOptions(plan);
 const sourceFiles=authority.listRuntimeSourceFiles(root);
 const verify=()=>authority.verifyRuntimeManifest({manifestPath,root,base:manifest.webBase,origin:manifest.apiBase,sourceFiles});
 verify();
 const sourceHashes=Object.fromEntries(modules.map(name=>{
  const path=`apps/web/e2e/support/r08/${name}`;
  assert.match(manifest.sourceHashes[path],/^[a-f0-9]{64}$/);
  return [name,manifest.sourceHashes[path]];
 }));
 const secret=randomBytes(32).toString('hex');
 const templatePath=join(privateRoot,'r08-proxy-template.json');
 await writeFile(templatePath,JSON.stringify({nativeManifestPath:resolve(planPath),upstream:fixedUpstream(plan),port:plan.proxyWebSocketPort,bearerPrefix:'bearer.',controlSecret:secret}),{mode:0o600,flag:'wx'});
 return {
  proxyPort:plan.proxyWebSocketPort,
  environment:{BOARD_PEER_WEB_URL:manifest.webBase,BOARD_PEER_OUTPUT_DIR:join(privateRoot,'playwright'),BOARD_SYNC_FAULT_PROXY_URL:`http://127.0.0.1:${plan.proxyWebSocketPort}`,BOARD_SYNC_FAULT_CONTROL_SECRET:secret,BOARD_SYNC_FAULT_TEMPLATE_PATH:templatePath,BOARD_SYNC_FAULT_BRIDGE_PATH:join(root,'apps/web/e2e/support/r08',modules[0]),BOARD_SYNC_FAULT_BRIDGE_SHA:sourceHashes[modules[0]],BOARD_SYNC_FAULT_SOURCE_HASHES:JSON.stringify(sourceHashes)},
  verifyEnd:verify,
 };
}
