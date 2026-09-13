/** Shared session issuance after a caller has proved its identity. */
import { SESSION_TTL_MS, type SessionRecord } from "../../domain/auth/session-lifetime";
import type { IdentityRepository } from "../identity/ports";
import { AuthError } from "./errors";
import { SessionStoreUnavailableError, type SessionTokenStore, type TokenFactory } from "./ports";
import type { LoginDeviceContext, LoginOutput } from "./login";

export async function issueAuthenticatedSession(
  deps: { identity: IdentityRepository; sessions: SessionTokenStore; tokens: TokenFactory },
  userId: string,
  now: Date,
  device: LoginDeviceContext,
): Promise<LoginOutput> {
  const orgs = await deps.identity.listMemberships(userId);
  const record: SessionRecord = {
    id: deps.tokens.sessionId(),
    userId: userId,
    // uc-1-1 R3 step 3: the login step does NOT let the user pick an organization. It is
    // resolved afterwards, by `identity.switchOrganization`, which owns the post-effects.
    currentOrgId: orgs[0]?.orgId ?? null,
    issuedAt: now.getTime(),
    expiresAt: now.getTime() + SESSION_TTL_MS,
    revokedAt: null,
    // F03：设备会话与会话是**同一条记录**（org-admin usecases.md 第六节：
    // `DeviceSessionRepository` 与 phase-00 的 `SessionStore` 同一个存储）。
    // 因此 I-33「一次登录恰好一条 DeviceSession」在这里是结构性成立的：
    // 这个函数只 issue 一次，没有第二处需要保持同步。
    device: device.device,
    location: device.location,
    // 登录本身就是一次活跃。用 issuedAt 而不是 0/null：一台刚登录的设备
    // 在列表里显示「最后活跃：从未」是假的。
    lastActiveAt: now.getTime(),
  };
  // 真实事故（2026-09-01，traceId 28b6862c-71e1-4ce8-8e3f-3fceb9f8b607）：ioredis 在这次
  // 调用途中报 `Error: Connection is closed.`（连接被对端关闭，命中一次瞬时 Redis 抖动），
  // 这里此前不捕获，异常原样冒到 `AuthController`，`toHttp()` 认不出它（既不是 `AuthError`
  // 也不是 `PasswordPolicyError`），`AllExceptionsFilter` 把它归成裸的 `internal_error`
  // 500——用户看到「服务暂时不可用」（措辞碰巧对了），但没有走契约定义好的
  // `AUTH_SERVICE_UNAVAILABLE` 通路，日志里也留不下一个可归类的 reasonCode。
  //
  // `redis-session-token-store.ts` 文件头注早就写明这里的设计意图——"Redis unavailable
  // => refuse, never degrade"，"a thrown error becomes 503 auth_unavailable"——但那句意图
  // 只在 `PrincipalGuard`（校验已有 session）那条路径上真正落地了，登录时**签发新
  // session** 这条路径上从来没人接住过。
  //
  // ⚠ 2026-09-01 复核（PR #2440 独立审查 finding #1）—— 这里**只**捕获
  //   `SessionStoreUnavailableError`（`redis-session-token-store.ts` 的
  //   `isRecognisedConnectionFailure` 分类出的连接类失败），不是任意异常。最初那版
  //   写的是无类型 `catch { ... }`，会把 `issue()` 里任何异常（包括这个适配器自己的
  //   编程错误、JSON 序列化失败、未来换一个非 Redis 实现时的全新错误类）都误判成
  //   "Redis 挂了"——那不是收窄失败面，是把"服务依赖故障"和"代码有 bug"这两件事
  //   混成一句话。未识别的异常原样重新抛出，继续走 `AllExceptionsFilter` 的兜底分支
  //   变成 `internal_error`：那才是"这不是 Redis 抖动"时诚实的答案。
  //
  // ⚠ 幂等性（同一处 finding #3）—— `issue()` 在这里失败时，`token`（`randomToken()`
  //   独立 CSPRNG 输出，不从 `record` 派生）从未 `return` 给调用方，也从未写进日志/
  //   响应体的任何地方（`lint-error-leak` 早已钉死这条）。所以即使 Redis 端已经真的
  //   提交了这次 `MULTI`（只是确认响应在返回路上丢了），那条会话对系统里的任何人
  //   （含攻击者）都是**不可获知**的孤儿 key——没有人持有能兑现它的 token，它不能
  //   被用来认证任何请求，只会安静地等自己的 TTL（`redis-session-token-store.ts`
  //   `issue()` 里已经设置的 `EX ttlSeconds`）到期。用户看到失败后重试登录会拿到
  //   一个**新的、独立的**会话——这与本系统本就支持多设备并存会话（`device`/
  //   `location` 字段、F03）是同一件事，不是需要另外补的去重语义。真正需要幂等保护
  //   的是"同一个 token 被重复兑现成两条不同会话"，而 token 直到 `issue()` 成功
  //   返回前从不存在于调用方手里，这条路径结构上不可能发生。
  let sessionToken: string;
  try {
    sessionToken = await deps.sessions.issue(record);
  } catch (e) {
    if (e instanceof SessionStoreUnavailableError) throw new AuthError("AUTH_SERVICE_UNAVAILABLE");
    throw e;
  }

  return {
    sessionToken,
    userId: userId,
    // IDs only -- no roles (I-9).
    orgs: orgs.map((o) => o.orgId),
    expiresAt: new Date(record.expiresAt).toISOString(),
  };
}
