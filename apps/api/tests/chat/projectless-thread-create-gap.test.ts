/**
 * #594 —— 「无项目也应该能发起对话」撞上的**契约与实现的矛盾**，钉在这里。
 *
 * ## 这个文件不是修复，是把缺口变成一件会说话的东西
 *
 * #594 的产品预期是「Chat 是独立入口，不强制先建项目」。落地时发现它**不是**一个
 * 前端拦截：`chat` 束的整条授权链是**项目成员资格**形状的，而这条链的每一环都已签核。
 *
 * 本文件用三条断言把矛盾的**确切位置**钉住，而不是绕过它：
 *
 *   ① 正样本 —— 带 `projectId` 且持有项目角色时，建线程**真的成功**、真的落库。
 *      ⚠ 它存在的唯一理由是「防空转」：没有它，②③ 在一个根本跑不起来的调用路径上
 *        也会全绿（抛任何异常都满足「抛了」）。①绿 ⇒ ②的红是**这一条规则**造成的。
 *
 *   ② 缺口 —— 同一个人、同一次调用，只把 `projectId` 换成 `null`，
 *      `createThread` 立刻抛 `ThreadNotVisibleError`（`mutate-thread.ts` 第一行判断），
 *      **且不落库、不写审计**——连「被拒尝试」的痕迹都没有，因为那一行 return 在
 *      成员资格查询之前。
 *
 *   ③ 矛盾本身 —— 契约 `mutateThread.in.projectId` 是 `z.string().nullable()`：
 *      **契约允许 null，实现拒绝 null**。这不是我发明的字段，是契约里已经有的取值
 *      落不了地。③ 是 ② 的「为什么这是缺口而不是正确行为」的全部依据。
 *
 * ## 谁会让这里变红，那正是提醒
 *
 * 有人扩展实现让 `projectId: null` 可用时，② 当场变红，接手的人会被带到这里，
 * 读到下面这份「为什么不能顺手把那一行删掉」的清单：
 *
 *   · `resolveVisibility`（**每一个对话读端口的前置，没有例外**）的入参
 *     `projectId: z.string()` 非空，判定实现 `resolveVisibility.ts` 亦然；
 *   · `listThreads` 的 path 是 `/chat/projects/:projectId/threads`——projectId 在 **URL 路径**上，
 *     不是可选查询参数；
 *   · `getThread.out.thread.projectId` 是 `z.string()` 非空；
 *   · 写权来源是 `findProjectMembership(userId, projectId, orgId)`，`null` 角色 ⇒ `NO_WRITE_ROLE`；
 *   · `ChatVisibility` 五值全部是项目/分组语义（`group-shared` / `plenary` / …）。
 *
 * ⇒ 「projectId 可为 null」不是一处放宽，是**换掉整条授权链**。那是已签核契约面的修订，
 *   按 ADR-023 属人类动作。本文件**不选边**，只把矛盾原样报上去。
 *
 * ## 那条「隐式个人工作区默认项目」的替代设计也不通（同样已签核）
 *
 *   · U-4 裁 A（`domain/project/create-project-rules.ts` 的 `canCreateProject`）：
 *     **只有组织角色 `lead` 能建项目，`admin` 不能**。而核心闭环步骤 1 断言
 *     「第一个用户在正式组织里必须是 **admin**」⇒ 新注册用户连项目都建不出来。
 *   · Q-4②（`create-project.ts`「刻意不做的三件事」第 1 条）：
 *     **创建项目不给创建者授予任何项目角色**。⇒ 就算建出来，`findProjectMembership`
 *     仍返回 null，对话写路径照样 `NO_WRITE_ROLE`。
 *
 * ## 反证（写完门控立刻造反证）
 *
 * 把 `application/chat/mutate-thread.ts` 里 `createThread` 开头那一行
 * `if (projectId === null) throw new ThreadNotVisibleError();` 删掉，
 * ② 的三条断言必须当场变红（它会走到 `findProjectMembership(userId, null, …)`）。
 * 若不红，说明 ② 打的不是那一行。
 */
import { describe, expect, it, vi } from "vitest";
import { chat as C } from "@repo/contracts";
import { mutateThread, type MutateThreadDeps } from "../../src/application/chat/mutate-thread";
import { ThreadNotVisibleError } from "../../src/application/chat/get-thread";
import { toOrgId } from "../../src/domain/org-id";

const ORG = toOrgId("org-i594");
const PROJECT = "proj-i594";
const USER = "u-i594";

