/**
 * 「模型」后台屏简化后的形态（2026-09-02，人类原话：「简化…模型…参考画布模板的首页，
 * 简化为一个卡片的列表，通过一个侧边面板来展示当前的实体的内容…并通过 tag 来过滤和搜索」）。
 *
 * #1381 起列表读真实 `GET /models`（`lib/live-model.ts` 的 `listModels()`），这里 mock 那条
 * 真实调用，断言的是渲染行为本身：
 *   · 单个网格 `admin-model-list`，没有闭源/自托管分组、没有卡片/列表切换；
 *   · 种类 / 状态 / 能力标签 / 可承接机密都成了标签，可筛；搜索按名字/供应商；
 *   · 点卡片打开面板：字段齐全，启用开关在面板里真的可交互（走 D-U5 停用确认）。
 */
import * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const { listModels } = vi.hoisted(() => ({ listModels: vi.fn() }));

vi.mock("@/lib/live-model", async () => {
  const actual = await vi.importActual<typeof import("@/lib/live-model")>("@/lib/live-model");
  return { ...actual, listModels };
});

import { ModelScreen } from "@/components/admin/model-screen";

afterEach(() => cleanup());

const HOSTED = {
  modelId: "m-sonnet46",
  status: "已启用",
  kind: "closed-api",
  shape: "single",
  vendor: "Anthropic",
  displayName: "claude-sonnet-4.6",
  capabilityTags: ["均衡", "工具"],
  contextWindow: 400_000,
  unitPrice: 0.018,
  complianceAttrs: [],
  members: [],
  credentialConfigured: true,
} as const;

const SELF_HOSTED = {
  modelId: "m-qwen",
  status: "待测试",
  kind: "self-hosted",
  shape: "single",
  vendor: "自托管 · H100×4",
  displayName: "qwen3-72b",
  capabilityTags: ["长文"],
  contextWindow: 128_000,
  unitPrice: 0,
  complianceAttrs: [],
  members: [],
  credentialConfigured: false,
} as const;

