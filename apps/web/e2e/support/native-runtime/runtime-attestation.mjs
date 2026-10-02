import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync,existsSync,readlinkSync } from 'node:fs';
import { join,resolve,relative,isAbsolute,dirname,basename } from 'node:path';
import {tmpdir} from 'node:os';
import {identityOperation} from './native-startup-receipt.mjs';

export function listRuntimeSourceFiles(root) {
  const tracked=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const rootFiles=['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','turbo.json','.nvmrc','scripts/local-session/board-acceptance-runtime.mjs'];
  return tracked.filter(path=>/^(apps\/(?:api|web)\/|packages\/)/.test(path)||rootFiles.includes(path)).sort();
}

export function assertRuntimeSourceFiles(root,sourceFiles) {
  assert(Array.isArray(sourceFiles)&&sourceFiles.every(path=>typeof path==='string'),'runtime source files must be explicit paths');
  assert.equal(new Set(sourceFiles).size,sourceFiles.length,'duplicate runtime source file');
  assert.deepEqual([...sourceFiles].sort(),listRuntimeSourceFiles(root),'complete tracked runtime source closure required');
}

export function assertTemporaryRuntimePaths(root,data) {
  const physical=path=>{let ancestor=resolve(path);const suffix=[];while(!existsSync(ancestor)){suffix.unshift(basename(ancestor));ancestor=dirname(ancestor);}return join(realpathSync(ancestor),...suffix);};
  const within=(parent,path)=>{const difference=relative(physical(parent),physical(path));return difference!==''&&!difference.startsWith('..')&&!isAbsolute(difference);};
  const temporaryRoots=[realpathSync(tmpdir()),'/private/tmp'];
  assert(temporaryRoots.some(parent=>within(parent,root)),'candidate must be under an isolated temporary root');
  assert(temporaryRoots.some(parent=>within(parent,data)),'runtime data must be under an isolated temporary root');
  assert(!within(root,data)&&physical(root)!==physical(data),'runtime data must be outside candidate source');
}

export function nativeAcceptanceOptions(plan) {
  const proxyPort=plan.proxyWebSocketPort;
  if(proxyPort!==undefined){
    assert(Number.isInteger(proxyPort)&&proxyPort>=1024&&proxyPort<=65535,'valid loopback proxy port required');
    assert(!Object.values(plan.ports).includes(proxyPort),'proxy must not reuse a runtime service port');
  }
  const storagePath='apps/web/e2e/support/file-storage-runtime.mjs';
  if(plan.fileStorageAttestation===true)assert(/^[a-f0-9]{64}$/.test(plan.sourceHashes?.[storagePath]??''),'storage adapter must belong to attested source closure');
  else assert(plan.fileStorageAttestation===undefined||plan.fileStorageAttestation===false,'explicit boolean storage attestation required');
  return {webSocketUrl:proxyPort===undefined?undefined:`ws://127.0.0.1:${proxyPort}`,storagePath:plan.fileStorageAttestation===true?storagePath:undefined};
}

export function runtimeSourceHashes(root, sourceFiles) {
  return Object.fromEntries(sourceFiles.map(path => [path,createHash('sha256').update(readFileSync(join(root,path))).digest('hex')]));
}

export function committedRuntimeSourceHashes(root, head, sourceFiles) {
  return Object.fromEntries(sourceFiles.map(path => {
    let bytes;
    try { bytes = execFileSync('git', ['show', `${head}:${path}`], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024 }); }
    catch { assert.fail(`runtime source must exist in attested commit: ${path}`); }
    return [path, createHash('sha256').update(bytes).digest('hex')];
  }));
}

export function savedSequence(label) {
  const match=/^已同步(?: · 序列 (\d+))?$/.exec(label??'');
  return match ? Number(match[1]??0) : null;
}

export function descendsFrom(pid,ancestor,parentOf) {
  const visited=new Set();
  while(Number.isInteger(pid)&&pid>1&&!visited.has(pid)) {
    if(pid===ancestor)return true;
    visited.add(pid);pid=parentOf(pid);
  }
  return false;
}

