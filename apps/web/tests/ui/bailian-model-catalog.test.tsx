import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { BailianModelCatalog } from "@/components/admin/bailian-model-catalog";
import { bailianModelCatalog } from "@repo/contracts/bailian-model-catalog";

afterEach(cleanup);

describe("Bailian public catalog user experience", () => {
  it("clearly separates published catalog coverage from tenant admission and unknown prices", () => {
    render(<BailianModelCatalog onViewOrganizationModels={vi.fn()} />);
    expect(screen.getByTestId("bailian-catalog-coverage")).toHaveTextContent("账号可用范围");
    expect(screen.getByTestId("bailian-catalog")).toHaveTextContent("不会自动启用");
    expect(screen.getByTestId("bailian-model-list").children).toHaveLength(12);
    expect(screen.getByTestId("bailian-model-qwen3.8-max")).toHaveTextContent("需配置并测试");
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
  });
  it("paginates and resets pagination when searching the entire snapshot", () => {
    render(<BailianModelCatalog onViewOrganizationModels={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText(/第 2/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "搜索百炼模型" }), { target: { value: "qwen3.8-max" } });
    expect(screen.getByTestId("bailian-result-count")).toHaveTextContent("找到 2 个模型");
    expect(screen.getByTestId("bailian-model-list").children).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
  });
  it("shows a scoped details drawer with source links and no registration or enable action", () => {
    const onView = vi.fn();
    render(<BailianModelCatalog onViewOrganizationModels={onView} />);
    fireEvent.click(screen.getByTestId("bailian-model-qwen3.8-max"));
    const drawer = screen.getByTestId("bailian-model-detail");
    expect(drawer).toHaveTextContent("阿里云百炼");
    expect(drawer).toHaveTextContent("尚未核验，不能用于报价");
    expect(drawer).toHaveTextContent("不是可直接执行的完整请求参数");
    expect(within(drawer).getByRole("link", { name: /文本生成/ })).toHaveAttribute("href", "https://help.aliyun.com/zh/model-studio/text-generation-model");
    expect(within(drawer).queryByRole("button", { name: /^启用/ })).toBeNull();
    fireEvent.click(within(drawer).getByRole("button", { name: "查看组织模型池" }));
    expect(onView).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("bailian-model-detail")).toBeNull();
  });
  it("recovers from a no-match search without replacing it with organization data", () => {
    render(<BailianModelCatalog onViewOrganizationModels={vi.fn()} />);
    fireEvent.change(screen.getByTestId("bailian-search"), { target: { value: "not-a-real-model" } });
    expect(screen.getByTestId("bailian-empty")).toBeInTheDocument();
    expect(screen.queryByTestId("bailian-model-list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "查看全部模型" }));
    expect(screen.getByTestId("bailian-model-qwen3.8-max")).toBeInTheDocument();
  });
  it("keeps a namespace ID and an unknown context value visible without inventing a limit", () => {
    const model = bailianModelCatalog.models.find((value) => value.modelId === "MiniMax/speech-2.8-hd")!;
    render(<BailianModelCatalog catalog={{ ...bailianModelCatalog, models: [model] }} onViewOrganizationModels={vi.fn()} />);
    fireEvent.click(screen.getByTestId("bailian-model-MiniMax/speech-2.8-hd"));
    expect(screen.getByTestId("bailian-model-detail")).toHaveTextContent("MiniMax/speech-2.8-hd");
    expect(screen.getByTestId("bailian-model-detail")).toHaveTextContent("原厂商");
    expect(screen.getByTestId("bailian-model-detail")).toHaveTextContent("HTTP");
  });
  it("filters using accessible vendor and capability controls", async () => {
    render(<BailianModelCatalog onViewOrganizationModels={vi.fn()} />);
    fireEvent.keyDown(screen.getByTestId("bailian-vendor-filter"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "MiniMax" }));
    fireEvent.keyDown(screen.getByTestId("bailian-capability-filter"), { key: "ArrowDown" });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "语音合成" }));
    expect(screen.getByTestId("bailian-result-count")).toHaveTextContent("找到 4 个模型");
    expect(screen.getByTestId("bailian-model-MiniMax/speech-2.8-hd")).toBeInTheDocument();
    expect(screen.queryByTestId("bailian-model-MiniMax-M3")).toBeNull();
  });

});
