/**
 * UC-17.8 B4.3 —— 六个设计项目用例的正反例，全部用内存 fake（同
 * `tests/feedback/draft-lifecycle.test.ts` 的写法），不碰真实数据库。
 */
import { describe, expect, it, vi } from "vitest";
import { createProject } from "../../src/application/design-workbench/create-project";
import { listMyProjects } from "../../src/application/design-workbench/list-my-projects";
import { updateProject } from "../../src/application/design-workbench/update-project";
import { appendProjectChat } from "../../src/application/design-workbench/append-project-chat";
import { deleteProject } from "../../src/application/design-workbench/delete-project";
import { pushToInbox } from "../../src/application/design-workbench/push-to-inbox";
import {
  DesignProjectNameRequiredError,
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
  type DesignProjectDeps,
} from "../../src/application/design-workbench/project-shared";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";
import { designWorkbench as C } from "@repo/contracts";

function deps(projects: FakeDesignProjectRepo = new FakeDesignProjectRepo()): DesignProjectDeps {
  return {
    projects,
    orgId: toOrgId("org-1"),
    submitters: {
      emailForUserId: async () => null,
      displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, `名字-${id}`])),
    },
  };
}

describe("createProject", () => {
  it("服务端填 criteria/frames 快照，chat 恒为 []", async () => {
    const repo = new FakeDesignProjectRepo();
    const out = await createProject(
      { ...deps(repo), newProjectId: () => "dp-1" },
      { ownerId: "u-1", name: "登录改版", template: "wireframe" },
    );
    expect(out.project.criteria).toEqual(C.DESIGN_PROJECT_INITIAL_CRITERIA);
    expect(out.project.frames).toEqual(C.DESIGN_PROJECT_INITIAL_FRAMES);
    expect(out.project.chat).toEqual([]);
    expect(out.project.pushed).toBe(false);
    expect(out.project.ownerName).toBe("名字-u-1");
  });

  it("name 为空白 ⇒ DesignProjectNameRequiredError", async () => {
    await expect(
      createProject({ ...deps(), newProjectId: () => "dp-1" }, { ownerId: "u-1", name: "   ", template: "ui" }),
    ).rejects.toBeInstanceOf(DesignProjectNameRequiredError);
  });

  it("linkedFeedbackId 传入即写入投影（B4.4「深化」的落点，本轮只校验透传）", async () => {
    const repo = new FakeDesignProjectRepo();
    const out = await createProject(
      { ...deps(repo), newProjectId: () => "dp-1" },
      { ownerId: "u-1", name: "深化项目", template: "wireframe", linkedFeedbackId: "fb-9" },
    );
    expect(out.project.linkedFeedbackId).toBe("fb-9");
  });
});

describe("listMyProjects", () => {
  it("按 ownerId 过滤（全组织可读的仓储 + 应用层「我的」过滤）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-mine", ownerId: "u-1", name: "我的项目" }));
    repo.seed(designProjectRow({ id: "dp-other", ownerId: "u-2", name: "别人的项目" }));

    const mine = await listMyProjects(deps(repo), { ownerId: "u-1" });
    expect(mine.map((p) => p.id)).toEqual(["dp-mine"]);
  });

  it("`q` 按名称过滤（大小写不敏感）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", name: "Login Redesign" }));
    repo.seed(designProjectRow({ id: "dp-2", ownerId: "u-1", name: "结算流程" }));

    const out = await listMyProjects(deps(repo), { ownerId: "u-1", q: "login" });
    expect(out.map((p) => p.id)).toEqual(["dp-1"]);
  });
});

describe("updateProject", () => {
  it("owner 可改 name/template/problem，不改 criteria/frames/chat", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", criteria: ["c1"], frames: ["f1"] }));

    const out = await updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", name: "改名了" });
    expect(out.project.name).toBe("改名了");
    expect(out.project.criteria).toEqual(["c1"]);
    expect(out.project.frames).toEqual(["f1"]);
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-2", name: "改名了" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(
      updateProject(deps(), { projectId: "dp-missing", ownerId: "u-1", name: "x" }),
    ).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });

  it("name 传空白 ⇒ DesignProjectNameRequiredError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      updateProject(deps(repo), { projectId: "dp-1", ownerId: "u-1", name: "  " }),
    ).rejects.toBeInstanceOf(DesignProjectNameRequiredError);
  });
});

describe("appendProjectChat", () => {
  it("一次调用追加用户消息 + 固定回执两条", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));

    const out = await appendProjectChat(deps(repo), { projectId: "dp-1", ownerId: "u-1", text: "改一下颜色" });
    expect(out.project.chat).toHaveLength(2);
    expect(out.project.chat[0]).toMatchObject({ role: "user", text: "改一下颜色" });
    expect(out.project.chat[1]).toMatchObject({ role: "ai", text: C.DESIGN_WORKBENCH_CHAT_REPLY });
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      appendProjectChat(deps(repo), { projectId: "dp-1", ownerId: "u-2", text: "x" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });
});

describe("deleteProject", () => {
  it("owner 可删（未推送）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const out = await deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(out.projectId).toBe("dp-1");
    expect(await repo.get("dp-1")).toBeNull();
  });

  it("owner 可删（已推送——需求未对已推送项目设限）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", pushed: true }));
    const out = await deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(out.projectId).toBe("dp-1");
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(deleteProject(deps(repo), { projectId: "dp-1", ownerId: "u-2" })).rejects.toBeInstanceOf(
      DesignProjectNotOwnerError,
    );
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(deleteProject(deps(), { projectId: "dp-missing", ownerId: "u-1" })).rejects.toBeInstanceOf(
      DesignProjectNotFoundError,
    );
  });
});

