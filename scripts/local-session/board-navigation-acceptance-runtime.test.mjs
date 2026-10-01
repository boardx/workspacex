import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { dirname,join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { savedSequence, descendsFrom } from './board-acceptance-runtime.mjs';
import { verifyNavigationRuntime as verifyRuntimeManifest, sourceFiles, navigationSourceHashes as runtimeSourceHashes } from './board-navigation-acceptance-runtime.mjs';

test('ACK accepts canonical sync labels but not pending or offline', () => {
  assert.equal(savedSequence('已同步'),0);
  assert.equal(savedSequence('已同步 · 序列 32'),32);
  for(const label of ['已同步但待确认','1 项修改等待服务器确认','连接中断 · 第 1 次重连',null]) {
    assert.equal(savedSequence(label),null);
  }
});

test('runtime attestation cannot be omitted', () => {
  assert.throws(()=>verifyRuntimeManifest({root:'.',base:'http://localhost:1',origin:'http://localhost:2'}),/runtime manifest required/);
});

test('unrelated or cyclic listener ancestry cannot attest candidate runtime',()=>{
  const parents=new Map([[11,10],[12,11],[20,1],[30,31],[31,30]]);
  assert.equal(descendsFrom(12,10,pid=>parents.get(pid)),true);
  assert.equal(descendsFrom(10,10,pid=>parents.get(pid)),true);
  assert.equal(descendsFrom(20,10,pid=>parents.get(pid)),false);
  assert.equal(descendsFrom(30,10,pid=>parents.get(pid)),false);
});

test('hash manifest includes ACK sources and canonical fixture implementation', () => {
  for(const path of ['apps/web/components/whiteboard/live-board.tsx','apps/web/lib/whiteboard-provider.ts','packages/whiteboard-core/src/document.ts','packages/whiteboard-core/src/index.ts']) assert(sourceFiles.includes(path));
  assert.equal(new Set(sourceFiles).size,sourceFiles.length);
});

test('runtime rejects stale source, dead PID and unrelated port',async()=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),dir=mkdtempSync(join(tmpdir(),'connector-runtime-negative-'));
  const manifestPath=join(dir,'manifest.json'),base='http://127.0.0.1:65534',origin='http://127.0.0.1:65533';
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:join(root,'apps/web'),stdio:'ignore'});
  try {
    await once(child,'spawn');
    const manifest={webRoot:root,apiRoot:root,webBase:base,apiBase:origin,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceHashes:runtimeSourceHashes(root),processes:['web','api'].map(kind=>({pid:child.pid,kind,cwd:join(root,'apps/web')}))};
    const check=()=>verifyRuntimeManifest({manifestPath,root,base,origin});
    writeFileSync(manifestPath,JSON.stringify({...manifest,sourceHashes:{...manifest.sourceHashes,[sourceFiles[0]]:'stale'}}));
    assert.throws(check,/startup source/);
    writeFileSync(manifestPath,JSON.stringify({...manifest,processes:manifest.processes.map(p=>({...p,pid:2147483647}))}));
    assert.throws(check);
    writeFileSync(manifestPath,JSON.stringify(manifest));
    assert.throws(check,'candidate sleep process cannot attest a different listener');
  } finally {
    const exit=once(child,'exit');child.kill();await exit;rmSync(dir,{recursive:true,force:true});
  }
});

