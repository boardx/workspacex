/**
 * issue #3405 —— `InterjectionCarryOverDelivery` 的生产实现：把一批未采纳的插话作为
 * **下一条人类消息**投进同一线程。
 *
 * 为什么是 `acceptHumanMessage` 而不是自己 INSERT 一行 `agent_runs`：见
 * `application/agent-run/interjection-carry-over.ts` 头注。这里只讲这个适配器自己的
 * 三条纪律。
 *
 * ① **身份是真实作者，不是「系统」。** `actorId` 用来源 run 的 requester —— 那句话
 *    本来就是他说的。用一个合成身份写入会让他自己都取消不掉带入起的那一轮
 *    （`cancelAgentRun` 的 `findRequesterUserId !== userId` 会挡住），正是约束③
 *    「不允许出现它自己跑起来了而我停不下来」。
 *
 * ② **拒绝是正常结果，不是异常。** 线程已归档、可见性已撤销、agent 已下架 ⇒ 返回
 *    `null`，调用方如实落 `not_applied`，由用户手动「重新发送」。把这些转成抛错会让
 *    sweep 无限重试一件永远不会成功的事。真正的瞬时故障（DB 抖动）照旧抛出去，由
 *    sweep 留在 `carry_over_pending` 下次重试。
 *
 * ③ **不 kick 执行器。** 调用方（`AgentRunExecutor.tick`）投完这一批后自己再跑一轮
 *    有界的 `executeQueuedRuns`。在这里回调 kick 会形成 executor → delivery → executor
 *    的构造期依赖环。
 */
import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { OrgId } from "../../domain/org-id";
import type { CarryOverBatch, InterjectionCarryOverDelivery } from "../../application/agent-run/interjection-carry-over";
import { carryOverClientMessageId } from "../../application/agent-run/interjection-carry-over";
import {
  AgentNotPublishedError, MessageNoWriteRoleError, MessageThreadArchivedError,
  MessageThreadNotVisibleError, acceptHumanMessage,
} from "../../application/chat/message-roundtrip";
import { CHAT_MESSAGE_COMMAND_REPOSITORY, ENABLED_SKILL_VERSION_READER, PUBLISHED_AGENT_READER, THREAD_MOUNTED_SKILL_READER } from "../../application/chat/message-command-ports";
import type { ChatMessageCommandRepository, EnabledSkillVersionReader, PublishedAgentReader, ThreadMountedSkillReader } from "../../application/chat/message-command-ports";
import { CHAT_REPOSITORY, type ChatRepository } from "../../application/chat/ports";
import { DECISION_ID_FACTORY, IDENTITY_REPOSITORY, type DecisionIdFactory, type IdentityRepository } from "../../application/identity/ports";
import { LOGGER_PORT, type LoggerPort } from "../../application/ports/logger.port";
import { MODEL_CALL_PORT, type ModelCallPort } from "../../application/agent-run/ports";
import { THREAD_TITLE_MODEL_CONFIG, type ThreadTitleModelConfig } from "../../application/chat/generate-thread-title";

@Injectable()
export class AcceptMessageCarryOverDelivery implements InterjectionCarryOverDelivery {
  constructor(
    @Inject(IDENTITY_REPOSITORY) private readonly repo: IdentityRepository,
    @Inject(DECISION_ID_FACTORY) private readonly ids: DecisionIdFactory,
    @Inject(CHAT_REPOSITORY) private readonly chat: ChatRepository,
    @Inject(CHAT_MESSAGE_COMMAND_REPOSITORY) private readonly commands: ChatMessageCommandRepository,
    @Inject(PUBLISHED_AGENT_READER) private readonly publishedAgents: PublishedAgentReader,
    @Inject(THREAD_MOUNTED_SKILL_READER) private readonly threadMounts: ThreadMountedSkillReader,
    @Inject(ENABLED_SKILL_VERSION_READER) private readonly enabledSkills: EnabledSkillVersionReader,
    @Inject(MODEL_CALL_PORT) private readonly model: ModelCallPort,
    @Inject(THREAD_TITLE_MODEL_CONFIG) private readonly titleModel: ThreadTitleModelConfig,
    @Inject(LOGGER_PORT) private readonly logger: LoggerPort,
  ) {}

  private readonly log = (message: string, detail: Record<string, unknown>): void => {
    this.logger.error(message, { traceId: randomUUID(), err: detail.detail ?? message, ...detail });
  };

  async deliver(orgId: OrgId, batch: CarryOverBatch): Promise<string | null> {
    try {
      const accepted = await acceptHumanMessage({
        repo: this.repo, ids: this.ids, chat: this.chat, commands: this.commands,
        publishedAgents: this.publishedAgents, threadMounts: this.threadMounts,
        enabledSkills: this.enabledSkills, model: this.model, titleModel: this.titleModel,
        log: this.log,
      }, {
        userId: batch.requesterUserId, orgId, threadId: batch.threadId,
        // 确定性 id ⇒ 重放命中幂等分支，永远只起一轮（见 `carryOverClientMessageId`）。
        clientMessageId: carryOverClientMessageId(batch.originRunId),
        text: batch.text, agentId: batch.agentId,
        carriedOverFromRunId: batch.originRunId,
      });
      return accepted.agentRunId;
    } catch (e) {
      if (e instanceof MessageThreadNotVisibleError || e instanceof MessageThreadArchivedError
        || e instanceof MessageNoWriteRoleError || e instanceof AgentNotPublishedError) {
        this.log("interjection carry-over not deliverable", {
          originRunId: batch.originRunId, detail: e.constructor.name,
        });
        return null;
      }
      throw e;
    }
  }
}
