import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

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
  assert(manifestPath,'Explicit candidate runtime manifest required');
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const canonical=realpathSync(root);
  assert.equal(realpathSync(manifest.webRoot),canonical);
  assert.equal(realpathSync(manifest.apiRoot),canonical);
  assert.equal(new URL(manifest.webBase).origin,new URL(base).origin);
  assert.equal(new URL(manifest.apiBase).origin,new URL(origin).origin);
  assert.equal(manifest.head,execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim());
  assert.deepEqual(manifest.sourceHashes,runtimeSourceHashes(root, sourceFiles),'runtime startup source must match current candidate');
  assert.deepEqual(manifest.sourceHashes,committedRuntimeSourceHashes(root,manifest.head,sourceFiles),'runtime source must match exact attested commit, not matching dirty source');
  for(const kind of ['web','api']) {
    const process=manifest.processes.find(item=>item.kind===kind);
    assert(process&&Number.isInteger(process.pid)&&process.pid>0,'runtime child pid required');
    const cwd=execFileSync('lsof',['-a','-p',String(process.pid),'-d','cwd','-Fn'],{encoding:'utf8'}).split('\n').find(line=>line.startsWith('n'))?.slice(1);
    assert(cwd,'runtime process must still exist');
    assert.equal(realpathSync(cwd),realpathSync(process.cwd));
    assert(realpathSync(cwd).startsWith(canonical+'/'),'runtime must execute within candidate');
    const url=new URL(kind==='web'?base:origin),port=url.port|| (url.protocol==='https:'?'443':'80');
    const listeners=execFileSync('lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8'}).trim().split('\n').map(Number);
    const parentOf=pid=>Number(execFileSync('ps',['-o','ppid=','-p',String(pid)],{encoding:'utf8'}).trim());
    assert(listeners.length>0&&listeners.every(pid=>descendsFrom(pid,process.pid,parentOf)),`${kind} listener must belong to attested service process`);
  }
  return {head:manifest.head,webRoot:canonical,apiRoot:canonical,processes:manifest.processes,sourceHashes:manifest.sourceHashes};
}
