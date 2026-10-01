import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { InlineTagEditor } from "@/components/ui/inline-tag-editor";
import { TagInput } from "@/components/ui/tag-input";

describe("InlineTagEditor（项目卡 / 收件箱共用的内联标签编辑器）", () => {
  afterEach(() => cleanup());
  const props = { maxTags: 3, maxTagLength: 4, testidPrefix: "x" };

  it("点「+」出输入框；回车/逗号确认（忽略大小写去重、超长截断）；每次都是完整集合", () => {
    const onChange = vi.fn();
    render(<InlineTagEditor {...props} tags={["Ab"]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("x-tag-add"));
    const input = screen.getByTestId("x-tag-input");
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled(); // 与 Ab 同一个
    expect(screen.getByTestId("x-tags-error")).toHaveTextContent("已经有这个标签了");
    fireEvent.change(input, { target: { value: "超长超长超长" } });
    expect(screen.queryByTestId("x-tags-error")).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: "，" });
    expect(onChange).toHaveBeenLastCalledWith(["Ab", "超长超长"]);
  });

  it("IME 组合输入期间不确认；Esc 取消；失焦把草稿并进去", () => {
    const onChange = vi.fn();
    render(<InlineTagEditor {...props} tags={[]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("x-tag-add"));
    const input = screen.getByTestId("x-tag-input");
    fireEvent.change(input, { target: { value: "新" } });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.blur(input);
    expect(onChange).toHaveBeenLastCalledWith(["新"]);
    fireEvent.click(screen.getByTestId("x-tag-add"));
    fireEvent.keyDown(screen.getByTestId("x-tag-input"), { key: "Escape" });
    expect(screen.queryByTestId("x-tag-input")).toBeNull();
  });

  it("移除与筛选：×= 去掉该标签后的完整集合；给 onFilter 时点标签名触发筛选；满额时禁用「+」", () => {
    const onChange = vi.fn(); const onFilter = vi.fn();
    render(<InlineTagEditor {...props} tags={["a", "b", "c"]} onChange={onChange} onFilter={onFilter} />);
    fireEvent.click(screen.getByTestId("x-tag-remove-b"));
    expect(onChange).toHaveBeenLastCalledWith(["a", "c"]);
    fireEvent.click(screen.getByTestId("x-tag-a-filter"));
    expect(onFilter).toHaveBeenCalledWith("a");
    expect((screen.getByTestId("x-tag-add") as HTMLButtonElement).disabled).toBe(true);
  });

  it("点击/按键不冒泡（嵌在整卡可点/可拖拽的容器里）", () => {
    const outer = vi.fn();
    render(<div onClick={outer} onKeyDown={outer}><InlineTagEditor {...props} tags={["a"]} onChange={() => {}} /></div>);
    fireEvent.click(screen.getByTestId("x-tag-add"));
    fireEvent.keyDown(screen.getByTestId("x-tag-input"), { key: " " });
    expect(outer).not.toHaveBeenCalled();
  });

  it("tags 缺省（夹具漏字段）不白屏", () => {
    render(<InlineTagEditor {...props} tags={undefined} onChange={() => {}} />);
    expect(screen.getByText("还没有标签")).toBeTruthy();
  });
});

describe("TagInput 给用户一句人话（重复 / 截断）", () => {
  afterEach(() => cleanup());
  function H() {
    const [v, setV] = React.useState<readonly string[]>(["客户"]);
    return <TagInput value={v} onChange={setV} knownTags={new Map()} maxTags={5} maxTagLength={4} testIdPrefix="t" />;
  }
  it("重复：提示「已经有了」；超长：提示已截断", () => {
    render(<H />);
    const input = screen.getByTestId("t-input");
    fireEvent.change(input, { target: { value: "客户" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("t-hint").textContent).toContain("已经有了");
    fireEvent.change(input, { target: { value: "超长超长超长" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByTestId("t-hint").textContent).toContain("已截断");
    fireEvent.change(input, { target: { value: "x" } });
    expect(screen.getByTestId("t-hint").textContent).not.toContain("已截断"); // 再动输入框就消失
  });
});
