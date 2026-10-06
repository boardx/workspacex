import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync, readFileSync, statSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createBoardRegistry, trackBrowserServer, closeOwnedBrowser} from './wsx-r05-owned-resources.mjs';

const fixture = () => {
  const child = Object.assign(new EventEmitter(), {pid: 1234, exitCode: null, signalCode: null});
  let closes=0, kills=0;
  const finish = () => {child.exitCode=0; child.emit('close', 0, null);};
  const server = {process: () => child, close: async () => {closes++; finish();}, kill: async () => {kills++; finish();}};
  return {child, server, finish, counts: () => ({closes,kills})};
};

test('pending request is private and retained ID is durably recorded', () => {
  const directory=mkdtempSync(join(tmpdir(),'r05-owned-test-'));
  try {
    const registry=createBoardRegistry(directory,'protected-initial');
    assert.equal(registry.cleanupPending,false);
    registry.beforeCreate('request');
    const path=join(directory,'owned-resources','boards.json');
    assert.equal(statSync(join(directory,'owned-resources')).mode&0o777,0o700);
    assert.equal(statSync(path).mode&0o777,0o600);
    assert.equal(JSON.parse(readFileSync(path)).requests[0].outcome,'unknown');
    registry.created('request','created-board');
    assert.deepEqual(JSON.parse(readFileSync(path)).requests,[{requestId:'request',outcome:'retained',boardId:'created-board'}]);
    assert.equal(registry.cleanupPending,true);
  } finally {rmSync(directory,{recursive:true});}
});
test('invalid create result retains unknown outcome', () => {
  const directory=mkdtempSync(join(tmpdir(),'r05-owned-test-'));
  try {const registry=createBoardRegistry(directory,'initial'); registry.beforeCreate('request'); assert.throws(()=>registry.created('request',null)); assert.equal(registry.cleanupPending,true);} finally {rmSync(directory,{recursive:true});}
});
test('fulfilled close requires actual child close and termination', async () => {
  const value=fixture(),owner=trackBrowserServer(value.server);
  await closeOwnedBrowser(value.server,owner,10);
  assert.equal(owner.isClosed(),true); assert.deepEqual(value.counts(),{closes:1,kills:0});
});
test('hanging close escalates only to owned server kill', async () => {
  const value=fixture(); value.server.close=()=>new Promise(()=>{});
  await closeOwnedBrowser(value.server,trackBrowserServer(value.server),10);
  assert.equal(value.counts().kills,1);
});
test('fulfilled teardown without child close is rejected', async () => {
  const value=fixture(); value.server.close=async()=>{}; value.server.kill=async()=>{};
  await assert.rejects(closeOwnedBrowser(value.server,trackBrowserServer(value.server),10),/UNPROVEN/);
});
test('child close without exit or signal is rejected', async () => {
  const value=fixture(); value.server.close=async()=>value.child.emit('close'); value.server.kill=async()=>{};
  await assert.rejects(closeOwnedBrowser(value.server,trackBrowserServer(value.server),10),/UNPROVEN/);
});
test('process getter failure still attempts server teardown', async () => {
  const value=fixture(); value.server.process=()=>{throw Error('capture');};
  assert.throws(()=>trackBrowserServer(value.server));
  await assert.rejects(closeOwnedBrowser(value.server,undefined,10),/UNPROVEN/);
  assert.deepEqual(value.counts(),{closes:1,kills:1});
});
test('invalid PID and hanging setup close still attempt kill', async () => {
  const value=fixture(); value.child.pid=0; value.server.close=()=>new Promise(()=>{});
  assert.throws(()=>trackBrowserServer(value.server));
  await assert.rejects(closeOwnedBrowser(value.server,undefined,10),/UNPROVEN/); assert.equal(value.counts().kills,1);
});
test('a signal plus actual close proves termination', async () => {
  const value=fixture(); value.server.close=async()=>{value.child.signalCode='SIGTERM'; value.child.emit('close',null,'SIGTERM');};
  const owner=trackBrowserServer(value.server); await closeOwnedBrowser(value.server,owner,10); assert.equal(owner.isClosed(),true);
});