describe("pushToInbox", () => {
  it("标记 pushed/pushedAt，回写来源反馈的 resolved_by_design_id", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: "fb-1" }));

    const out = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "给工程看看" });
    expect(out.project.pushed).toBe(true);
    expect(out.project.pushedAt).not.toBeNull();
    expect(out.inboxCode).toBe("D-1");
    expect(repo.resolvedFeedbackIds).toEqual(["fb-1"]);
  });

  it("linkedFeedbackId 为空时不触发反馈回写", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: null }));
    await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1" });
    expect(repo.resolvedFeedbackIds).toEqual([]);
  });

  it("幂等：重复推送更新同一条,inboxCode 不变,不产生第二条", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));

    const first = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "第一次" });
    const second = await pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-1", note: "第二次，改了说明" });

    expect(first.inboxCode).toBe(second.inboxCode);
    expect(repo.rows.size).toBe(1);
    expect((await repo.get("dp-1"))?.pushNote).toBe("第二次，改了说明");
  });

  it("编号按创建顺序：先创建的先推送不影响谁是 D-1（按 created_at,不是按推送顺序）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-old", ownerId: "u-1", createdAt: "2026-09-01T00:00:00.000Z" }));
    repo.seed(designProjectRow({ id: "dp-new", ownerId: "u-1", createdAt: "2026-09-02T00:00:00.000Z" }));

    // 后创建的先推送。
    const newFirst = await pushToInbox(deps(repo), { projectId: "dp-new", ownerId: "u-1" });
    expect(newFirst.inboxCode).toBe("D-1"); // 此刻只有它一条 pushed=true。

    const oldSecond = await pushToInbox(deps(repo), { projectId: "dp-old", ownerId: "u-1" });
    // 现在两条都 pushed=true，按 created_at 排序：dp-old 在前 ⇒ D-1，dp-new 变成 D-2。
    expect(oldSecond.inboxCode).toBe("D-1");
  });

  it("非 owner ⇒ DesignProjectNotOwnerError", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    await expect(
      pushToInbox(deps(repo), { projectId: "dp-1", ownerId: "u-2" }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
  });

  it("不存在 ⇒ DesignProjectNotFoundError", async () => {
    await expect(
      pushToInbox(deps(), { projectId: "dp-missing", ownerId: "u-1" }),
    ).rejects.toBeInstanceOf(DesignProjectNotFoundError);
  });
});

/* ── UC-17.8 B6.4 可观测性：推送事务一条结构化日志（fake logger 断言字段存在） ── */
describe("pushToInbox 可观测性（B6.4）", () => {
  function fields(logger: { info: ReturnType<typeof vi.fn> }, nth = 0): Record<string, unknown> {
    const [msg, f] = logger.info.mock.calls[nth] as [string, Record<string, unknown>];
    expect(msg).toBe("design-workbench: pushToInbox");
    return f;
  }

  it("首次推送：projectId / ownerId / resolvedFeedback / repeatPush=false / inboxCode / 耗时 / traceId", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: "fb-1" }));
    const logger = { info: vi.fn(), error: vi.fn() };

    await pushToInbox({ ...deps(repo), logger, traceId: "trace-push" }, { projectId: "dp-1", ownerId: "u-1", note: "给工程看看" });

    expect(logger.info).toHaveBeenCalledTimes(1);
    const f = fields(logger);
    expect(f).toMatchObject({
      traceId: "trace-push",
      orgId: "org-1",
      projectId: "dp-1",
      ownerId: "u-1",
      repeatPush: false,
      linkedFeedback: true,
      resolvedFeedback: true,
      notePresent: true,
      inboxCode: "D-1",
    });
    expect(typeof f.transactionMs).toBe("number");
    expect(typeof f.durationMs).toBe("number");
    // 不记 note 正文 / 项目名
    expect(JSON.stringify(f)).not.toContain("给工程看看");
  });

  it("重复推送（upsert 命中）⇒ repeatPush=true；无来源反馈 ⇒ linkedFeedback=false、resolvedFeedback=false", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1", linkedFeedbackId: null }));
    const logger = { info: vi.fn(), error: vi.fn() };
    const d = { ...deps(repo), logger };

    await pushToInbox(d, { projectId: "dp-1", ownerId: "u-1" });
    await pushToInbox(d, { projectId: "dp-1", ownerId: "u-1", note: "第二次" });

    expect(fields(logger, 0)).toMatchObject({ repeatPush: false, linkedFeedback: false, resolvedFeedback: false, notePresent: false });
    expect(fields(logger, 1)).toMatchObject({ repeatPush: true, notePresent: true, inboxCode: "D-1" });
  });

  it("非 owner / 不存在 ⇒ 抛错且不记 info（失败路径由 AllExceptionsFilter 按 traceId 记）", async () => {
    const repo = new FakeDesignProjectRepo();
    repo.seed(designProjectRow({ id: "dp-1", ownerId: "u-1" }));
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(pushToInbox({ ...deps(repo), logger }, { projectId: "dp-1", ownerId: "u-2" })).rejects.toBeInstanceOf(
      DesignProjectNotOwnerError,
    );
    expect(logger.info).not.toHaveBeenCalled();
  });
});
