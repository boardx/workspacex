/**
 * `listOwnActivity`（#638 delta，迭代 2）—— 自助活动记录，cursor 分页。
 *
 * 不新造查询面：复用两束共用的 `queryProvenance`/`ProvenanceReader.query`（provenance
 * 束头部 X-2 逐字「唯一的审计检索面」），按 `actorId = 会话主体` 过滤。`queryProvenance`
 * 的用例已经把"查自己的历史不需要角色"这条判定做过一次（`ownHistoryOnly` 分支），这里
 * 直接调 reader，不重复走那层角色判定——`userId` 从会话主体来，不是请求体，天然就是
 * "查自己"，没有第二条判定路径需要维护。
 *
 * `summary` 是展示用的一句话，从 `type`/`target` 派生（closed enum → closed 文案表）。
 *
 * 迭代 4 修复（独立复核抓到的可用性缺陷，评分卡十条覆盖不到）：原实现的 `summarize()`
 * 文件头注释虽然写了「closed enum → closed 文案表」，实现却只是
 * `` `${e.type} · ${e.target.kind}:${e.target.id}` ``——用户看到的是裸内部标识符
 * （`account:u-b257a0c0…`），看不出改了什么。现在换成真正的六值文案表，且允许读
 * `detail`（本来担心的「摘要绑死在别的束的内部字段上」是过度谨慎——这几个 `detail` 字段
 * 是写 provenance 的同一批用例自己定义、自己写入的，不是外部依赖；文案表本身是
 * closed 的，`detail` 缺字段时退化成不带具体值的版本，不会因为字段变化而崩）。
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
  const detail = (e.detail ?? {}) as Record<string, unknown>;

  switch (e.type) {
    case "profile-renamed": {
      const displayName = typeof detail.displayName === "string" ? detail.displayName : null;
      return displayName ? `显示名改为"${displayName}"` : "修改了显示名";
    }
    case "avatar-changed": {
      // `update-own-profile.ts` 的 null 分支（清除头像）与非 null 分支（设置/更换头像）共用
      // 同一个 event type，靠 `detail.cleared` 区分——不读它俩就永远显示"更换了头像"，
      // 用户清除头像后活动记录会撒谎说"更换"（复核第二轮实测发现，见 PR #860 讨论）。
      return detail.cleared === true ? "清除了头像" : "更换了头像";
    }
    case "password-changed":
      return "修改了密码";
    case "team-created": {
      const name = typeof detail.name === "string" ? detail.name : null;
      return name ? `创建了团队"${name}"` : "创建了团队";
    }
    case "team-renamed": {
      const name = typeof detail.name === "string" ? detail.name : null;
      return name ? `把团队改名为"${name}"` : "修改了团队名称";
    }
    case "team-deleted": {
      const name = typeof detail.name === "string" ? detail.name : null;
      return name ? `删除了团队"${name}"` : "删除了团队";
    }
    default:
      // 防御性兜底：理论不该发生（六个类型是 closed enum），但新增事件类型忘记补文案表
      // 时，界面应该退化显示而不是崩掉或显示 `undefined`。
      return `执行了操作：${e.type}`;
  }
}
