/**
 * `resolveVisibility` —— **每一个对话读端口的前置，没有例外**（chat usecases UC-0）。
 *
 * 本束里凡是会把对话数据交出去的路径，都必须先经过这个函数。它存在的全部意义是
 * 「只有一份可见性实现」：文件下载（UC-6）、线程列表（UC-4）、线程详情（UC-1）
 * 若各判一次权，它们就会在某次修改后开始给出不同的答案，而不一致的那一天没有人会收到通知。
 *
 * ## 依赖失败一律拒绝，不得降级为放行（uc-8-5 V10）
 *
 * 判定读不到角色时抛 `AuthzUnavailableError`，由 `interface` 映射成 503。
 * 「重试期间先放行」是把一次数据库抖动变成一次越权读——这是本束唯一
 * 「依赖失败时不给安全重试而直接拒绝」的地方，写反了就是安全事故。
 *
 * ## 拒绝不泄露存在性（I-3）
 *
 * 本函数区分「不存在」与「存在但无权」，因为审计要区分；**对外的响应体不区分**，
 * 那一步由 `interface` 把两者映射成同一个 404 完成。`deniedLayer` 同理：
 * 它进审计与内部判定记录，不进对外响应（契约 `resolveVisibility` 注释逐字如此）。
 */
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import {
  chatReadAction,
  decidePersonalThreadRead,
  decideThreadRead,
  type ActorFacts,
  type ChatVisibilityDecision,
  type ThreadFacts,
} from "../../domain/chat/thread-visibility";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { ChatRepository } from "./ports";

/** 判定依赖不可用。**拒绝**，不是放行，也不是空决定。 */
export class AuthzUnavailableError extends Error {
  constructor() {
    super("authz_unavailable");
  }
}

export interface ResolveVisibilityDeps extends AuthorizeDeps {
  readonly chat: ChatRepository;
}

export interface ResolveVisibilityInput {
  readonly userId: string;
  readonly orgId: OrgId;
  /**
   * 🔴 #594：`null` = 调用方按「个人线程」这条路径来读——不查任何项目成员资格，
   * 只认「你是不是创建者」。**这不是可选参数，是两条不同判定分支的选择器**：
   * 见本文件 `resolveVisibility` 里的 `if (projectId === null)` 分岔与它上面的长注。
   */
  readonly projectId: string | null;
  readonly threadId: string;
}

/**
 * 内部结果。三态而不是布尔：
 * 「不存在」与「存在但被拒」在**审计**里必须分得开，在**响应**里必须分不开。
 * 合成布尔就等于提前放弃了前者。
 */
export type VisibilityOutcome =
  | { readonly kind: "not-found"; readonly decisionId: string }
  | {
      readonly kind: "denied";
      readonly decisionId: string;
      readonly decision: ChatVisibilityDecision;
      readonly thread: ThreadFacts;
      readonly actor: ActorFacts;
      /**
       * phase-00 的基础判定，**原样带出**。
       * 取正文要经守卫读路径（`discloseDecided`），而那道门要的就是这个对象——
       * 调用方若只拿到布尔，就只能现造一个 `allowed: true` 交进去，那等于绕过自己的门。
       */
      readonly base: PermissionDecision;
    }
  | {
      readonly kind: "allow";
      readonly decisionId: string;
      readonly decision: ChatVisibilityDecision;
      readonly thread: ThreadFacts;
      readonly actor: ActorFacts;
      /**
       * phase-00 的基础判定，**原样带出**。
       * 取正文要经守卫读路径（`discloseDecided`），而那道门要的就是这个对象——
       * 调用方若只拿到布尔，就只能现造一个 `allowed: true` 交进去，那等于绕过自己的门。
       */
      readonly base: PermissionDecision;
    };

export async function resolveVisibility(
  deps: ResolveVisibilityDeps,
  input: ResolveVisibilityInput,
): Promise<VisibilityOutcome> {
  const { repo, ids, chat } = deps;
  const { userId, orgId, projectId, threadId } = input;

  if (projectId === null) return resolvePersonalVisibility(deps, { userId, orgId, threadId });

  let thread: ThreadFacts | null;
  let membership: Awaited<ReturnType<typeof repo.findProjectMembership>>;
  try {
    [thread, membership] = await Promise.all([
      chat.findThreadFacts(orgId, threadId),
      repo.findProjectMembership(userId, projectId, orgId),
    ]);
  } catch {
    // 不吞：吞掉就把「判定挂了」变成了「判定说不允许」，两者在运维上是完全不同的事。
    throw new AuthzUnavailableError();
  }

  if (thread === null) {
    // 没有线程就没有可判定的对象。仍然发一个 decisionId：一次「读了不存在的东西」
    // 的尝试也是一次可审计的事件，尤其在扫描 id 的场景里。
    return { kind: "not-found", decisionId: ids.next() };
  }

  const actor: ActorFacts = {
    userId,
    projectRole: membership?.projectRole ?? null,
    groupId: membership?.groupId ?? null,
  };

  let base;
  try {
    base = await authorize(
      { repo, ids },
      {
        userId,
        orgId,
        projectId,
        // 组织层的范围判定挂在**项目**这个对象上：对话线程本身不是 acl_bindings 的
        // 对象类型，而线程的组织层归属就是它所在项目的归属（团队可见性由此生效）。
        object: { kind: "project", id: projectId },
        action: chatReadAction(thread, actor),
      },
    );
  } catch {
    throw new AuthzUnavailableError();
  }

  const decision = decideThreadRead({ thread, actor, base });
  // 交出去的 `base` 里的 `allowed` 是 phase-00 那一层的答案；对话侧的最终答案是
  // `decision.allowed`。守卫读路径要的是「这次读到底允不允许」，所以两者在这里合并——
  // 只交 base 会让一个被对话规则拒掉的人仍然解得开 `Guarded`。
  const merged: PermissionDecision = { ...base, allowed: decision.allowed };
  const outcome = { decisionId: base.decisionId, decision, thread, actor, base: merged } as const;
  return decision.allowed ? { kind: "allow", ...outcome } : { kind: "denied", ...outcome };
}

