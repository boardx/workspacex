import { expect, it } from 'vitest';
import { SessionManager } from '../src/session/manager.js';
import { bubblewrapArguments } from '../src/session/provider.js';

it('mounts original input bytes read-only and keeps workspace copies writable', async () => {
  const manager = new SessionManager({ probe: async () => false, execute: async () => { throw new Error('unused'); } });
  const file = { path: '/inputs/attachment/source.csv', contentBase64: Buffer.from('name,value\n甲,10\n').toString('base64') };
  const session = await manager.create([], undefined, [file]);
  try {
    expect((await manager.read(session.sessionId, session.token, file.path)).contentBase64).toBe(file.contentBase64);
    await expect(manager.write(session.sessionId, session.token, file)).rejects.toThrow('SESSION_PATH_READ_ONLY');
    await manager.write(session.sessionId, session.token, { ...file, path: '/workspace/copy.csv' });
    expect((await manager.read(session.sessionId, session.token, '/workspace/copy.csv')).contentBase64).toBe(file.contentBase64);
    const args = bubblewrapArguments('/tmp/workspace', '/tmp/skills', '/tmp/inputs');
    expect(args.slice(args.indexOf('/tmp/inputs') - 1, args.indexOf('/tmp/inputs') + 2)).toEqual(['--ro-bind', '/tmp/inputs', '/inputs']);
  } finally { await manager.destroy(session.sessionId, session.token); }
});

it('refuses invalid input roots, aliases, duplicates and noncanonical bytes', async () => {
  const manager = new SessionManager({ probe: async () => false, execute: async () => { throw new Error('unused'); } });
  for (const path of ['/workspace/original', '/inputs/../secret', '/inputs//a', '/inputs']) {
    await expect(manager.create([], undefined, [{ path, contentBase64: 'YQ==' }])).rejects.toThrow();
  }
  await expect(manager.create([], undefined, [{ path: '/inputs/a', contentBase64: 'YR==' }])).rejects.toThrow();
  await expect(manager.create([], undefined, [{ path: '/inputs/a', contentBase64: '' }, { path: '/inputs/a', contentBase64: '' }])).rejects.toThrow();
});
