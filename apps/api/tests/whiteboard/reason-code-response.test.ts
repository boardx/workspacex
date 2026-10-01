import { ConflictException, type ArgumentsHost, type HttpException } from '@nestjs/common';
import { whiteboard } from '@repo/contracts';
import { describe, expect, it, vi } from 'vitest';
import type { ErrorLogPort } from '../../src/application/ports/error-log.port';
import { AllExceptionsFilter } from '../../src/interface/filters/all-exceptions.filter';

function respond(error: HttpException): Record<string, unknown> {
  let body: Record<string, unknown> = {};
  const response = {
    headersSent: false,
    status: vi.fn(() => response),
    json: vi.fn((value: Record<string, unknown>) => { body = value; return response; }),
    setHeader: vi.fn(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ traceId: 't-whiteboard' }),
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  const errorLog: ErrorLogPort = {
    record: vi.fn().mockResolvedValue(undefined),
    list: vi.fn(),
    getLifecycle: vi.fn(),
    updateLifecycle: vi.fn(),
  };
  new AllExceptionsFilter({ info: vi.fn(), error: vi.fn() }, errorLog).catch(error, host);
  return body;
}

describe('whiteboard resource reason codes', () => {
  it('preserves every contracted code through the global error boundary', () => {
    for (const code of whiteboard.WhiteboardErrorCode.options) {
      expect(respond(new ConflictException({ reasonCode: code })).reasonCode, code).toBe(code);
    }
  });

  it('continues to reject arbitrary exception detail', () => {
    expect(respond(new ConflictException({ reasonCode: 'WHITEBOARD_SQL_INTERNAL' })).reasonCode).toBeUndefined();
  });
});