describe("admin-model · 卡片目录 + 面板", () => {
  beforeEach(() => {
    listModels.mockReset();
    listModels.mockResolvedValue([HOSTED, SELF_HOSTED]);
  });

  it("单个网格：两类模型都在，没有分组容器与视图切换", async () => {
    render(<ModelScreen state="default" />);
    await screen.findByTestId(`admin-model-card-${HOSTED.modelId}`);
    const list = screen.getByTestId("admin-model-list");
    expect(list.className).toContain("grid");
    expect(within(list).getByTestId(`admin-model-card-${SELF_HOSTED.modelId}`)).toBeInTheDocument();
    expect(screen.queryByTestId("admin-model-card-grid-hosted")).toBeNull();
    expect(screen.queryByTestId("admin-model-group-self")).toBeNull();
    expect(screen.queryByTestId("admin-model-view-toggle-list")).toBeNull();
    expect(screen.queryByTestId("admin-model-filters")).toBeNull();
  });

  it("卡片不丢字段：供应商/能力标签/上下文/单价/凭据状态都在场", async () => {
    render(<ModelScreen state="default" />);
    const card = await screen.findByTestId(`admin-model-card-${HOSTED.modelId}`);
    expect(within(card).getByText(/Anthropic/)).toBeInTheDocument();
    expect(within(card).getByText(/均衡 · 工具/)).toBeInTheDocument();
    expect(within(card).getByText(/上下文 400,000 tokens/)).toBeInTheDocument();
    expect(within(card).getByTestId(`admin-model-price-${HOSTED.modelId}`)).toHaveTextContent("￥0.018 / 1k");
    expect(within(card).getByTestId(`admin-model-key-status-${HOSTED.modelId}`)).toHaveTextContent("已配置");
    expect(within(screen.getByTestId(`admin-model-card-${SELF_HOSTED.modelId}`)).getByTestId(`admin-model-confidential-${SELF_HOSTED.modelId}`)).toBeInTheDocument();
  });

  it("标签筛选：种类 / 状态 / 能力标签 / 可承接机密；搜索按名字与供应商", async () => {
    render(<ModelScreen state="default" />);
    await screen.findByTestId(`admin-model-card-${HOSTED.modelId}`);
    const filters = screen.getByTestId("admin-model-tag-filters");
    expect(within(filters).getByTestId("admin-model-tag-filter-closed-api").textContent).toContain("闭源 API 1");
    expect(within(filters).getByTestId("admin-model-tag-filter-untested").textContent).toContain("待测试 1");
    expect(within(filters).getByTestId("admin-model-tag-filter-confidential-ok").textContent).toContain("可承接机密 1");
    expect(filters.textContent).toContain("均衡 1");

    fireEvent.click(screen.getByTestId("admin-model-tag-filter-confidential-ok"));
    expect(screen.queryByTestId(`admin-model-card-${HOSTED.modelId}`)).toBeNull();
    expect(screen.getByTestId(`admin-model-card-${SELF_HOSTED.modelId}`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("admin-model-tag-filter-all"));
    fireEvent.change(screen.getByTestId("admin-model-search"), { target: { value: "anthropic" } });
    expect(screen.getByTestId(`admin-model-card-${HOSTED.modelId}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`admin-model-card-${SELF_HOSTED.modelId}`)).toBeNull();
    expect(listModels).toHaveBeenCalledTimes(1);
  });

  it("面板：字段齐全；开关真的可交互——停用走 D-U5 确认后状态徽标变「未启用」", async () => {
    render(<ModelScreen state="default" />);
    const card = await screen.findByTestId(`admin-model-card-${HOSTED.modelId}`);
    fireEvent.click(card);
    const drawer = screen.getByTestId("admin-model-detail");
    expect(drawer).toHaveTextContent("claude-sonnet-4.6");
    expect(drawer).toHaveTextContent("闭源 API");
    expect(drawer).toHaveTextContent("400,000 tokens");
    expect(drawer).toHaveTextContent("尚未回写后端");
    expect(within(drawer).getByTestId(`admin-model-status-${HOSTED.modelId}`)).toHaveTextContent("已启用");

    fireEvent.click(within(drawer).getByTestId(`admin-model-toggle-${HOSTED.modelId}`));
    const dialog = screen.getByTestId("admin-model-disable-dialog");
    fireEvent.change(within(dialog).getByTestId("admin-model-disable-dialog-reason"), {
      target: { value: "测试：验证面板里的开关真实生效" },
    });
    fireEvent.click(within(dialog).getByTestId("admin-model-disable-dialog-confirm"));

    await waitFor(() =>
      expect(within(screen.getByTestId("admin-model-detail")).getByTestId(`admin-model-status-${HOSTED.modelId}`)).toHaveTextContent("未启用"),
    );
  });

  it("待测试的模型：面板里是「录入测试判读」，五项全过后才启用", async () => {
    render(<ModelScreen state="default" />);
    fireEvent.click(await screen.findByTestId(`admin-model-card-${SELF_HOSTED.modelId}`));
    const drawer = screen.getByTestId("admin-model-detail");
    fireEvent.click(within(drawer).getByTestId(`admin-model-test-${SELF_HOSTED.modelId}`));
    const dialog = screen.getByTestId("admin-model-test-dialog");
    expect(within(dialog).getByTestId("admin-model-test-submit")).toBeDisabled();
    for (let i = 1; i <= 5; i += 1) {
      fireEvent.click(within(dialog).getByTestId(`admin-model-test-check-${i}`));
    }
    fireEvent.click(within(dialog).getByTestId("admin-model-test-submit"));
    await waitFor(() =>
      expect(within(screen.getByTestId("admin-model-detail")).getByTestId(`admin-model-status-${SELF_HOSTED.modelId}`)).toHaveTextContent("已启用"),
    );
  });

  it("读不到模型池：显示错误、不退回演示数据", async () => {
    listModels.mockRejectedValueOnce(new Error("boom"));
    render(<ModelScreen state="default" />);
    expect(await screen.findByTestId("admin-model-error")).toHaveTextContent("不退回演示数据");
    expect(screen.queryByTestId("admin-model-list")).toBeNull();
  });
});
