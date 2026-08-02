/**
 * 分组编排 —— 组状态三值封闭 + 组长必填（F25 / `uc-2-2` R8 V7 / 契约 `templates.updateGrouping`）。
 *
 * 纯函数：没有时钟、没有 I/O、没有存储。给定一批 `GroupPatch`，判两条不变量——
 *   1. 状态只能是三值之一（录音就绪/缺 N 人/需介入），第四态一律拒绝（I-14）。
 *   2. 每组必须有一位组长——`leaderUserId` 为 null 即 `GROUP_LEADER_REQUIRED`。
 * 仓储怎么持久化、`[加人]`/`[换组长]` 落到哪张表不是本文件的事，那是应用层与仓储的活；
 * 本文件只回答「这批分组合不合法」。
 *
 * ## 为什么这里要重判一次状态是不是三值之内
 *
 * 契约 `updateGrouping.in.groups[].status` 已经是 `GroupStatus`（zod 三值枚举）——走 HTTP
 * 这条路径时 zod 会先拦住第四态。但用例函数本身也可能被直接调用（测试、未来的内部调用方），
 * `z.enum` 的保证只在「值是从 `.parse()` 出来的」这个前提下成立。`findInvalidStatus` 把这条
 * 校验搬进 domain，讲的是同一件事：**没有校验就不能信任调用方**，与「走没走 HTTP」无关
 * （同 `project-topic.ts` 的 `isAiSourcesSufficient` 头注同一条纪律）。
 */

/** 三值封闭集，即原型「录音就绪 / 缺 N 人 / 需介入」（I-14）。 */
export const GROUP_STATUSES = ["recording-ready", "short-n", "needs-intervention"] as const;
export type GroupStatusValue = (typeof GROUP_STATUSES)[number];

export function isValidGroupStatus(value: string): value is GroupStatusValue {
  return (GROUP_STATUSES as readonly string[]).includes(value);
}

export interface GroupPatch {
  readonly groupId: string;
  readonly name: string;
  readonly scenario: string;
  /** null ⇒ 尚未指派组长——`GROUP_LEADER_REQUIRED`，不是「稍后再说」。 */
  readonly leaderUserId: string | null;
  readonly status: string;
}

/** 第一个不在三值封闭集里的状态值；没有就是 `undefined`（V7）。 */
export function findInvalidStatus(groups: readonly GroupPatch[]): string | undefined {
  return groups.map((g) => g.status).find((s) => !isValidGroupStatus(s));
}

/** 第一个缺组长的组的 `groupId`；没有就是 `undefined`。 */
export function findGroupMissingLeader(groups: readonly GroupPatch[]): string | undefined {
  return groups.find((g) => g.leaderUserId === null)?.groupId;
}

/**
 * `[− 4 +]` 增减组数后组卡数量必须与 `groupCount` 一致（V7）。
 * `groupCount` 为 `null` ⇒ 尚未显式设定组数，不做该项校验（同「未定题即保存」的低准备度态）。
 */
export function groupCountMatches(
  groupCount: number | null,
  groups: readonly GroupPatch[],
): boolean {
  if (groupCount === null) return true;
  return groups.length === groupCount;
}
