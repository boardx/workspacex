/**
 * F961（2026-08-18）—— 项目筹备组卡按**已签原型**补齐：组员计数 + 访谈对象摘要 +
 * 展开后的六列对象表（读写 F960 落地的真实端点）。
 *
 * 测法同 `project-prep-live.test.tsx`：直接测 `TabPrep`，父组件的拉取链路是既有模式，
 * 这里只钉住「拿到 props 之后怎么渲染 / 展开 / 编辑 / 提交 / 拒绝」。
 *
 * ⚠ 本文件同时是「后端角色矩阵 ↔ 前端 `ROLE_GROUP_SUBMIT` 两处声明」的漂移门：
 *   后端 `group.submitOutput` 改了而前端没跟，下面的角色断言会红（见该常量头注）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";

vi.mock("@/components/session/session-provider", () => ({
  useSession: () => ({ session: { currentOrgId: "org-e2e-demo" } }),
}));

import { TabPrep } from "@/components/project/tab-prep";

const PROJECT = "p-prep-961";
const G1 = "g-1";
const G2 = "g-2";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const GROUPING = {
  groups: [
    {
      groupId: G1, name: "第 1 组", scenario: "首次评估投资",
      leaderUserId: "u-lead", status: "recording-ready" as const,
      memberUserIds: ["u-a", "u-b", "u-c"],
    },
    {
      groupId: G2, name: "第 2 组", scenario: "采购比选",
      leaderUserId: "u-lead2", status: "short-n" as const,
      memberUserIds: [],
    },
  ],
  revision: "3",
};

const SUBJECT_WEBER = {
  subjectId: "s-1", name: "采购总监（Weber）", role: "采购部 · 决策者",
  contact: "+49 ···", focus: "工商储的付费意愿", method: "远程视频", status: "待预约",
};

/** G1 有一个访谈对象；G2 一个都没有（真实空态）。 */
function installFetch(opts: {
  putStatus?: number;
  putReason?: string;
  g1Fails?: boolean;
  onPut?: (body: unknown) => void;
} = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";

    if (url.pathname === "/organizations/org-e2e-demo/members" && method === "GET") {
      return jsonResponse({ members: [{ userId: "u-lead", displayName: "李维" }] });
    }
    if (url.pathname === `/projects/${PROJECT}/groups/${G1}/interview-subjects`) {
      if (method === "GET") {
        if (opts.g1Fails === true) return jsonResponse({ reasonCode: "DEPENDENCY_UNAVAILABLE" }, 503);
        return jsonResponse({ subjects: [SUBJECT_WEBER], revision: "7" });
      }
      if (method === "PUT") {
        opts.onPut?.(JSON.parse((init?.body as string) ?? "{}"));
        if (opts.putStatus !== undefined) {
          return jsonResponse({ reasonCode: opts.putReason ?? "VERSION_CHANGED" }, opts.putStatus);
        }
        return jsonResponse([SUBJECT_WEBER]);
      }
    }
    if (url.pathname === `/projects/${PROJECT}/groups/${G2}/interview-subjects` && method === "GET") {
      return jsonResponse({ subjects: [], revision: "0" });
    }
    throw new Error(`unexpected fetch: ${method} ${url.pathname}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderPrep(view: "facilitator" | "groupLead" | "member" = "facilitator") {
  return render(
    <TabPrep
      view={view} projectId={PROJECT}
      liveTopic={{ topicId: PROJECT, title: "储能怎么进欧洲", background: "背景", revision: "1" }}
      liveGrouping={GROUPING}
    />,
  );
}

describe("F961 组卡按原型：组员计数 + 访谈对象摘要", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-961");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("组员显示人数（原型逐字「3 人」），不是姓名清单", async () => {
    installFetch();
    renderPrep();
    const card = await screen.findByTestId(`project-prep-group-${G1}`);
    expect(within(card).getByText("3 人")).toBeInTheDocument();
    // 姓名不出现在折叠态——原型这一行就是计数
    expect(within(card).queryByText(/u-a/)).not.toBeInTheDocument();
  });

  it("有访谈对象时摘要显示对象名；没有时显示「未填」而不是空白", async () => {
    installFetch();
    renderPrep();
    await waitFor(() =>
      expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("采购总监（Weber）"),
    );
    expect(screen.getByTestId(`project-prep-subjects-${G2}-summary`)).toHaveTextContent("未填");
  });

  it("单个组读失败只让那一组显示「读取失败」，别组照常显示", async () => {
    installFetch({ g1Fails: true });
    renderPrep();
    await waitFor(() =>
      expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("读取失败"),
    );
    expect(screen.getByTestId(`project-prep-subjects-${G2}-summary`)).toHaveTextContent("未填");
  });
});

describe("F961 展开后是原型第 6 步的六列对象表", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-961");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("默认折叠；展开后六列表头逐字齐全，且显示真实行内容", async () => {
    installFetch();
    renderPrep();
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));

    expect(screen.queryByTestId(`project-prep-subjects-${G1}-panel`)).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));

    const panel = screen.getByTestId(`project-prep-subjects-${G1}-panel`);
    for (const label of ["对象", "部门角色", "联系方式", "背景与要问什么", "方式", "状态"]) {
      expect(within(panel).getByText(label)).toBeInTheDocument();
    }
    expect(within(panel).getByText("远程视频")).toBeInTheDocument();
    expect(within(panel).getByText("待预约")).toBeInTheDocument();
  });

  it("`[AI 建议人选]` 是禁用的，并如实说明未接入——不做点了没反应的假入口", async () => {
    installFetch();
    renderPrep();
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));

    const ai = screen.getByTestId(`project-prep-subjects-${G1}-ai`);
    expect(ai).toBeDisabled();
    expect(ai).toHaveTextContent("未接入");
  });
});

describe("F961 填写与提交", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-961");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("加一行并保存：PUT 带整批 subjects + 上次读到的 expectedRevision，六列字段一个不缺", async () => {
    const puts: unknown[] = [];
    installFetch({ onPut: (b) => puts.push(b) });
    renderPrep();
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));

    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-edit`));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-add`));

    const panel = screen.getByTestId(`project-prep-subjects-${G1}-panel`);
    const nameInputs = within(panel).getAllByLabelText("对象");
    fireEvent.change(nameInputs[nameInputs.length - 1]!, { target: { value: "业主侧投资经理" } });

    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-save`));

    await waitFor(() => expect(puts).toHaveLength(1));
    const body = puts[0] as { subjects: Record<string, string>[]; expectedRevision: string };
    expect(body.expectedRevision).toBe("7");
    // ⚠ **路径参数不许进 body**：controller 的 body schema 是
    //   `updateInterviewSubjects.in.omit({projectId, groupId})`，而契约那个 object 是
    //   `.strict()`——多带一个字段就是 400。这条断言是那个 bug 的机械门：F950 的
    //   `saveProjectTopic`/`saveProjectGrouping` 正是这么写的、组件测试全绿、真栈一打就
    //   400（由 `e2e/interview-subjects-smoke.spec.ts` 首次跑出来）。mock 的 fetch 只记录
    //   body、不会像 zod 那样拒绝，所以这里必须显式钉住，不能指望「保存成功」这类断言。
    expect(body).not.toHaveProperty("projectId");
    expect(body).not.toHaveProperty("groupId");
    expect(body.subjects).toHaveLength(2);
    const added = body.subjects[1]!;
    expect(added.name).toBe("业主侧投资经理");
    for (const col of ["name", "role", "contact", "focus", "method", "status"]) {
      expect(col in added).toBe(true);
    }
  });

  it("删一行后保存：提交的是删完之后的整批，不是发一条删除指令", async () => {
    const puts: unknown[] = [];
    installFetch({ onPut: (b) => puts.push(b) });
    renderPrep();
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));

    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-edit`));
    fireEvent.click(screen.getByTestId(`project-prep-subject-${SUBJECT_WEBER.subjectId}-remove`));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-save`));

    await waitFor(() => expect(puts).toHaveLength(1));
    expect((puts[0] as { subjects: unknown[] }).subjects).toHaveLength(0);
  });

  it("并发冲突：提示有人改过、不覆盖对方，编辑态保留不清空用户输入", async () => {
    installFetch({ putStatus: 409, putReason: "VERSION_CHANGED" });
    renderPrep();
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));

    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-edit`));
    const panel = screen.getByTestId(`project-prep-subjects-${G1}-panel`);
    fireEvent.change(within(panel).getAllByLabelText("方式")[0]!, { target: { value: "线下面访" } });
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-save`));

    await waitFor(() =>
      expect(screen.getByTestId(`project-prep-subjects-${G1}-error`)).toHaveTextContent("有人刚改过"),
    );
    // 用户刚敲的值还在，没有被静默丢弃
    expect(within(screen.getByTestId(`project-prep-subjects-${G1}-panel`)).getAllByLabelText("方式")[0])
      .toHaveValue("线下面访");
  });
});

describe("F961 角色门槛与后端 group.submitOutput 一致", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-961");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("组长能编辑访谈对象表——后端 group.submitOutput 允许组长，入口不能只给引导师", async () => {
    installFetch();
    renderPrep("groupLead");
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));
    expect(screen.getByTestId(`project-prep-subjects-${G1}-edit`)).toBeInTheDocument();
  });

  it("组员只能看不能改：展开看得到表，但没有编辑入口", async () => {
    installFetch();
    renderPrep("member");
    await waitFor(() => expect(screen.getByTestId(`project-prep-subjects-${G1}-summary`)).toHaveTextContent("Weber"));
    fireEvent.click(screen.getByTestId(`project-prep-subjects-${G1}-toggle`));

    const panel = screen.getByTestId(`project-prep-subjects-${G1}-panel`);
    expect(within(panel).getByText("远程视频")).toBeInTheDocument();
    expect(screen.queryByTestId(`project-prep-subjects-${G1}-edit`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`project-prep-subjects-${G1}-add`)).not.toBeInTheDocument();
  });
});
