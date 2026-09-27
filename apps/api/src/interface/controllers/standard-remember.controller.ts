import { timingSafeEqual } from 'node:crypto';
import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Inject, Param, Post, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { StandardRememberInvocation } from '@repo/contracts/standard-remember';
import { RememberNotAuthorizedError, STANDARD_REMEMBER, type StandardRemember } from '../../application/agent-run/standard-remember';
import { Public } from '../public.decorator';

/**
 * issue #4344 —— `wx_remember` 的内部入口（只有 deep-agent-service 持内部密钥能调）。
 * 状态码与 Python 侧的错误码一一对应（`RememberFailureCode`）：400 参数不合契约（包括模型多带了 id）/
 * 403 run 或会话授权不成立 / 503 其余。三种都没有开卡。开卡本身的「没开」（项目对话、不是本人）是 200 + 原因码。
 */
@Controller()
export class StandardRememberController {
  constructor(@Inject(STANDARD_REMEMBER) private readonly service: StandardRemember | null) {}

  @Public() @Post('/internal/agent-runs/:runId/remember/invoke') @HttpCode(200)
  async invoke(@Headers('x-deep-agent-internal-key') key: string | undefined, @Param('runId') runId: string, @Body() body: unknown) {
    const expected = Buffer.from(process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY ?? ''), actual = Buffer.from(key ?? '');
    if (!expected.length || expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new UnauthorizedException();
    const parsed = StandardRememberInvocation.safeParse(body);
    if (!parsed.success || !runId.trim() || runId.length > 256) throw new BadRequestException('remember_invalid_request');
    if (!this.service) throw new ServiceUnavailableException('remember_unavailable');
    try {
      return await this.service.invoke(runId, parsed.data);
    } catch (e) {
      if (e instanceof RememberNotAuthorizedError) throw new ForbiddenException('remember_not_authorized');
      throw new ServiceUnavailableException('remember_unavailable');
    }
  }
}
