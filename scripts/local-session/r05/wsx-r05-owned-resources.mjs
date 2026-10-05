import assert from 'node:assert/strict';
import {mkdirSync, writeFileSync, renameSync} from 'node:fs';
import {join} from 'node:path';

export function createBoardRegistry(output, initialBoard) {
  const directory = join(output, 'owned-resources');
  mkdirSync(directory, {mode: 0o700});
  const requests = [];
  const persist = () => {
    const temporary = join(directory, 'boards.json.next');
    writeFileSync(temporary, JSON.stringify({initialBoard, requests, cleanupPending: requests.length > 0}), {mode: 0o600, flag: 'wx'});
    renameSync(temporary, join(directory, 'boards.json'));
  };
  persist();
  return {
    beforeCreate(requestId) {requests.push({requestId, outcome: 'unknown'}); persist();},
    created(requestId, boardId) {
      assert.equal(typeof boardId, 'string');
      assert(boardId.length > 0 && boardId.length <= 256);
      const request = requests.find(value => value.requestId === requestId);
      assert(request && request.outcome === 'unknown');
      request.boardId = boardId; request.outcome = 'retained'; persist();
    },
    get cleanupPending() {return requests.length > 0;},
  };
}

const bounded = async (action, milliseconds) => {
  let timer;
  try {return await Promise.race([Promise.resolve().then(action), new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('R05_RESOURCE_TIMEOUT')), milliseconds);
  })]);} finally {clearTimeout(timer);}
};

export function trackBrowserServer(server) {
  const child = server.process();
  assert(child && Number.isInteger(child.pid) && child.pid > 0 && typeof child.once === 'function', 'Owned child process required');
  let closed = false;
  child.once('close', () => {closed = true;});
  return {server, child, isClosed: () => closed && (child.exitCode !== null || child.signalCode !== null)};
}

export async function closeOwnedBrowser(server, owner, milliseconds = 5000) {
  if (!server) return;
  // Even a failed process capture must attempt teardown of the server already obtained.
  try {await bounded(() => server.close(), milliseconds);} catch {}
  if (!owner?.isClosed()) {
    try {await bounded(() => server.kill(), milliseconds);} catch {}
  }
  if (owner && !owner.isClosed()) {
    try {await bounded(() => new Promise(resolve => {
      if (owner.isClosed()) resolve(); else owner.child.once('close', resolve);
    }), milliseconds);} catch {}
  }
  assert(owner?.isClosed(), 'R05_BROWSER_CLEANUP_UNPROVEN');
}
