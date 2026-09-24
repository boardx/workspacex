/** Real HTTP/PostgreSQL/Redis acceptance for whiteboard operational endpoints. */
import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureDatabase, migrateOnce } from '../support/db';

process.env.KERNEL_QUIET = '1';

let app: NestExpressApplication;
let base: string;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import('../../src/main');
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  if (!address || typeof address === 'string') throw new Error('missing address');
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close();
});

describe('whiteboard operational HTTP boundary', () => {
  it('reports the live database, session store, and validator ready', async () => {
    const response = await fetch(`${base}/readyz/whiteboard`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ready',
      dependencies: { database: true, sessionStore: true, validator: true },
    });
  });

  it('exposes aggregate Prometheus metrics without tenant or content labels', async () => {
    const response = await fetch(`${base}/metrics/whiteboard`);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/plain');
    const body = await response.text();
    expect(body).toContain('workspacex_whiteboard_active_connections');
    expect(body).not.toMatch(/(?:org|tenant|board|user|content)_id/);
  });
});