/**
 * 🔴 #594 —— 个人线程分支。**这是本次改动全部风险的落点，独立成一个函数是刻意的**：
 * 项目分支一个字没动（上面那段与改动前逐字节相同），审阅这个函数就是审阅本次改动
 * 的全部攻击面，不用在项目分支的四百行判定里找哪里被悄悄改了。
 *
 * ## 门①（mismatch guard）——唯一权威，没有第二道
 *
 * 调用方传 `projectId: null`，但这条线程**实际**挂着一个真实项目
 * （`thread.projectId !== null`）⇒ **拒绝**，与「不存在」同一出口。
 * 没有这道门，personal 路径就是一条绕过项目 ACL 的捷径——攻击者只要知道
 * 任意一条项目线程的 id，把 `projectId` 故意传 `null`，就能跳过
 * `findProjectMembership` 那一整套判定，直接落到下面「仅创建者可读」——
 * 项目线程的可见性只能由项目分支回答，个人分支没有资格代答。
 * 反证：`personal-thread-no-project.test.ts` §3② 单独删掉这一行 ⇒ 2 条红。
 *
 * ## 门②（creator-only）——刻意的**双重**实现，两处都要删才会红
 *
 * I-3 的直接延伸：线程不存在与存在但非本人创建，对外必须是同一个 404。
 * 这条判据在**两处**独立出现：下面这一行 `thread.createdBy !== userId` 的
 * 早退，与 `decidePersonalThreadRead()`（`domain/chat/thread-visibility.ts`）
 * 内部的 `projectLayerAllowed = actorUserId === thread.createdBy`。
 *
 * ⚠ **两处不是「不小心抄了两遍」，但也不该被误读成两道独立防线**：单独删掉
 *   任意一处，另一处仍然正确拒绝——反证时曾先只删这一行的早退，
 *   `personal-thread-no-project.test.ts` §3① 依旧 15/15 绿，因为
 *   `decidePersonalThreadRead` 把同一条规则又算了一遍，`decision.allowed`
 *   照样为 false。**必须两处同时删掉才会红**（已验证：3 条红，见 PR 正文）。
 *   这里留着这一行**不是**因为它独自扛着安全边界，是提前短路省一次
 *   `authorize()` 调用——真正的权威判据只有一处，在 `decidePersonalThreadRead`。
 *   下面这一行删掉本身不构成回归，但留着更快，所以留着。
 *
 * ## 组织层为什么还要查一次
 *
 * 创建者身份不因离职而消失（历史数据），但「他现在还能不能读」是另一件事——
 * 与项目分支「组织层先判」的顺序一致（`decide()` 的 `orgPassed`）。这里复用同一个
 * `authorize()`，**省去 `projectId`**（不是传空字符串）：这正是 phase-00 `decide()`
 * 早已支持的 I-11「无项目上下文」形状——`project: null` ⇒ `projectLayer` 不参与判定，
 * 只剩组织层。不是新发明一条判定路径，是喂给一个已签核函数一种它本来就支持的输入。
 */
async function resolvePersonalVisibility(
  deps: ResolveVisibilityDeps,
  input: { readonly userId: string; readonly orgId: OrgId; readonly threadId: string },
): Promise<VisibilityOutcome> {
  const { repo, ids, chat } = deps;
  const { userId, orgId, threadId } = input;

  let thread: ThreadFacts | null;
  try {
    thread = await chat.findThreadFacts(orgId, threadId);
  } catch {
    throw new AuthzUnavailableError();
  }

  if (thread === null) return { kind: "not-found", decisionId: ids.next() };
  // 门①：这条线程其实挂着一个真实项目——personal 路径没有资格代答，一律当不存在。
  if (thread.projectId !== null) return { kind: "not-found", decisionId: ids.next() };
  // 门②：I-3——非创建者与「不存在」同一出口。**在查组织层之前**就短路，
  // 理由同项目分支「不存在就不必再判权」的顺序：没有必要为一个注定要拒的请求
  // 多打一次身份查询，且提前返回让「谁能看见 not-found」这件事只有一处判据。
  if (thread.createdBy !== userId) return { kind: "not-found", decisionId: ids.next() };

  const actor: ActorFacts = { userId, projectRole: null, groupId: null };

  let base: PermissionDecision;
  try {
    base = await authorize(
      { repo, ids },
      {
        userId,
        orgId,
        // ⚠ 没有 `projectId` 字段（不是 `projectId: undefined` 显式写出——
        //   两者对 `authorizeBatch` 效果相同，但省略更如实：这次判定压根不知道
        //   项目这回事）。`object` 给一个恒无绑定行的合成 id，触发默认 org-wide
        //   scope（同 `authorize.ts` `DEFAULT_SCOPE` 的既有先例），不代表任何真实资源。
        object: { kind: "project", id: `personal:${userId}` },
        action: "read.published",
      },
    );
  } catch {
    throw new AuthzUnavailableError();
  }

  const decision = decidePersonalThreadRead({
    thread, actorUserId: userId, orgLayerAllowed: base.orgLayer.passed,
  });
  const merged: PermissionDecision = { ...base, allowed: decision.allowed };
  const outcome = { decisionId: base.decisionId, decision, thread, actor, base: merged } as const;
  return decision.allowed ? { kind: "allow", ...outcome } : { kind: "denied", ...outcome };
}
