import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync,spawn } from 'node:child_process';
import { mkdtempSync,writeFileSync,rmSync,mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { savedSequence, verifyRuntimeManifest, sourceFiles, descendsFrom,assertCommittedSource } from './connector-runtime-manifest.mjs';
import { runtimeSourceHashes as hashSources,verifyRuntimeManifest as verifyBase } from './board-acceptance-runtime.mjs';

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

test('exact Git blobs reject matching dirty manifests, untracked source and moved HEAD',()=>{
  const root=mkdtempSync(join(tmpdir(),'connector-source-negative-')),files=['source.mjs'];
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try {
    git('init');git('config','user.name','Acceptance Fixture');git('config','user.email','fixture@example.invalid');
    writeFileSync(join(root,files[0]),'export const value=1;');git('add',files[0]);git('commit','-m','fixture');
    const head=git('rev-parse','HEAD'),hashes=hashSources(root,files);
    assert.doesNotThrow(()=>assertCommittedSource({root,head,hashes,files}));
    writeFileSync(join(root,files[0]),'export const value=2;');
    assert.throws(()=>assertCommittedSource({root,head,hashes:hashSources(root,files),files}),/dirty source/);
    writeFileSync(join(root,'untracked.mjs'),'export const value=3;');
    assert.throws(()=>assertCommittedSource({root,head,hashes:hashSources(root,['untracked.mjs']),files:['untracked.mjs']}),/exist in attested commit/);
    git('add',files[0]);git('commit','-m','next fixture');
    assert.throws(()=>assertCommittedSource({root,head,hashes,files}),/HEAD must remain current/);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('source union covers navigation authority, plan and input editor',()=>{
  for(const path of ['apps/api/src/interface/ws/whiteboard.gateway.ts','apps/api/src/application/whiteboard/operation-service.ts','scripts/local-session/connector-acceptance-plan.mjs','apps/web/components/whiteboard/thinking-input-editor.tsx','scripts/local-session/board-acceptance-runtime.mjs'])assert(sourceFiles.includes(path));
});
test('unrelated Git history cannot attest accepted navigation ancestry',()=>{
  const root=mkdtempSync(join(tmpdir(),'connector-ancestor-negative-')),manifestPath=join(root,'manifest.json');
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  try{git('init');git('config','user.name','Acceptance Fixture');git('config','user.email','fixture@example.invalid');git('commit','--allow-empty','-m','unrelated');writeFileSync(manifestPath,JSON.stringify({head:git('rev-parse','HEAD')}));assert.throws(()=>verifyRuntimeManifest({manifestPath,root}),/descend from accepted navigation/);}finally{rmSync(root,{recursive:true,force:true});}
});

test('shared runtime gate rejects stale source, dead PID and unrelated port with committed fixtures',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'connector-runtime-negative-')),root=join(dir,'candidate'),files=['source.mjs'];mkdirSync(join(root,'apps/web'),{recursive:true});
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init');git('config','user.name','Acceptance Fixture');git('config','user.email','fixture@example.invalid');writeFileSync(join(root,files[0]),'export const value=1;');git('add',files[0]);git('commit','-m','fixture');
  const manifestPath=join(dir,'manifest.json'),base='http://127.0.0.1:65534',origin='http://127.0.0.1:65533';
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:join(root,'apps/web'),stdio:'ignore'});
  try {
    await once(child,'spawn');
    const manifest={webRoot:root,apiRoot:root,webBase:base,apiBase:origin,head:git('rev-parse','HEAD'),sourceHashes:hashSources(root,files),processes:['web','api'].map(kind=>({pid:child.pid,kind,cwd:join(root,'apps/web')}))};
    const check=()=>verifyBase({manifestPath,root,base,origin,sourceFiles:files});
    writeFileSync(manifestPath,JSON.stringify({...manifest,sourceHashes:{...manifest.sourceHashes,[files[0]]:'stale'}}));
    assert.throws(check,/startup source/);
    writeFileSync(manifestPath,JSON.stringify({...manifest,processes:manifest.processes.map(p=>({...p,pid:2147483647}))}));
    assert.throws(check);
    writeFileSync(manifestPath,JSON.stringify(manifest));
    assert.throws(check,'candidate sleep process cannot attest a different listener');
  } finally {
    const exit=once(child,'exit');child.kill();await exit;rmSync(dir,{recursive:true,force:true});
  }
});
