/**
 * F963（2026-08-19）—— 现场协作主持台状态条从 mock 切到真实
 * `listAgendaSegments`/`advanceAgendaSegment`；四组并行整块降级为如实空态。
 *
 * 直接测 `TabLive`（不经过整条 `ProjectWorkbench` 拉取链路，同
 * `project-prep-live.test.tsx` 对 `TabPrep` 的测法）：父组件的 fetch/刷新逻辑已经是
 * 既有模式（`liveSegments`/`refreshSegments`），这里只钉住 `TabLive` 本身拿到 props
 * 后怎么渲染、以及引导师点推进按钮时怎么调用真实端点。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { TabLive } from "@/components/project/tab-live";
import type { AgendaSegment } from "@/lib/live-projects";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function segment(overrides: Partial<AgendaSegment> = {}): AgendaSegment {
  return {
    id: "seg-3",
    workshopId: "p-live-1",
    agendaSegmentDefinitionId: null,
    ordinal: 2,
    title: "假设风暴 → 假设树画布",
    duration: 900,
    state: "active",
    mergedInto: null,
    acceptedSources: [],
    ...overrides,
  };
}

describe("F963 TabLive 主持台状态条：真实环节 + 推进动作", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "tok-e2e-963");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("没有 active 环节 ⇒ 真实空态，不是编造的『假设风暴』文案", () => {
    render(<TabLive view="facilitator" liveSegments={[segment({ state: "pending" })]} />);
    expect(screen.getByTestId("project-live-stagebar-empty")).toHaveTextContent("当前没有进行中的环节");
    expect(screen.queryByTestId("project-live-stagebar-title")).not.toBeInTheDocument();
  });

  it("有 active 环节 ⇒ 显示真实标题/序号/状态，四组并行整块显示未接线说明", () => {
    const segments = [
      segment({ id: "seg-1", ordinal: 0, state: "closed", title: "开场" }),
      segment({ id: "seg-2", ordinal: 1, state: "closed", title: "破冰" }),
      segment({ id: "seg-3", ordinal: 2, state: "active" }), // 假设风暴 → 假设树画布
    ];
    render(<TabLive view="facilitator" liveSegments={segments} />);
    expect(screen.getByTestId("project-live-stagebar-title")).toHaveTextContent("假设风暴 → 假设树画布");
    expect(screen.getByText("环节 3/3")).toBeInTheDocument(); // ordinal=2（0-based）→ 第 3 个，共 3 个
    expect(screen.getByTestId("project-live-groups-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("project-live-groups")).not.toBeInTheDocument();
  });

  it("加载中 ⇒ 显示加载态，不是空数组导致的假空态", () => {
    render(<TabLive view="facilitator" liveSegments={null} liveSegmentsLoading />);
    expect(screen.getByTestId("project-live-stagebar-loading")).toBeInTheDocument();
  });

  it("读取失败 ⇒ 显示真实错误，不吞成空态", () => {
    render(<TabLive view="facilitator" liveSegments={null} liveSegmentsError="DEPENDENCY_UNAVAILABLE" />);
    expect(screen.getByTestId("project-live-stagebar-error")).toHaveTextContent("DEPENDENCY_UNAVAILABLE");
  });

  it("非引导师看不到推进按钮（组长也不行——只有 stageControl 角色能推进环节）", () => {
    render(<TabLive view="groupLead" liveSegments={[segment()]} />);
    expect(screen.queryByTestId("project-live-next")).not.toBeInTheDocument();
  });

  it("观察者只读，看不到推进按钮", () => {
    render(<TabLive view="observer" liveSegments={[segment()]} />);
    expect(screen.queryByTestId("project-live-next")).not.toBeInTheDocument();
  });

  it("引导师点『下一环节』⇒ 真实 POST advance，body 不带路径参数，成功后回调 onAdvanced", async () => {
    let postCall: { url: string; body: unknown } | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input.toString());
      if (url.pathname === "/workshops/p-live-1/agenda-segments/seg-3/advance" && init?.method === "POST") {
        postCall = { url: url.pathname, body: JSON.parse((init.body as string) ?? "{}") };
        return jsonResponse({
          segment: segment({ state: "closed" }),
          revokedTemporaryGrants: 0,
          provenanceEventId: "prov-1",
        });
      }
      throw new Error(`unexpected fetch: ${init?.method ?? "GET"} ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const onAdvanced = vi.fn();
    render(<TabLive view="facilitator" liveSegments={[segment()]} onAdvanced={onAdvanced} />);

    fireEvent.click(screen.getByTestId("project-live-next"));

    await waitFor(() => expect(onAdvanced).toHaveBeenCalledTimes(1));
    expect(postCall).not.toBeNull();
    expect(postCall!.body).toMatchObject({
      workshopId: "p-live-1",
      segmentId: "seg-3",
      action: "advance",
      mergeIntoSegmentId: null,
    });
  });

  it("推进失败 ⇒ 显示真实错误，不静默吞掉，不调用 onAdvanced", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ reasonCode: "SEGMENT_ALREADY_ACTIVE" }, 409),
    );
    vi.stubGlobal("fetch", fetchMock);

    const onAdvanced = vi.fn();
    render(<TabLive view="facilitator" liveSegments={[segment()]} onAdvanced={onAdvanced} />);

    fireEvent.click(screen.getByTestId("project-live-next"));

    await waitFor(() => expect(screen.getByTestId("project-live-advance-error")).toBeInTheDocument());
    expect(onAdvanced).not.toHaveBeenCalled();
  });
});
