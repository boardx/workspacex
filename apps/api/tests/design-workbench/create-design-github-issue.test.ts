/**
 * 2026-09-05「转开发」—— `createDesignGithubIssue` 用例：前置条件、认领/回填、失败路径。
 * 全部内存 fake，不碰真实数据库（同 `project-lifecycle.test.ts` 的写法）。
 */
import { describe, expect, it, vi } from "vitest";
import {
  createDesignGithubIssue,
  DesignIssueAlreadyExistsError,
  DesignIssueCreationFailedError,
  DesignIssueInProgressError,
  DesignProjectNotPushedError,
  type CreateDesignGithubIssueDeps,
} from "../../src/application/design-workbench/create-design-github-issue";
import {
  DesignProjectNotFoundError,
  DesignProjectNotOwnerError,
} from "../../src/application/design-workbench/project-shared";
import { GithubIssueCreationError, type GithubIssueCreator } from "../../src/application/feedback/notification-ports";
import { toOrgId } from "../../src/domain/org-id";
import { FakeDesignProjectRepo, designProjectRow } from "../support/fake-design-project-repo";

const DRAFT = { title: "重设计导出流程", body: "正文", labels: ["design-handoff"] };
const OWNER = "u-owner";

function fakeGithub(over: Partial<GithubIssueCreator> = {}): GithubIssueCreator {
  return {
    create: vi.fn(async () => ({ url: "https://github.com/boardx/workspacex/issues/77", number: 77 })),
    setState: vi.fn(),
    getStatus: vi.fn(),
    addComment: vi.fn(),
    listComments: vi.fn(),
    ...over,
  } as unknown as GithubIssueCreator;
}

function deps(
  projects: FakeDesignProjectRepo,
  githubIssues: GithubIssueCreator = fakeGithub(),
): CreateDesignGithubIssueDeps {
  return {
    projects,
    orgId: toOrgId("org-1"),
    githubIssues,
    submitters: {
      emailForUserId: async () => null,
      displayNamesForUserIds: async (ids) => new Map(ids.map((id) => [id, `名字-${id}`])),
    },
  };
}

/** 已推送、还没有 issue 的方案——正常路径的起点。 */
function pushedRepo(): FakeDesignProjectRepo {
  const projects = new FakeDesignProjectRepo();
  projects.seed(designProjectRow({ id: "dp-1", ownerId: OWNER, pushed: true, pushedAt: "2026-09-05T00:00:00.000Z" }));
  return projects;
}

describe("createDesignGithubIssue -- 正常路径", () => {
  it("建 issue 并把 url/number 回填到项目上", async () => {
    const projects = pushedRepo();
    const github = fakeGithub();
    const out = await createDesignGithubIssue(deps(projects, github), {
      projectId: "dp-1",
      ownerId: OWNER,
      draft: DRAFT,
    });
    expect(out.project.githubIssueNumber).toBe(77);
    expect(out.project.githubIssueUrl).toBe("https://github.com/boardx/workspacex/issues/77");
    expect(projects.rows.get("dp-1")!.githubIssueNumber).toBe(77);
  });

  it("draft 原样交给 GitHub——不用方案内容覆盖人类改过的标题/正文", async () => {
    const projects = pushedRepo();
    const github = fakeGithub();
    const edited = { title: "人类改过的标题", body: "人类改过的正文", labels: ["x"] };
    await createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: OWNER, draft: edited });
    expect(github.create).toHaveBeenCalledWith(edited);
  });

  it("建之前先认领（并发保护真的走了那一步）", async () => {
    const projects = pushedRepo();
    await createDesignGithubIssue(deps(projects), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT });
    expect(projects.claimCalls).toEqual(["dp-1"]);
    expect(projects.releaseCalls).toEqual([]);
  });
});

describe("createDesignGithubIssue -- 前置条件", () => {
  it("项目不存在 ⇒ DesignProjectNotFoundError，不碰 GitHub", async () => {
    const github = fakeGithub();
    await expect(
      createDesignGithubIssue(deps(new FakeDesignProjectRepo(), github), {
        projectId: "missing",
        ownerId: OWNER,
        draft: DRAFT,
      }),
    ).rejects.toBeInstanceOf(DesignProjectNotFoundError);
    expect(github.create).not.toHaveBeenCalled();
  });

  it("不是 owner ⇒ DesignProjectNotOwnerError，不碰 GitHub", async () => {
    const projects = pushedRepo();
    const github = fakeGithub();
    await expect(
      createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: "u-other", draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignProjectNotOwnerError);
    expect(github.create).not.toHaveBeenCalled();
  });

  it("还没推送到收件箱 ⇒ DesignProjectNotPushedError，不碰 GitHub", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(designProjectRow({ id: "dp-1", ownerId: OWNER, pushed: false }));
    const github = fakeGithub();
    await expect(
      createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignProjectNotPushedError);
    expect(github.create).not.toHaveBeenCalled();
  });

  it("已经有 issue ⇒ DESIGN_ISSUE_ALREADY_EXISTS，不建第二张（不 upsert、不静默返回已有的）", async () => {
    const projects = new FakeDesignProjectRepo();
    projects.seed(
      designProjectRow({
        id: "dp-1",
        ownerId: OWNER,
        pushed: true,
        githubIssueUrl: "https://github.com/o/r/issues/1",
        githubIssueNumber: 1,
      }),
    );
    const github = fakeGithub();
    await expect(
      createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignIssueAlreadyExistsError);
    expect(github.create).not.toHaveBeenCalled();
  });
});

describe("createDesignGithubIssue -- 并发与失败", () => {
  it("认领没抢到 ⇒ DESIGN_ISSUE_IN_PROGRESS，不调 GitHub（不重复建票）", async () => {
    const projects = pushedRepo();
    projects.claimUnavailable = true;
    const github = fakeGithub();
    await expect(
      createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignIssueInProgressError);
    expect(github.create).not.toHaveBeenCalled();
  });

  it("GitHub 建失败 ⇒ 释放认领 + DESIGN_ISSUE_CREATION_FAILED，库里不留半个 issue", async () => {
    const projects = pushedRepo();
    const github = fakeGithub({
      create: vi.fn(async () => {
        throw new GithubIssueCreationError(503);
      }),
    });
    await expect(
      createDesignGithubIssue(deps(projects, github), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignIssueCreationFailedError);
    expect(projects.releaseCalls).toEqual(["dp-1"]);
    expect(projects.rows.get("dp-1")!.githubIssueNumber).toBeNull();
  });

  it("释放认领之后可以重试成功（认领不是一次性的死锁）", async () => {
    const projects = pushedRepo();
    const failing = fakeGithub({
      create: vi.fn(async () => {
        throw new GithubIssueCreationError(500);
      }),
    });
    await expect(
      createDesignGithubIssue(deps(projects, failing), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT }),
    ).rejects.toBeInstanceOf(DesignIssueCreationFailedError);

    const out = await createDesignGithubIssue(deps(projects), { projectId: "dp-1", ownerId: OWNER, draft: DRAFT });
    expect(out.project.githubIssueNumber).toBe(77);
  });
});
