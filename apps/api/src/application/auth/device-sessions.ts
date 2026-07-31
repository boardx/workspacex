/**
 * F03 —— `ListDeviceSessions` / `KickDeviceSession`（org-admin `usecases.md` 第五节）。
 *
 * ## 这块能力的**依据等级**先说清楚
 *
 * `KNOWN_CONTRACT_GAPS.OA1` 逐字写着：设备与会话整块在原型中是「原型确认缺失」，
 * 30 天有效期 / 设备指纹 / 踢下线三项**全部出自 `[Backlog]`**，
 * `listDeviceSessions` / `kickDeviceSession` 两个操作的形状**是提案不是裁决**。
 * 本文件实现的是那个提案，**没有**顺手把它升格为已确认需求：
 * 所有形状逐字取自 `packages/contracts/src/org-admin.ts`，一个字段都没有自创。
 *
 * ## 唯一真正被守住的东西：I-32
 *
 * 「被踢会话的**下一次**请求即失效，不等自然过期。」
 * 它不靠本文件实现——本文件只写标记，失效判定在 `domain/auth/session-lifetime.ts`
 * 的 `checkSession`（吊销先于过期），执行点在 `validateSession` → `PrincipalGuard`。
 * 这是刻意的：**踢下线的正确性不能取决于踢下线的代码**，否则「列表里显示已踢」
 * 和「那台设备真的进不来了」会是同一段代码的两个说法，互相背书。
 *
 * ## 只能列/踢自己的
 *
 * `usecases.md` 的 `pre` 逐字：「只能列/踢**自己**的会话——本用例不给管理员踢别人的能力，
 * 那是 `RemoveOrgMember` 的事」。所以这两个用例都**只接受一个 userId，且它来自 principal**，
 * 没有任何入参能指定「替谁操作」。归属校验在 `SessionTokenStore.revokeSession` 里再做一次。
 */
import { orgAdmin as C } from "@repo/contracts";
import type { z } from "zod";
import { checkSession } from "../../domain/auth/session-lifetime";
import type { Clock, SessionTokenStore } from "./ports";

export interface DeviceSessionDeps {
  readonly sessions: SessionTokenStore;
  readonly clock: Clock;
}

export type ListDeviceSessionsOutput = z.infer<typeof C.operations.listDeviceSessions.out>;
export type KickDeviceSessionOutput = z.infer<typeof C.operations.kickDeviceSession.out>;

export interface ListDeviceSessionsInput {
  /** 恒来自 principal。契约的 `in` 是 `{}`——列表**只可能**是自己的。 */
  readonly userId: string;
  /**
   * 调用者此刻用的那条会话，用来标 `current: true`。
   * null = 解析不出来（例如走的是测试注入 principal 而不是 bearer token）——
   * 那时**每一行都是 `current: false`**，而不是随便挑一行标成当前。
   */
  readonly currentSessionId: string | null;
}

/**
 * 列出**仍然可用**的设备会话。
 *
 * ⚠ 已吊销/已过期的记录**不进列表**，但它们仍然存在于存储里（I-7）。
 *   两件事都要：界面上留着一台已经踢掉的设备，用户会以为没踢成功而再踢一次；
 *   而删掉记录会让「谁在什么时候被踢的」不可回答。
 *   ⇒ 过滤发生在**读的这一层**，不是靠删数据实现的。
 *   `listForUser` 仍然返回全部，所以「记录还在、只是被标记了」在测试里可直接断言。
 *
 * ⚠ 排序：最后活跃倒序。没有出处，是这一层自己定的呈现规则——
 *   写在这里而不是留给前端，是因为「哪台是我刚在用的」若两端各排一次就会不一致。
 */
export async function listDeviceSessions(
  deps: DeviceSessionDeps,
  input: ListDeviceSessionsInput,
): Promise<ListDeviceSessionsOutput> {
  const now = deps.clock.now().getTime();
  const all = await deps.sessions.listForUser(input.userId);
  const live = all.filter((s) => checkSession(s, now) === null);
  const sessions = live
    .slice()
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    .map((s) => ({
      id: s.id,
      device: s.device,
      location: s.location,
      // 契约的 `out` 是 ISO 字符串；存储是 epoch ms（可比较、无需解析）。
      // 转换只在这一处发生。
      lastActiveAt: new Date(s.lastActiveAt).toISOString(),
      current: input.currentSessionId !== null && s.id === input.currentSessionId,
    }));
  return { sessions };
}

/** 「踢下线」的契约级失败。`reasonCode` 取值受契约 `err` 约束。 */
export class DeviceSessionError extends Error {
  constructor(readonly reasonCode: (typeof C.operations.kickDeviceSession.err)[number]) {
    super(reasonCode);
    this.name = "DeviceSessionError";
  }
}

export interface KickDeviceSessionInput {
  readonly userId: string;
  readonly targetSessionId: string;
  /**
   * 契约是 `z.literal(true)`：二次确认在**契约上**不可绕。
   *
   * ⚠ 这里仍然再判一次，不是冗余。`ZodBodyPipe` 只校验 HTTP 入口；
   *   这个用例将来被别的调用点（后台任务、CLI）复用时不会经过那个管道，
   *   而「不经二次确认就把用户的设备踢下线」是不可撤销的。
   */
  readonly confirmed: boolean;
}

/**
 * 踢掉一条会话。
 *
 * ⚠ 「不存在 / 不是我的 / 已经从存储里过期掉了」统一回 `VERSION_CHANGED`。
 *
 *   **这是一处已知的契约缺口，不是我挑的语义。** `kickDeviceSession.err` 是
 *   `[NO_ORG_MEMBERSHIP, VERSION_CHANGED, AUTH_SERVICE_UNAVAILABLE]` 这个闭集，
 *   里面**没有**「目标会话不存在」这一档。而这三种情况按 `pre`（只能踢自己的）
 *   本来就必须对调用者不可分辨——否则它是一个会话 id 存在性探测器。
 *   闭集里唯一还能表达「你看到的那个目标已经不是那个状态了」的就是 `VERSION_CHANGED`。
 *
 *   ⇒ 登记在 issue 上：契约缺一个码，或者应当明写「不存在也归 VERSION_CHANGED」。
 *     两者都要人签，agent 不许自己往 `OrgAdminError` 里加成员。
 *
 * ⚠ 幂等：重复踢返回同一个 `revokedAt`（存储层保证）。
 */
export async function kickDeviceSession(
  deps: DeviceSessionDeps,
  input: KickDeviceSessionInput,
): Promise<KickDeviceSessionOutput> {
  // ⚠ 刻意**不是** `DeviceSessionError`：`confirmed` 在契约里是 `z.literal(true)`，
  //   所以 `false` 根本不是一种「契约内的失败」，它是调用方违约。
  //   给它一个 `reasonCode` 会让它出现在响应体里，看起来像一种用户可以处理的情况。
  if (input.confirmed !== true) {
    throw new Error("kickDeviceSession requires confirmed: true (contract: z.literal(true))");
  }
  const result = await deps.sessions.revokeSession(
    input.userId,
    input.targetSessionId,
    deps.clock.now(),
  );
  if (result === null) throw new DeviceSessionError("VERSION_CHANGED");
  return {
    revokedAt: new Date(result.revokedAt).toISOString(),
    affectedDevice: result.device,
  };
}
