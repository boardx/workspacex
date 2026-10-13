import { expect, it, vi } from 'vitest';
import { ConflictException, type ArgumentsHost } from '@nestjs/common';
import type { ErrorLogPort } from '../../src/application/ports/error-log.port';
import { AllExceptionsFilter } from '../../src/interface/filters/all-exceptions.filter';
function body(reasonCode: string) {
  let result: unknown; const response = { headersSent: false, status: vi.fn(() => response), json: vi.fn(value => { result = value; }) };
  const host = { switchToHttp: () => ({ getRequest: () => ({ traceId: 'trace-report' }), getResponse: () => response }) } as unknown as ArgumentsHost;
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, { record: vi.fn(async () => undefined), list: vi.fn(async () => ({ items: [], hasMore: false })), getLifecycle: vi.fn(async () => null), updateLifecycle: vi.fn(async () => null) } satisfies ErrorLogPort).catch(new ConflictException({ reasonCode }), host);
  return result;
}
it('preserves only the registered report-file reason codes without exception details', () => {
  expect(body('REPORT_CHANGED')).toMatchObject({ error: 'conflict', reasonCode: 'REPORT_CHANGED' });
  expect(body('secret-database-connection')).toEqual({ error: 'conflict', traceId: 'trace-report' });
});
