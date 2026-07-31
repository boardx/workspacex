/**
 * `authorizeMcpScopeLayer1` -- F53 (UC-21.1 R7): 三层权限求交的**第①层**服务端判定,
 * 新注册默认隔离运行时阻断, 越权拒绝计入拦截计数.
 *
 * ## 判定顺序, 且顺序本身是判据的一部分
 *
 * 1. **隔离期**（F131 / I-30′）先判——`quarantineUntil` 未过、非平台组 ⇒
 *    `MCP_SERVER_IN_QUARANTINE`，且**不受开关二影响**（跟涉客户数据与否无关）。
 * 2. **连接状态是「已隔离」**（开关一 / I-18）次之——新注册服务器默认落在这里；
 *    ⚠ 与隔离期是**两条不同的门**：隔离期有截止时刻会到期，`已隔离` 是一个需要人工评审
 *    放行才会翻转的状态，不会自己到期。两者都命中时，隔离期先报——它更具体（有截止时刻可读）。
 * 3. **授权范围**（本层的核心, `evaluateMcpAuthScope`）最后判——只有服务器本身可达、
 *    未处于隔离期／已隔离状态，「谁可以调用它」这个问题才有意义。
 *
 * ⚠ **每一次拒绝都记一条拦截计数**（`user_visible_behavior`「计入越权拦截计数（后台数据总览可见）」），
 *   不区分理由——三种拒绝理由都算越权拦截，这也是为什么 `InterceptCounterPort.recordDenied`
 *   的 `reason` 是三码闭集而不是布尔.
 *
 * ⚠ **本文件只判第①层**。第②层（agent 工具白名单, F55/F58）与第③层（任务权限包, X-1
 *   跨束）不在这里——`feature_list.json` F53 notes 明写「三层求交的完整矩阵在 T09 验收」。
 *   调用方若需要完整判定，应在本函数之上再叠另外两层，而不是把它们塞进这一个文件。
 */
import {
  quarantineBlocks,
  evaluateMcpAuthScope,
  type ActorMcpContext,
} from "../../domain/mcp/authorize-scope";
import type { AuthScope, ConnectionStatus, ReviewStatus } from "../../domain/mcp/server-status";
import type { InterceptCounterPort } from "./ports";

export interface AuthorizeLayer1Deps {
  readonly intercepts: InterceptCounterPort;
}

export interface AuthorizeLayer1Input {
  readonly serverId: string;
  readonly toolFullName: string;
  readonly actorId: string;
  /** 本次调用要过关的授权范围——服务器级或工具级，由调用方按 I-29′ 决定传哪一个。 */
  readonly toolAuthScope: AuthScope;
  readonly reviewStatus: ReviewStatus;
  readonly connectionStatus: ConnectionStatus;
  readonly quarantineUntil: string | null;
  readonly now: Date;
  readonly actor: ActorMcpContext & { readonly isPlatformGroup: boolean };
}

export type AuthorizeLayer1Result =
  | { readonly allowed: true; readonly requiresConfirmation: boolean }
  | {
      readonly allowed: false;
      readonly layer: "mcp-scope";
      readonly reason: "MCP_SERVER_IN_QUARANTINE" | "MCP_SERVER_ISOLATED" | "AUTH_SCOPE_DENIED";
      readonly detail: string;
    };

export async function authorizeMcpScopeLayer1(
  deps: AuthorizeLayer1Deps,
  input: AuthorizeLayer1Input,
): Promise<AuthorizeLayer1Result> {
  const denyAndCount = async (
    reason: "MCP_SERVER_IN_QUARANTINE" | "MCP_SERVER_ISOLATED" | "AUTH_SCOPE_DENIED",
    detail: string,
  ): Promise<AuthorizeLayer1Result> => {
    // ⚠ 拒绝路径上必须先记数、再返回——早退（比如测试里忘了 await）会让计数为 0 而结果仍是 false，
    // 两处独立断言都要覆盖这一点。
    await deps.intercepts.recordDenied({
      serverId: input.serverId,
      toolFullName: input.toolFullName,
      actorId: input.actorId,
      reason,
    });
    return { allowed: false, layer: "mcp-scope", reason, detail };
  };

  // 1) 隔离期：截止时刻未到、非平台组 ⇒ 拒。平台组越过这一条，但下面两条照常跑。
  if (
    quarantineBlocks({
      quarantineUntil: input.quarantineUntil,
      now: input.now,
      isPlatformGroup: input.actor.isPlatformGroup,
    })
  ) {
    return denyAndCount(
      "MCP_SERVER_IN_QUARANTINE",
      `隔离期至 ${input.quarantineUntil}，非平台组身份不可调用`,
    );
  }

  // 2) 已隔离——直接查 connectionStatus，而不是经 `callability()` 的 reviewStatus-先
  //    的判定顺序：`callability()` 是"要不要显示为可调用"的界面判据，reviewStatus
  //    （比如新注册默认的「待安全评审」）会先一步截住它，导致 F53 关心的
  //    MCP_SERVER_ISOLATED 永远走不到。这里两个字段独立查，互不覆盖。
  //    （其余 reviewStatus 阻断——如「待安全评审」本身——不是本 feature 的码，留给
  //     调用方另行处理，见 `callability()` 的 `blockedBy: "reviewStatus"` 分支。）
  if (input.connectionStatus === "已隔离") {
    return denyAndCount("MCP_SERVER_ISOLATED", "服务器处于已隔离状态（新注册默认隔离或人工再隔离）");
  }

  // 3) 授权范围本身。
  const evaluation = evaluateMcpAuthScope(input.toolAuthScope, input.actor);
  if (!evaluation.allowed) {
    return denyAndCount(
      "AUTH_SCOPE_DENIED",
      `授权范围「${input.toolAuthScope}」不满足，actor=${input.actorId}`,
    );
  }

  return { allowed: true, requiresConfirmation: evaluation.requiresConfirmation };
}
