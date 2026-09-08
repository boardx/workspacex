/**
 * 迭代 13（design-delta `design-chat-inputs` §2）—— 「从对话导入」用得到的那几个 chat 读端口
 * 的内存 fake。
 *
 * ## 为什么 fake 的是**仓储**，不是判权
 *
 * `importThread` 要证明的事情是「只读得到调用者自己有权读的线程」（V56）。要让这条断言
 * 有意义，判权本身必须是**真的那一份**——`resolveVisibility` / `decideThreadRead` /
 * `decidePersonalThreadRead` 全部原样跑。所以这里只 fake 两个数据源（线程与消息在哪、
 * 谁是组织成员），判定逻辑一行不替。
 *
 * 换句话说：把 `importThread` 改成绕过 `resolveVisibility` 直接 `findMessages`，
 * 用这套 fake 的用例会**当场变红**——这正是 V56 的反证要求的形态。若这里连判权一起
 * fake 掉，那条用例就只是在断言「我的 fake 返回了我让它返回的东西」。
 *
 * 只实现被这条路径调到的方法；其余按 `ChatRepository` 的形状留给 `Partial` 转换，
 * 调到未实现的方法会当场抛，不会静默返回 undefined 假装成功。
 */
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { ChatMessageRow, ChatRepository, ThreadPresentation } from "../../src/application/chat/ports";
import type { OrgId } from "../../src/domain/org-id";
import type { ThreadFacts } from "../../src/domain/chat/thread-visibility";
import type {
  AclObjectRef,
  BindingRow,
  IdentityRepository,
  OrgMembershipRow,
  ProjectMembershipRow,
} from "../../src/application/identity/ports";

export interface FakeThread {
  readonly facts: ThreadFacts;
  readonly title: string;
  readonly bodies: readonly string[];
}

/** 一条个人线程（`projectId: null`，仅创建者可读）。导入的典型来源。 */
export function personalThread(over: {
  readonly threadId?: string;
  readonly createdBy?: string;
  readonly title?: string;
  readonly bodies?: readonly string[];
} = {}): FakeThread {
  return {
    facts: {
      threadId: over.threadId ?? "th-1",
      projectId: null,
      groupId: null,
      visibilityScope: "plenary",
      createdBy: over.createdBy ?? "u-owner",
      archived: false,
    },
    title: over.title ?? "会员下单那条线",
    bodies: over.bodies ?? ["我想做一个门店会员在线下单的东西", "谁会用？", "店里的老会员，主要是想省掉排队"],
  };
}

export class FakeChatThreadSource implements Partial<ChatRepository> {
  private readonly threads = new Map<string, FakeThread>();
  /** 断言用：`findMessages` 被调了几次（确认阶段也要重读一次，见 `import-thread.ts` 头注）。 */
  readonly messageReads: string[] = [];

  seed(thread: FakeThread): void {
    this.threads.set(thread.facts.threadId, thread);
  }

  /** 线程后来又聊了几句——V57 用它证明「线程变了，项目的 problem 不变」。 */
  append(threadId: string, body: string): void {
    const t = this.threads.get(threadId);
    if (t === undefined) throw new Error(`fake-chat-thread-source: no thread ${threadId}`);
    this.threads.set(threadId, { ...t, bodies: [...t.bodies, body] });
  }

  async findThreadFacts(_orgId: OrgId, threadId: string): Promise<ThreadFacts | null> {
    return this.threads.get(threadId)?.facts ?? null;
  }

  async findThreadPresentation(_orgId: OrgId, threadId: string): Promise<ThreadPresentation | null> {
    const t = this.threads.get(threadId);
    if (t === undefined) return null;
    return { phase: "onsite", lastActivityAt: "2026-09-08T00:00:00.000Z", version: 1, title: t.title };
  }

  async findMessages(_orgId: OrgId, threadId: string): Promise<Guarded<ChatMessageRow[]> | null> {
    const t = this.threads.get(threadId);
    if (t === undefined) return null;
    this.messageReads.push(threadId);
    const rows: ChatMessageRow[] = t.bodies.map((body, i) => ({
      id: `${threadId}-m${i}`,
      authorKind: i % 2 === 0 ? "human" : "agent",
      authorId: i % 2 === 0 ? t.facts.createdBy : "agent-1",
      agentId: i % 2 === 0 ? null : "agent-1",
      body,
      rawTranscript: false,
      visibilityScope: null,
      reviewPending: false,
      createdAt: `2026-09-08T00:00:0${i}.000Z`,
    }));
    // ref 同真实仓储：个人线程用一个恒无绑定行的合成 id。
    return guard({ kind: "project", id: t.facts.projectId ?? `personal:${threadId}` }, rows);
  }
}

/**
 * 组织成员目录的内存 fake。`authorize` 只用到三个方法（见 `authorize.ts` 的 `authorizeBatch`）。
 * 没有绑定行 ⇒ 走 `DEFAULT_SCOPE`（org-wide），与真实部署里"没人给这个对象设过范围"一致。
 */
export class FakeIdentityDirectory implements Partial<IdentityRepository> {
  constructor(private readonly orgMembers: ReadonlySet<string>) {}

  async findOrgMembership(userId: string, _orgId: OrgId): Promise<OrgMembershipRow | null> {
    return this.orgMembers.has(userId) ? { orgRole: "consultant", teamId: null } : null;
  }

  async findProjectMembership(_u: string, _p: string, _o: OrgId): Promise<ProjectMembershipRow | null> {
    return null;
  }

  async findBindings(_orgId: OrgId, _objects: readonly AclObjectRef[]): Promise<Map<string, BindingRow>> {
    return new Map();
  }
}

/** 判定 id 工厂——真实实现是 uuid，这里给可读的递增值，断言里用不到具体值。 */
export function fakeDecisionIds(): { next(): string } {
  let n = 0;
  return { next: () => `dec-${(n += 1)}` };
}
