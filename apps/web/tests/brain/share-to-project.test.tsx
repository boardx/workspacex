/**
 * phase-18 S10（issue #4367）——「分享到项目…」前端：先看范围、再确认；已分享的可撤回；失败如实说；
 * 项目记忆里分享来的条目在项目大脑与回答引用上都标「由 X 分享自个人记忆」。
 *
 * 网络在 `fetch` 这一层打桩（不替身 lib/knowledge-graph-share-api.ts）：请求路径、请求体、契约 `out` 校验、
 * 失败信封 → 错误码映射都是真代码在跑。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { KgRecalledMemory, knowledgeGraph, sharedFromPersonalLabelZh } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { projectOriginLabel } from "@/lib/knowledge-graph-recall";
import { ShareToProject } from "@/components/brain/share-to-project";
import { ProjectBrainPanel } from "@/components/project/project-brain-panel";
import { AnswerKnowledgeFooter } from "@/components/chat/knowledge/answer-knowledge-footer";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let fetchMock: ReturnType<typeof vi.fn>;
function stubNetwork(route: (path: string, init?: RequestInit) => Response | undefined): void {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const res = route(new URL(url, "http://localhost").pathname, init);
    if (!res) throw new Error(`unexpected fetch: ${url}`);
    return res;
  });
  vi.stubGlobal("fetch", fetchMock);
}
const posts = () => fetchMock.mock.calls
  .filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")
  .map(([u, init]) => [new URL(String(u), "http://localhost").pathname, JSON.parse(String((init as RequestInit).body))]);

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-s10");
});
afterEach(() => { vi.unstubAllGlobals(); });

const TARGETS_PATH = "/knowledge-graph/personal/claims/p-1/share-targets";
const targets = (sharedP1: string | null) => knowledgeGraph.listProjectShareTargets.out.parse({
  claimId: "p-1", statement: "客户 A 最看重交付确定性",
  targets: [
    { projectId: "prj-1", name: "新能源项目", audienceCount: 3, sharedClaimId: sharedP1,
      audience: [{ userId: "u-1", displayName: "李雷" }, { userId: "u-2", displayName: "韩梅梅" }, { userId: "u-3", displayName: "王观察" }] },
    { projectId: "prj-2", name: "储能项目", audienceCount: 2, sharedClaimId: "c-shared",
      audience: [{ userId: "u-1", displayName: "李雷" }, { userId: "u-4", displayName: "张三" }] },
  ],
});

describe("S10「分享到项目…」对话框", () => {
  it("先看范围再确认：选中项目列出谁会看到；确认后 POST share（只带 projectId），并重读目标", async () => {
    let shared: string | null = null;
    stubNetwork((p, init) => {
      if (p === TARGETS_PATH) return json(targets(shared));
      if (p === "/knowledge-graph/personal/claims/p-1/share" && init?.method === "POST") {
        shared = "c-new";
        return json({ projectClaimId: "c-new", outcome: "shared" });
      }
      return undefined;
    });
    render(<ShareToProject claimId="p-1" testIdPrefix="t" />);
    fireEvent.click(screen.getByTestId("t-open"));
    const dialog = await screen.findByTestId("t-dialog");
    await within(dialog).findByTestId("t-target-prj-1");
    expect(within(dialog).getByTestId("t-statement").textContent).toBe("客户 A 最看重交付确定性");
    const audience = within(dialog).getByTestId("t-audience");
    expect(audience.textContent).toContain("确认后能看到它的人：「新能源项目」的全部 3 位成员");
    expect(within(audience).getAllByTestId("t-audience-member").map((x) => x.textContent)).toEqual(["李雷", "韩梅梅", "王观察"]);
    expect(within(dialog).getByTestId("t-shared-prj-2").textContent).toBe("已分享");

    fireEvent.click(within(dialog).getByTestId("t-confirm"));
    await within(dialog).findByTestId("t-status");
    expect(within(dialog).getByTestId("t-status").textContent).toContain("已分享到「新能源项目」");
    expect(posts()).toEqual([["/knowledge-graph/personal/claims/p-1/share", { projectId: "prj-1" }]]);
    await waitFor(() => expect(within(dialog).getByTestId("t-shared-prj-1").textContent).toBe("已分享"));
    // 已分享的项目：主按钮换成「撤回分享」
    expect(within(dialog).getByTestId("t-revoke")).toBeTruthy();
  });

  it("已分享的项目可以撤回：POST unshare；失败时把原因如实说在对话框里", async () => {
    let fail = true;
    stubNetwork((p, init) => {
      if (p === TARGETS_PATH) return json(targets(null));
      if (p === "/knowledge-graph/personal/claims/p-1/unshare" && init?.method === "POST") {
        if (fail) { fail = false; return json({ reasonCode: "KG_ACTOR_NOT_HUMAN" }, 403); }
        return json({ projectClaimId: "c-shared" });
      }
      return undefined;
    });
    render(<ShareToProject claimId="p-1" testIdPrefix="t" />);
    fireEvent.click(screen.getByTestId("t-open"));
    const dialog = await screen.findByTestId("t-dialog");
    const radio = (await within(dialog).findByTestId("t-target-prj-2")).querySelector("input")!;
    fireEvent.click(radio);
    expect(within(dialog).getByTestId("t-audience").textContent).toContain("现在能看到它的人");
    fireEvent.click(within(dialog).getByTestId("t-revoke"));
    expect((await within(dialog).findByTestId("t-error")).textContent).toBe("这个操作只能由你本人在界面上完成。");
    fireEvent.click(within(dialog).getByTestId("t-revoke"));
    expect((await within(dialog).findByTestId("t-status")).textContent).toContain("已从「储能项目」撤回。你的个人记忆原件还在。");
    expect(posts().map(([path, body]) => [path, body])).toEqual([
      ["/knowledge-graph/personal/claims/p-1/unshare", { projectId: "prj-2" }],
      ["/knowledge-graph/personal/claims/p-1/unshare", { projectId: "prj-2" }],
    ]);
  });

  it("没有可分享的项目：如实说，不给确认按钮可点；别人的记忆（404）如实说不在了", async () => {
    stubNetwork((p) => (p === TARGETS_PATH ? json({ claimId: "p-1", statement: "x", targets: [] }) : undefined));
    const { unmount } = render(<ShareToProject claimId="p-1" testIdPrefix="t" />);
    fireEvent.click(screen.getByTestId("t-open"));
    await screen.findByTestId("t-no-targets");
    expect((screen.getByTestId("t-confirm") as HTMLButtonElement).disabled).toBe(true);
    unmount();

    stubNetwork((p) => (p === TARGETS_PATH ? json({ reasonCode: "KG_CLAIM_NOT_FOUND" }, 404) : undefined));
    render(<ShareToProject claimId="p-1" testIdPrefix="t" />);
    fireEvent.click(screen.getByTestId("t-open"));
    expect((await screen.findByTestId("t-error")).textContent).toBe("这条记忆已经不在了（或已撤回），请刷新后再试。");
  });
});

describe("S10 出处标签：「由 X 分享自个人记忆」", () => {
  it("契约单源文案；没有显示名说「项目成员」；项目记忆但不是分享来的说「来自项目记忆」；别的范围不标", () => {
    expect(sharedFromPersonalLabelZh("李雷")).toBe("由 李雷 分享自个人记忆");
    expect(sharedFromPersonalLabelZh(" ")).toBe("由 项目成员 分享自个人记忆");
    expect(projectOriginLabel({ scope: "project", sharedByName: "李雷" })).toBe("由 李雷 分享自个人记忆");
    expect(projectOriginLabel({ scope: "project", sharedByName: null })).toBe("来自项目记忆");
    expect(projectOriginLabel({ scope: "project" })).toBe("来自项目记忆");
    expect(projectOriginLabel({ scope: "personal", sharedByName: "李雷" })).toBeNull();
  });

  it("回答下的引用 chip：项目记忆里分享来的那条标出处", () => {
    const m = KgRecalledMemory.parse({
      claimId: "c-1", statement: "客户 A 最看重交付确定性", kind: "fact", triState: "confirmed", scope: "project", saidAt: null,
      channels: ["claim"], retrievalReasons: [], score: 0, graphPath: null, sharedByName: "李雷",
    });
    render(<AnswerKnowledgeFooter recalled={[m]} recallDegraded={false} onOpenSource={() => undefined} />);
    expect(screen.getByTestId("kg-from-project-c-1").textContent).toBe("由 李雷 分享自个人记忆");
  });

  it("项目大脑：分享来的条目下写「由 X 分享自个人记忆」，别的条目不写；目标 / 偏好类也列出来", async () => {
    const scope = { kind: "project", id: "prj-1" } as const;
    const claim = (id: string, kind: string, statement: string) => ({
      id, scope, kind, statement, status: "accepted", triState: "confirmed", confidence: 1, createdBy: "human", reviewedBy: "u-1",
      supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: [], supportingCount: 1, contradictingCount: 0, createdAt: "2026-09-27T08:00:00Z",
    });
    const body = knowledgeGraph.getProjectKnowledge.out.parse({
      scope, revision: 2, objects: [], edges: [],
      claims: [claim("c-1", "fact", "客户 A 最看重交付确定性"), claim("c-2", "goal", "年底前完成并网"), claim("c-3", "fact", "从项目对话记进来的")],
      sharedFromPersonal: [{ claimId: "c-1", sharedByName: "李雷" }, { claimId: "c-2", sharedByName: "" }],
    });
    stubNetwork((p) => (p === "/knowledge-graph/projects/prj-1" ? json(body) : undefined));
    render(<ProjectBrainPanel projectId="prj-1" />);
    expect((await screen.findByTestId("project-brain-shared-by-c-1")).textContent).toBe("由 李雷 分享自个人记忆");
    expect(screen.getByTestId("project-brain-shared-by-c-2").textContent).toBe("由 项目成员 分享自个人记忆");
    expect(screen.queryByTestId("project-brain-shared-by-c-3")).toBeNull();
    // 分享来的那条证据在分享人的个人对话里、别人打不开：不给「来源」按钮；别的条目照旧有
    expect(screen.queryByTestId("project-brain-sources-c-1")).toBeNull();
    expect(screen.getByTestId("project-brain-sources-c-3")).toBeTruthy();
    expect(screen.getByTestId("project-brain-group-goal").textContent).toContain("年底前完成并网");
  });
});
