/**
 * F54 (UC-21.2 R3 步骤 6-7 / R12 V6-V7 / V6a) -- 涉客户数据留痕的纯计算部分.
 *
 * ## 天数不硬编码——这个文件唯一要守住的性质
 *
 * V6a 的验收动作是"把组织的留痕保留期参数从 180 改成 30，断言到期时间与界面文案随之变"。
 * 能让这条断言失败的写法只有一种：某处把 `180` 当字面量写死。这个文件里**没有任何数字
 * 字面量**代表天数——`retentionDays` 永远是参数，调用方从 `SecurityPolicy.
 * provenanceRetentionDays`（读 O-01）传进来。
 */
export interface CustomerDataCallInput {
  readonly serverId: string;
  readonly toolFullName: string;
  readonly callerId: string;
  readonly agentId: string;
  readonly projectId: string;
  /** 请求参数——已按 [D-16] 脱敏策略处理过的展示形态由上层负责，这里原样透传落库 */
  readonly requestParams: Record<string, unknown>;
  /** 返回摘要，不是完整返回体——「摘要」本身是契约要求（R3 步骤 6 逐字「返回摘要」） */
  readonly responseSummary: string;
  readonly at: Date;
}

/** 落进 `provenance_events.detail` 的形状——R3 步骤 6 逐字六要素，一个不少。 */
export interface CustomerDataTraceDetail {
  readonly serverId: string;
  readonly toolFullName: string;
  readonly callerId: string;
  readonly agentId: string;
  readonly projectId: string;
  readonly requestParams: Record<string, unknown>;
  readonly responseSummary: string;
  readonly at: string;
  /** ISO 8601，由 `computeRetentionExpiry` 算出，随参数变化而变化 */
  readonly retentionUntil: string;
  readonly retentionDaysAtLogging: number;
}

/**
 * 到期时刻 = 记录时刻 + 保留天数。**纯函数、无 I/O**，`retentionDays` 是形参不是常量，
 * 这正是"代码中不存在硬编码 180"这句断言在类型层面唯一能长成的样子——把它做成一个
 * 必填参数，任何想抄近路写 `+ 180` 的实现都要先假装自己在填这个参数。
 */
export function computeRetentionExpiry(loggedAt: Date, retentionDays: number): Date {
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error(`retentionDays 必须是正整数，收到 ${retentionDays}`);
  }
  const ms = loggedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000;
  return new Date(ms);
}

/** 界面文案——「留痕将保留至 {日期}（{N} 天）」，动态渲染，同样不写死 180。 */
export function retentionCopy(retentionDays: number): string {
  return `涉客户数据的调用留痕保留 ${retentionDays} 天`;
}

export function buildCustomerDataTraceDetail(
  input: CustomerDataCallInput,
  retentionDays: number,
): CustomerDataTraceDetail {
  return {
    serverId: input.serverId,
    toolFullName: input.toolFullName,
    callerId: input.callerId,
    agentId: input.agentId,
    projectId: input.projectId,
    requestParams: input.requestParams,
    responseSummary: input.responseSummary,
    at: input.at.toISOString(),
    retentionUntil: computeRetentionExpiry(input.at, retentionDays).toISOString(),
    retentionDaysAtLogging: retentionDays,
  };
}