/**
 * 只造 `createThread` 这条路径真正会碰到的四个端口。
 *
 * ⚠ 刻意**不**用真库：本文件断言的是「哪一行判断挡住了 null」，而那一行在任何
 *   数据库状态下都同样执行。起 docker 栈不会让这条断言更真，只会让它更慢更脆。
 *   落库这件事本身由 `tests/chat/message-write-roundtrip.test.ts` 那一路真库用例守着。
 */
function fakes() {
  const createThread = vi.fn(async (_row: Record<string, unknown>) => {});
  const append = vi.fn(async (_event: Record<string, unknown>) => "prov-1");
  const findProjectMembership = vi.fn(
    async (_userId: string, _projectId: string, _orgId: string) => ({ projectRole: "facilitator" }),
  );
  const deps = {
    repo: { findProjectMembership },
    chat: { createThread },
    provenance: { append },
    artifactIds: { next: (prefix: string) => `${prefix}-i594` },
    ids: { next: (prefix: string) => `${prefix}-i594` },
  } as unknown as MutateThreadDeps;
  return { deps, createThread, append, findProjectMembership };
}

/** 契约 `mutateThread.in` 的请求体。`userId` / `orgId` 不在里面——它们来自 principal。 */
const body = (projectId: string | null) => ({
  op: "create" as const,
  projectId,
  threadId: null,
  groupId: null,
  title: "无项目也想聊的一条会话",
  visibilityScope: null,
  expectedVersion: null,
  reason: null,
});

const input = (projectId: string | null) => ({
  userId: USER,
  orgId: ORG,
  op: "create" as const,
  projectId,
  threadId: null,
  groupId: null,
  title: "无项目也想聊的一条会话",
  visibilityScope: null,
  expectedVersion: null,
  reason: null,
});

describe("#594：正样本——带项目上下文时这条创建路径是活的", () => {
  it("持有项目角色 + 有 projectId ⇒ 建线程成功并落库", async () => {
    const { deps, createThread, append } = fakes();

    const result = await mutateThread(deps, input(PROJECT));

    // 不只断言「没抛」：断言它**真的把这条线程交给了仓储**，而且带着那个 projectId。
    expect(createThread).toHaveBeenCalledTimes(1);
    expect(createThread.mock.calls[0]![0]).toMatchObject({ orgId: ORG, projectId: PROJECT });
    expect(append).toHaveBeenCalledTimes(1);
    expect(result.threadId).toBe("thr-i594");
  });
});

describe("#594：缺口——同一次调用，只把 projectId 换成 null 就走不通", () => {
  it("projectId=null ⇒ ThreadNotVisibleError（不是 NO_WRITE_ROLE，也不是别的码）", async () => {
    const { deps } = fakes();

    await expect(mutateThread(deps, input(null))).rejects.toBeInstanceOf(ThreadNotVisibleError);
  });

  it("而且是**零副作用**的拒绝：不落库、不查成员资格、连被拒审计都没有", async () => {
    const { deps, createThread, append, findProjectMembership } = fakes();

    await expect(mutateThread(deps, input(null))).rejects.toThrow();

    // 这三条一起才说明「挡在最前面那一行」，而不是「走到某处失败了」。
    // ⚠ `append` 为 0 尤其要紧：`auditRefusal` 在别的拒绝路径上**一定**会写一条
    //   `unauthorized-attempt`（V8）。这里一条都没有 ⇒ 拒绝发生在成员资格判定之前。
    expect(createThread).not.toHaveBeenCalled();
    expect(findProjectMembership).not.toHaveBeenCalled();
    expect(append).not.toHaveBeenCalled();
  });
});

describe("#594：矛盾在契约与实现之间，不是我发明的字段", () => {
  it("契约 mutateThread.in 接受 projectId=null —— 实现却拒绝它", () => {
    const parsed = C.operations.mutateThread.in.safeParse(body(null));

    // 契约这一侧是绿的。上面那一组是红的。两者之差就是 #594 的全部内容。
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("与之对照：resolveVisibility.in.projectId **不接受** null —— 授权链是项目形状的", () => {
    const parsed = C.operations.resolveVisibility.in.safeParse({
      actorId: USER,
      projectId: null,
      threadId: null,
      resourceKind: "thread",
    });

    // 这条是上一条的配对反例：它证明「契约允许 null」不是全局成立，
    // 而恰恰只在写端口的一个字段上成立 —— 所以放宽实现并不足以让 chat 脱离项目。
    expect(parsed.success).toBe(false);
  });
});
