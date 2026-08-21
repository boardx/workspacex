/**
 * 「这个人能不能改这条线程的 skill 挂载」—— 挂载 / 摘除 / 读列表三条路径的**唯一**前置。
 *
 * ## 为什么这个文件存在（#1693，人类裁决 2026-08-21）
 *
 * 裁决逐字：
 *
 * > 「个人对话必须要可以使用公共的 skills」
 * > 「所有的人都可以用」
 *
 * 在此之前，授权是 `skill-mount.controller.ts` 里的
 * `requireProjectId(query.projectId)` ＋ `deliverRoleOf(principal, thatProjectId)`。
 * 这个形状有两个毛病，本文件同时修掉：
 *
 * 1. **个人对话进不来**：`project_id IS NULL` ⇒ 没有 `projectId` 可传 ⇒ 422，
 *    连用例层都到不了。这是裁决要推翻的行为。
 * 2. 🔴 **projectId 由调用方自己给，且从未与线程核对**（既有越权洞，非本次引入）：
 *    `mountSkillToThread` 用例从不调 `findThreadFacts`，也不校验 `threadId` 是否
 *    真的属于那个 `projectId`。⇒ 项目 P 的引导师只要知道任意一条线程 id
 *    （**含别人的个人线程**），带上 `?projectId=P` 就能挂上去。租户由 RLS 兜住，
 *    跨线程/跨项目没有任何兜底。
 *
 * ⇒ **项目从线程反查，不从请求里拿**。`projectId` query 参数就此不再是授权输入。
 *   这一条是本文件的全部要点：`resolveVisibility` 的 `projectId` 实参恒为
 *   `facts.projectId`（数据库里的真值），调用方说什么都不影响判定。
 *
 * ## 不新写第二套可见性
 *
 * 判「谁能看这条线程」的权威是 `application/chat/resolve-visibility.ts`——它**已经**
 * 同时处理个人线程（creator-only）与项目线程（两层交集 + 组 + 观察者降级）。
 * 本文件只在它之上叠一条 skill 侧特有的增量：**读得到 ≠ 写得了**，观察者只读
 * （同 `message-roundtrip.ts` 发消息路径的 `MessageNoWriteRoleError`）。
 * 那条增量在 domain 的 `isThreadMountAllowed`，本文件不自己判。
 *
 * ## 拒绝出口只有一个（I-3 / I-14 同一条精神）
 *
 * 「线程不存在」「线程存在但你看不见」「你看得见但你是观察者」三者对外**同码同出口**
 * （`PERMISSION_REVOKED` ⇒ 403）。分开会把这条路由变成一个线程 id 探测器：
 * 拿 404 和 403 的差别就能枚举出哪些线程 id 真实存在。
 *
 * ⚠ 依赖失败**不折成拒绝**：`AuthzUnavailableError` 原样上抛，由 interface 映射 503
 *   （uc-8-5 V10）。把它吞成 403 会让一次数据库抖动看起来像一次越权尝试。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProjectRole } from "../../domain/identity/roles";
import { isThreadMountAllowed } from "../../domain/skill/thread-mount";
import { resolveVisibility, type ResolveVisibilityDeps } from "../chat/resolve-visibility";

export interface AuthorizeThreadMountInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
}

export type ThreadMountAuthorization =
  | {
      readonly allowed: true;
      /** 线程**真实**所属项目（`null` = 个人对话）。从数据库反查，不是调用方给的。 */
      readonly projectId: string | null;
      readonly projectRole: ProjectRole | null;
      readonly decisionId: string;
    }
  | {
      readonly allowed: false;
      /** 仅供审计区分；**不进对外响应**（见文件头「拒绝出口只有一个」）。 */
      readonly reason: "thread-not-visible" | "read-only-role";
      readonly decisionId: string;
    };

/**
 * ⚠ `findThreadFacts` 在这里与 `resolveVisibility` 内部各读一次（两次同样的行）。
 *   这是刻意的：把 `projectId` 选择器算对，必须先知道线程真实归属，而
 *   `resolveVisibility` 的签名要求先给选择器。省掉这一次读的办法是把选择器逻辑
 *   搬进 `resolveVisibility`——那会改动 chat 束已签核的判定入口，为一次多余的
 *   索引命中去动整个可见性单一事实源，不划算。同一事务内同一行，代价是一次索引查找。
 */
export async function authorizeThreadMount(
  deps: ResolveVisibilityDeps,
  input: AuthorizeThreadMountInput,
): Promise<ThreadMountAuthorization> {
  const { userId, orgId, threadId } = input;

  const facts = await deps.chat.findThreadFacts(orgId, threadId);
  if (facts === null) {
    return { allowed: false, reason: "thread-not-visible", decisionId: deps.ids.next() };
  }

  const outcome = await resolveVisibility(deps, {
    userId,
    orgId,
    // 🔴 真值，不是 query 参数。这一行就是那个越权洞的补丁。
    projectId: facts.projectId,
    threadId,
  });

  if (outcome.kind !== "allow") {
    return { allowed: false, reason: "thread-not-visible", decisionId: outcome.decisionId };
  }

  const projectRole = outcome.actor.projectRole;
  const allowed = isThreadMountAllowed({
    threadIsPersonal: facts.projectId === null,
    threadReadAllowed: true,
    projectRole,
  });

  if (!allowed) {
    return { allowed: false, reason: "read-only-role", decisionId: outcome.decisionId };
  }

  return { allowed: true, projectId: facts.projectId, projectRole, decisionId: outcome.decisionId };
}
