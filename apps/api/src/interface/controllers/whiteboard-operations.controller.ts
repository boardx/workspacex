import { Controller, Get, HttpStatus, Inject, Res } from '@nestjs/common';
import type { Response } from 'express';
import { SESSION_TOKEN_STORE, type SessionTokenStore } from '../../application/auth/ports';
import { DATABASE_PORT, type DatabasePort } from '../../application/ports/database.port';
import { WHITEBOARD_OBSERVABILITY, type WhiteboardObservability } from '../../application/whiteboard/observability';
import { WHITEBOARD_SCALE_POLICY } from '../../domain/whiteboard-scale-policy';
import { Public } from '../public.decorator';

@Controller()
export class WhiteboardOperationsController {
  constructor(
    @Inject(DATABASE_PORT) private readonly db: DatabasePort,
    @Inject(SESSION_TOKEN_STORE) private readonly sessions: SessionTokenStore,
    @Inject(WHITEBOARD_OBSERVABILITY) private readonly metrics: WhiteboardObservability,
  ) {}

  /** Aggregate process metrics only. Labels cannot contain tenant or content identifiers. */
  @Public()
  @Get('/metrics/whiteboard')
  metricsText(@Res({ passthrough: true }) response: Response): string {
    response.type('text/plain; version=0.0.4; charset=utf-8');
    return this.metrics.prometheus();
  }

  /** Reports dependency state without names, addresses, credentials or tenant data. */
  @Public()
  @Get('/readyz/whiteboard')
  async readiness(@Res({ passthrough: true }) response: Response) {
    const [database, sessionStore] = await Promise.all([
      this.db.withoutTenant(session => session.query('SELECT 1').then(() => true)).catch(() => false),
      this.sessions.health?.().catch(() => false) ?? Promise.resolve(false),
    ]);
    const validator = this.metrics.validatorReady(WHITEBOARD_SCALE_POLICY.validator.queuedJobs);
    const ready = database && sessionStore && validator;
    response.status(ready ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return { status: ready ? 'ready' : 'unavailable', dependencies: { database, sessionStore, validator } };
  }
}
