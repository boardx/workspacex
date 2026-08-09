/**
 * `listOwnActivity`（#638 delta，迭代 2）—— 自助活动记录，cursor 分页。
 *
 * 不新造查询面：复用两束共用的 `queryProvenance`/`ProvenanceReader.query`（provenance
 * 束头部 X-2 逐字「唯一的审计检索面」），按 `actorId = 会话主体` 过滤。`queryProvenance`
 * 的用例已经把"查自己的历史不需要角色"这条判定做过一次（`ownHistoryOnly` 分支），这里
 * 直接调 reader，不重复走那层角色判定——`userId` 从会话主体来，不是请求体，天然就是
 * "查自己"，没有第二条判定路径需要维护。
 *
 * `summary` 是展示用的一句话，从 `type`/`target` 派生（closed enum → closed 文案表），
 * 不是从 `detail` 里拼装任意字符串——`detail` 的形状按事件类型各不相同，拼进摘要会让
 * 摘要文案的稳定性绑死在别的束的内部字段上。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceEventRecord, ProvenanceReader } from "../provenance/ports";

export interface ListOwnActivityDeps {
  readonly reader: ProvenanceReader;
}

export interface ListOwnActivityInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface OwnActivityEvent {
  readonly eventId: string;
  readonly kind: string;
  readonly occurredAt: string;
  readonly summary: string;
}

export interface ListOwnActivityOutput {
  readonly events: readonly OwnActivityEvent[];
  readonly nextCursor: string | null;
}

export async function listOwnActivity(
  deps: ListOwnActivityDeps,
  input: ListOwnActivityInput,
): Promise<ListOwnActivityOutput> {
  const page = await deps.reader.query(input.orgId, {
    actorId: input.userId,
    limit: input.limit,
    cursor: input.cursor ?? undefined,
  });

  return {
    events: page.events.map((e) => ({
      eventId: e.id,
      kind: e.type,
      occurredAt: e.at,
      summary: summarize(e),
    })),
    nextCursor: page.nextCursor,
  };
}

function summarize(e: ProvenanceEventRecord): string {
  const target = `${e.target.kind}:${e.target.id}`;
  return `${e.type} · ${target}`;
}
