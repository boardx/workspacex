import { timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Param,
  Post,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { StandardBrowserInvocation } from '@repo/contracts/standard-browser-tools';
import {
  STANDARD_BROWSER_SERVICE,
  type StandardBrowserService,
} from '../../application/agent-run/standard-browser-tools';
import { toOrgId } from '../../domain/org-id';
import { Public } from '../public.decorator';

@Controller()
export class StandardBrowserToolsController {
  constructor(@Inject(STANDARD_BROWSER_SERVICE) private readonly service: StandardBrowserService | null) {}

  @Public()
  @Post('/internal/agent-runs/:runId/standard-browser/invoke')
  @HttpCode(200)
  async invoke(
    @Headers('x-deep-agent-internal-key') key: string | undefined,
    @Param('runId') runId: string,
    @Body() body: unknown,
  ) {
    const expected = Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? '');
    const actual = Buffer.from(key ?? '');
    if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new UnauthorizedException();
    const parsed = StandardBrowserInvocation.safeParse(body);
    if (!parsed.success || !runId.trim() || runId.length > 256) throw new BadRequestException('standard_browser_invalid_or_unsupported_input');
    if (!this.service) throw new ServiceUnavailableException('standard_browser_unavailable');
    const { orgId, attemptId, leaseEpoch, bindingId, toolCallId, permissionRequestId, toolName, toolArgs } = parsed.data;
    try {
      return await this.service.invoke(
        { orgId: toOrgId(orgId), parentRunId: runId, attemptId, leaseEpoch, bindingId, toolCallId, permissionRequestId },
        { toolName, toolArgs } as Parameters<StandardBrowserService['invoke']>[1],
      );
    } catch {
      throw new ServiceUnavailableException('standard_browser_failed_no_result_confirmed');
    }
  }
}
