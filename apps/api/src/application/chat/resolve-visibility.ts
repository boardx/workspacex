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
  readonly projectId: string;
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
