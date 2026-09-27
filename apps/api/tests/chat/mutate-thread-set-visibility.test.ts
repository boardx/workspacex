/**
 * 项目中枢 R5 —— `mutateThread` op=setVisibility（分享 = 改项目线程的可见范围）。
 *
 * 纯 application 层，喂 in-memory 假仓储（同 `get-thread-citations.test.ts` 只 mock 网络边界的做法）。
 * 钉住：创建者 / 引导师能改；别的组员不能（且被拒写审计）；只对项目线程、只在三档之内；
 * 乐观并发不静默覆盖；审计类型是 `thread-visibility-changed` 且 detail 记 from / to。
 */
import { describe, expect, it } from "vitest";
import {
  mutateThread,
  NoWriteRoleError,
  VersionChangedError,
  VisibilityScopeInvalidError,
  type MutateThreadDeps,
  type MutateThreadInput,
} from "../../src/application/chat/mutate-thread";
import type { ChatRepository } from "../../src/application/chat/ports";
import type { ThreadFacts } from "../../src/domain/chat/thread-visibility";
import { FakeProvenanceWriter, FakeRoleViewRepository } from "../support/role-view-fakes";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-r5");
const PROJECT = "p-r5";

class FakeChat {
  calls: Array<{ threadId: string; scope: string; expectedVersion: number }> = [];
  constructor(private readonly facts: ThreadFacts | null, private readonly currentVersion = 3) {}
  async findThreadFacts(): Promise<ThreadFacts | null> { return this.facts; }
  async setThreadVisibility(_o: unknown, threadId: string, scope: ThreadFacts["visibilityScope"], expectedVersion: number) {
    this.calls.push({ threadId, scope, expectedVersion });
    return expectedVersion === this.currentVersion ? expectedVersion + 1 : null;
  }
}

const thread = (over: Partial<ThreadFacts> = {}): ThreadFacts => ({
  threadId: "t1", projectId: PROJECT, groupId: "g1", visibilityScope: "group-shared", createdBy: "u-creator", archived: false, ...over,
});

function deps(chat: FakeChat, members: Record<string, { orgRole: "consultant"; projectRole: "facilitator" | "groupLead" | "member" | "observer" | null; groupId?: string | null }>) {
  const provenance = new FakeProvenanceWriter();
  const d: MutateThreadDeps = {
    chat: chat as unknown as ChatRepository,
    repo: new FakeRoleViewRepository(members),
    ids: { next: () => "dec" } as never,
    provenance,
    artifactIds: { next: () => "a" } as never,
  };
  return { d, provenance };
}

function input(userId: string, scope: string | null, over: Partial<MutateThreadInput> = {}): MutateThreadInput {
  return {
    userId, orgId: ORG, op: "setVisibility", projectId: PROJECT, threadId: "t1", groupId: null, title: null,
    visibilityScope: scope, expectedVersion: 3, reason: null, ...over,
  };
}

describe("mutateThread op=setVisibility（分享）", () => {
  it("创建者把本组共享改成全场：落库 + 审计 thread-visibility-changed（detail 记 from/to）", async () => {
    const chat = new FakeChat(thread());
    const { d, provenance } = deps(chat, { "u-creator": { orgRole: "consultant", projectRole: "member", groupId: "g1" } });
    const out = await mutateThread(d, input("u-creator", "plenary"));
    expect(out.version).toBe(4);
    expect(chat.calls).toEqual([{ threadId: "t1", scope: "plenary", expectedVersion: 3 }]);
    const ev = provenance.appended.at(-1)!;
    expect(ev.type).toBe("thread-visibility-changed");
    expect(ev.detail).toMatchObject({ projectId: PROJECT, from: "group-shared", to: "plenary", version: 4 });
  });

  it("引导师（非创建者）也能改", async () => {
    const chat = new FakeChat(thread());
    const { d } = deps(chat, { "u-fac": { orgRole: "consultant", projectRole: "facilitator", groupId: null } });
    await expect(mutateThread(d, input("u-fac", "member-private"))).resolves.toMatchObject({ version: 4 });
  });

  it("同组的其他组员：看得见但不能分享 ⇒ NO_WRITE_ROLE，不落库，且被拒写审计", async () => {
    const chat = new FakeChat(thread());
    const { d, provenance } = deps(chat, { "u-other": { orgRole: "consultant", projectRole: "member", groupId: "g1" } });
    await expect(mutateThread(d, input("u-other", "plenary"))).rejects.toBeInstanceOf(NoWriteRoleError);
    expect(chat.calls).toHaveLength(0);
    expect(provenance.appended.at(-1)?.type).toBe("unauthorized-attempt");
  });

  it.each([null, "team-visible", "private"])("目标范围 %s 不在三档内 ⇒ VisibilityScopeInvalidError", async (scope) => {
    const chat = new FakeChat(thread());
    const { d } = deps(chat, { "u-creator": { orgRole: "consultant", projectRole: "member", groupId: "g1" } });
    await expect(mutateThread(d, input("u-creator", scope))).rejects.toBeInstanceOf(VisibilityScopeInvalidError);
    expect(chat.calls).toHaveLength(0);
  });

  it("版本不匹配 ⇒ VERSION_CHANGED，不静默覆盖", async () => {
    const chat = new FakeChat(thread(), 7);
    const { d } = deps(chat, { "u-creator": { orgRole: "consultant", projectRole: "member", groupId: "g1" } });
    await expect(mutateThread(d, input("u-creator", "plenary"))).rejects.toBeInstanceOf(VersionChangedError);
  });
});