export function verifyRuntimeManifest({manifestPath,root,base,origin,sourceFiles}) {
  return identityOperation('IDENTITY_SOURCE',()=>verifyRuntimeIdentity({manifestPath,root,base,origin,sourceFiles}));
}

export function runtimeProcessCwd(pid,{platform=globalThis.process.platform,readlink=readlinkSync,exec=execFileSync}={}) {
  assert(Number.isInteger(pid)&&pid>0,'runtime child pid required');
  if(platform==='linux')return readlink(`/proc/${pid}/cwd`);
  return exec('lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'}).split('\n').find(line=>line.startsWith('n'))?.slice(1);
}

function verifyRuntimeIdentity({manifestPath,root,base,origin,sourceFiles}) {
  assert(manifestPath,'Explicit candidate runtime manifest required');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const canonical=realpathSync(root);
  assertRuntimeSourceFiles(canonical,sourceFiles);
  assert.deepEqual([...manifest.sourceFiles].sort(),[...sourceFiles].sort(),'startup manifest must contain full runtime closure');
  assert.equal(new Set(manifest.sourceFiles).size,manifest.sourceFiles.length,'duplicate startup source file');
  assert.deepEqual(Object.keys(manifest.sourceHashes).sort(),[...sourceFiles].sort(),'startup source hashes must cover exact runtime closure');
  assert.equal(realpathSync(manifest.webRoot),canonical);
  assert.equal(realpathSync(manifest.apiRoot),canonical);
  assert.equal(new URL(manifest.webBase).origin,new URL(base).origin);
  assert.equal(new URL(manifest.apiBase).origin,new URL(origin).origin);
  assert.equal(manifest.head,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
  assert.deepEqual(manifest.sourceHashes,runtimeSourceHashes(root, sourceFiles),'runtime startup source must match current candidate');
  assert.deepEqual(manifest.sourceHashes,committedRuntimeSourceHashes(root,manifest.head,sourceFiles),'runtime source must match exact attested commit, not matching dirty source');
  for(const kind of ['web','api']) {
    const process=manifest.processes.find(item=>item.kind===kind);
    const identityCwd={service:kind,pidAlive:null,commandExit:null,pathPresent:false,pathEqual:false,childExitCode:null,childSignal:null};
    identityOperation('IDENTITY_CWD',()=>{
    assert(process&&Number.isInteger(process.pid)&&process.pid>0,'runtime child pid required');
    try{globalThis.process.kill(process.pid,0);identityCwd.pidAlive=true;}catch(error){if(error.code==='ESRCH')identityCwd.pidAlive=false;}
    let cwd;
    try{cwd=runtimeProcessCwd(process.pid);if(globalThis.process.platform!=='linux')identityCwd.commandExit=0;}
    catch(error){if(globalThis.process.platform!=='linux')identityCwd.commandExit=Number.isInteger(error.status)&&error.status>=-1&&error.status<=255?error.status:-1;throw error;}
    identityCwd.pathPresent=Boolean(cwd);
    assert(cwd,'runtime process must still exist');
    identityCwd.pathEqual=realpathSync(cwd)===realpathSync(process.cwd);
    assert.equal(realpathSync(cwd),realpathSync(process.cwd));
    assert(realpathSync(cwd).startsWith(canonical+'/'),'runtime must execute within candidate');
    },identityCwd);
    const url=new URL(kind==='web'?base:origin),port=url.port|| (url.protocol==='https:'?'443':'80');
    identityOperation('IDENTITY_LISTENER',()=>{
    const listeners=execFileSync('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim().split('\n').map(Number);
    const parentOf=pid=>identityOperation('IDENTITY_ANCESTRY',()=>Number(execFileSync('ps',['-o','ppid=','-p',String(pid)],{encoding:'utf8'}).trim()));
    assert(listeners.length>0&&listeners.every(pid=>descendsFrom(pid,process.pid,parentOf)),`${kind} listener must belong to attested service process`);
    });
  }
  return {head:manifest.head,webRoot:canonical,apiRoot:canonical,processes:manifest.processes,sourceHashes:manifest.sourceHashes};
}
