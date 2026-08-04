/**
 * #489 —— `listThreads` 必须下发**项目级** capabilities，且在**零会话**时也下发。
 *
 * ## 这个文件存在的理由是一条实测死路
 *
 * 写权的唯一来源本来是 `getThread.out.capabilities`。而 `getThread` 只在**选中某条
 * 线程**时才被调用 ⇒ 一个**零会话**的项目里它一次都不会被调用 ⇒ 前端拿不到任何
 * 写权依据 ⇒「新建会话」按钮不渲染 ⇒ **新注册的管理员永远建不出第一条会话**。
 * 「注册 → 登录 → Chat 新增 → 聊天」死在第三步。
 *
 * 所以本文件最关键的一条断言，前提是 **`groups: []`**：有线程时旧实现也能过。
 *
 * ## 单一事实源
 *
 * 两个读端口下发的是**同一个** `capabilitiesFor(projectRole)`，不是两套判定。
 * 下面「同一个人在两个端口拿到同一份集合」那条就是钉这件事的——它一旦变红，
 * 说明有人在某一侧重新实现了一遍权限。
 *
 * ## 反证（写完门控立刻造反证）
 *
 * 把 `application/chat/list-threads.ts` 里 `capabilities` 的来源从
 * `capabilitiesFor(membership?.projectRole ?? null)` 改成写死的空数组，
 * 「引导师拿得到 thread.mutate」与「两个端口一致」必须当场变红。
 * 若不红，说明断言打的不是响应体。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { chat as C } from "@repo/contracts";
import {
  addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-i489-caps";
const PROJECT = "proj-i489-caps";

let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG}` });

const listThreads = (userId: string) =>
  fetch(`${BASE}/chat/projects/${PROJECT}/threads`, { headers: as(userId) });

const readThread = (userId: string, threadId: string) =>
  fetch(`${BASE}/chat/threads/${threadId}?projectId=${PROJECT}`, { headers: as(userId) });

type ListOut = { groups: { label: string; cards: { id: string }[] }[]; capabilities: string[] };

async function listBody(userId: string): Promise<ListOut> {
  const res = await listThreads(userId);
  expect(res.status, `${userId} 列会话`).toBe(200);
  return (await res.json()) as ListOut;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 180_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-fac", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null);
  await addOrgMember(ORG, "u-obs", "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-obs", "observer", null);
  // 显式 60s：默认 10s 的 hook 超时在全量并行下会把「机器忙」报成「红」。
}, 60_000);

describe("#489：零会话的项目里也拿得到写权依据", () => {
  it("零会话时 groups 为空，但 capabilities 照常下发且含 thread.mutate", async () => {
    const body = await listBody("u-fac");

    // 前提：这条断言只有在**真的没有会话**时才有意义。
    expect(body.groups).toEqual([]);
    expect(body.capabilities).toContain("thread.mutate");
  });

  it("零会话 + 观察者：capabilities 里一条写能力都没有（否则上一条会退化成「空就放行」）", async () => {
    const body = await listBody("u-obs");

    expect(body.groups).toEqual([]);
    expect(body.capabilities).not.toContain("thread.mutate");
    // 降级不是拒绝：读能力仍在。
    expect(body.capabilities).toContain("thread.read");
  });

  it("完全没有项目角色的人：capabilities 为空集，不是「默认给读」", async () => {
    await addOrgMember(ORG, "u-outsider", "consultant", fx.teams.energy!);
    // 刻意不 addProjectMember：他在组织里，但不在这个项目里。
    const body = await listBody("u-outsider");

    expect(body.capabilities).toEqual([]);
  });
});

describe("#489：两个读端口是同一个事实源", () => {
  it("有会话时，同一个人在 listThreads 与 getThread 拿到同一份集合", async () => {
    await addChatThread({
      orgId: ORG, id: "t-caps", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac",
    });

    const list = await listBody("u-fac");
    const detail = (await (await readThread("u-fac", "t-caps")).json()) as { capabilities: string[] };

    // 比较集合而不是数组顺序：断言的是「同一份事实」，不是「同一种排法」。
    expect([...list.capabilities].sort()).toEqual([...detail.capabilities].sort());
    // 配对：确认这次比较不是「两个空集相等」这种平凡为真。
    expect(list.capabilities.length).toBeGreaterThan(0);
  });

  it("观察者在两个端口也一致（一致性不能只对有写权的人成立）", async () => {
    await addChatThread({
      orgId: ORG, id: "t-caps2", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac",
    });

    const list = await listBody("u-obs");
    const detail = (await (await readThread("u-obs", "t-caps2")).json()) as { capabilities: string[] };

    expect([...list.capabilities].sort()).toEqual([...detail.capabilities].sort());
    expect(list.capabilities.length).toBeGreaterThan(0);
  });
});

describe("#489：响应仍然符合契约", () => {
  it("零会话与有会话两种响应都过 listThreads.out 的 strict schema", async () => {
    const empty = await listBody("u-fac");
    const emptyParsed = C.operations.listThreads.out.safeParse(empty);
    expect(emptyParsed.success ? null : emptyParsed.error.issues, JSON.stringify(empty)).toBeNull();

    await addChatThread({
      orgId: ORG, id: "t-caps3", projectId: PROJECT, groupId: null,
      visibilityScope: "plenary", createdBy: "u-fac",
    });
    const filled = await listBody("u-fac");
    const filledParsed = C.operations.listThreads.out.safeParse(filled);
    expect(filledParsed.success ? null : filledParsed.error.issues, JSON.stringify(filled)).toBeNull();
  });
});
