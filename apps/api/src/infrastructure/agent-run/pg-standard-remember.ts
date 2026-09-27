import { StandardRememberInvocation } from '@repo/contracts/standard-remember';
import type { DatabasePort } from '../../application/ports/database.port';
import type { ToolExecutionAuthority } from '../../application/agent-run/tool-execution-authority';
import type { AgentRunStore } from '../../application/agent-run/ports';
import type { GetThreadDeps } from '../../application/chat/get-thread';
import type { MemoryCardPort } from '../../application/knowledge-graph/ports';
import { openRememberCard, RememberNotAuthorizedError, type StandardRemember } from '../../application/agent-run/standard-remember';
import { withAuthorizedStandardToolRun } from './with-authorized-standard-tool-run';
import { toOrgId } from '../../domain/org-id';

/**
 * issue #4344 —— `wx_remember` 的服务端：会话、消息、请求人**只从 run 读**（与 `wx_memory_write` 的 source-proof
 * 同一个 `withAuthorizedStandardToolRun`：run 授权 + 触发消息是人发的 + 请求人此刻仍能看到这个会话），
 * 再在这一轮上开 F17 的记住卡。模型给的只有那句话。
 */
export class PgStandardRemember implements StandardRemember {
  constructor(private readonly db: DatabasePort, private readonly authority: Pick<ToolExecutionAuthority, 'check'>,
    private readonly visibility: GetThreadDeps, private readonly cards: MemoryCardPort,
    private readonly runs: Pick<AgentRunStore, 'findRequesterUserId'>) {}

  async invoke(runId: string, raw: StandardRememberInvocation) {
    const input = StandardRememberInvocation.parse(raw), orgId = toOrgId(input.orgId);
    // 请求人 = 触发这一轮的那条人类消息的作者（AgentRunStore.findRequesterUserId，与 ClaimedAgentRun.requesterUserId 同一个事实）；
    // run 不存在 ⇒ 拒。之后的授权 / 作者 / 可见性复核在 withAuthorizedStandardToolRun 里。
    const requester = await this.runs.findRequesterUserId?.(orgId, runId) ?? undefined;
    if (requester === undefined) throw new RememberNotAuthorizedError('run_not_found');
    try {
      return await withAuthorizedStandardToolRun(this.db, this.authority, this.visibility, runId, { ...input, userId: requester },
        (run) => openRememberCard(this.cards, {
          orgId: run.orgId, userId: run.userId, threadId: run.threadId, runId, messageId: run.inputMessageId, statement: input.toolArgs.statement,
        }));
    } catch (e) {
      const message = e instanceof Error ? e.message : '';
      if (message === 'standard_tool_authority_denied' || message === 'standard_tool_scope_denied') throw new RememberNotAuthorizedError(message);
      throw e;
    }
  }
}
