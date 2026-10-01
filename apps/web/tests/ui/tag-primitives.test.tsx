import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TagChip } from "@/components/ui/tag-chip";
import { TagFilterBar } from "@/components/ui/tag-filter-bar";
import { TagInput } from "@/components/ui/tag-input";

describe("TagChip", () => {
  afterEach(() => cleanup());
  it("纯展示是灰底胶囊；onRemove 渲染带读屏名的 ×；onClick 是可按下的按钮，选中反色", () => {
    const remove = vi.fn(); const click = vi.fn();
    const { rerender } = render(<TagChip testId="c" onRemove={remove}>客户</TagChip>);
    expect(screen.getByTestId("c")).toHaveClass("rounded-full", "text-10", "bg-muted");
    fireEvent.click(screen.getByRole("button", { name: "移除标签 客户" }));
    expect(remove).toHaveBeenCalledTimes(1);
    rerender(<TagChip testId="c" onClick={click} selected>客户</TagChip>);
    const btn = screen.getByTestId("c");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-pressed")).toBe("true");
    expect(btn).toHaveClass("bg-inverse");
    fireEvent.click(btn);
    expect(click).toHaveBeenCalledTimes(1);
  });
});

describe("TagFilterBar", () => {
  afterEach(() => cleanup());
  const tags = Array.from({ length: 10 }, (_, i) => ({ tag: `t${String(i)}`, count: i + 1 }));

  it("「全部标签」= 清除；多选切换；只露出前 maxVisible 个，「更多标签」展开，已选的永远露出", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagFilterBar tags={tags} selected={[]} onChange={onChange} prefix="p" business="项目" maxVisible={3} />);
    expect(screen.getByTestId("p-tag-all").getAttribute("aria-pressed")).toBe("true");
    expect(screen.queryByTestId("p-tag-t5")).toBeNull();
    fireEvent.click(screen.getByTestId("p-tag-t1"));
    expect(onChange).toHaveBeenLastCalledWith(["t1"]);
    rerender(<TagFilterBar tags={tags} selected={["t1", "t7"]} onChange={onChange} prefix="p" business="项目" maxVisible={3} />);
    expect(screen.getByTestId("p-tag-t7")).toBeTruthy(); // 已选中但超出 maxVisible，仍露出
    fireEvent.click(screen.getByTestId("p-tag-t1"));
    expect(onChange).toHaveBeenLastCalledWith(["t7"]); // 多选：取消一个
    fireEvent.click(screen.getByTestId("p-tag-more"));
    expect(screen.getByTestId("p-tag-t9")).toBeTruthy();
    fireEvent.click(screen.getByTestId("p-tag-all"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("single 模式：点另一个标签替换选择，再点同一个取消", () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagFilterBar tags={tags.slice(0, 3)} selected={["t0"]} onChange={onChange} prefix="p" business="研究" mode="single" />);
    fireEvent.click(screen.getByTestId("p-tag-t1"));
    expect(onChange).toHaveBeenLastCalledWith(["t1"]);
    rerender(<TagFilterBar tags={tags.slice(0, 3)} selected={["t0"]} onChange={onChange} prefix="p" business="研究" mode="single" />);
    fireEvent.click(screen.getByTestId("p-tag-t0"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("没有标签时整条不渲染", () => {
    const { container } = render(<TagFilterBar tags={[]} selected={[]} onChange={() => {}} prefix="p" business="项目" />);
    expect(container.firstChild).toBeNull();
  });
});

describe("TagInput（共享创建体验）", () => {
  afterEach(() => cleanup());
  function Harness({ initial = [] as string[], known = new Map<string, number>() }) {
    const [v, setV] = React.useState<readonly string[]>(initial);
    return <TagInput value={v} onChange={setV} knownTags={known} maxTags={3} maxTagLength={6} testIdPrefix="t" />;
  }

  it("回车 / 逗号 / 中文逗号确认；忽略大小写去重；超长截断；满额拒绝", () => {
    render(<Harness />);
    const input = screen.getByTestId("t-input");
    fireEvent.change(input, { target: { value: "Client" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "client" } });
    fireEvent.keyDown(input, { key: "," });
    expect(screen.queryByTestId("t-chip-client")).toBeNull(); // 与 Client 同一个
    fireEvent.change(input, { target: { value: "超长超长超长超长" } });
    fireEvent.keyDown(input, { key: "，" });
    expect(screen.getByTestId("t-chip-超长超长超长")).toBeTruthy();
    fireEvent.change(input, { target: { value: "c" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("t-hint").textContent).toContain("最多 3 个");
    expect((screen.getByTestId("t-input") as HTMLInputElement).disabled).toBe(true);
  });

  it("输入即搜索已有标签（忽略大小写），不存在时首项是「＋ 新建」", () => {
    render(<Harness known={new Map([["Client", 4], ["供应链", 2]])} />);
    const input = screen.getByTestId("t-input");
    fireEvent.change(input, { target: { value: "cli" } });
    expect(screen.getByTestId("t-suggestion-Client")).toBeTruthy();
    fireEvent.change(input, { target: { value: "全新" } });
    expect(screen.getByTestId("t-suggestion-全新").textContent).toContain("新建标签");
  });
});
