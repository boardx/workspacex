import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtDiscoveryCards } from "@/features/aidt/components/aidt-discovery-cards";
import { aidtUiReportMarkdown, aidtUiStageSummary, emptyAidtUiDrafts, type AidtDiscoveryCardDraft } from "@/features/aidt/lib/aidt-ui-drafts";

function Cards() {
  const [cards, change] = React.useState<AidtDiscoveryCardDraft[]>([]);
  return <AidtDiscoveryCards cards={cards} readOnly={false} onChange={change} />;
}
const card: AidtDiscoveryCardDraft = { id: "a", participantCode: "A", headline: "学生认为她在犹豫", headlineKind: "student-summary", context: "食堂购买时的经历", quote: "我最后还是买老样子", sourceRef: "录音A 01:20", photoRef: "" };

it("starts with no fabricated people and keeps students' interpretation separate from actual words", () => {
  render(<Cards />);
  expect(screen.queryByTestId("aidt-discovery-card")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "添加发现卡" }));
  expect(screen.getByLabelText("发现卡1标题来源")).toHaveValue("student-summary");
  expect(screen.getByLabelText("发现卡1受访者原话")).toHaveValue("");
  expect(screen.getByLabelText("发现卡1照片引用")).toHaveValue("");
  fireEvent.change(screen.getByLabelText("发现卡1一句发现"), { target: { value: "这是学生解释" } });
  fireEvent.change(screen.getByLabelText("发现卡1受访者原话"), { target: { value: "我最后买老样子" } });
  fireEvent.click(screen.getByRole("button", { name: "添加发现卡" }));
  expect(screen.getByLabelText("发现卡1一句发现")).toHaveValue("这是学生解释");
  expect(screen.getByLabelText("发现卡1受访者原话")).toHaveValue("我最后买老样子");
  expect(screen.getByLabelText("发现卡2一句发现")).toHaveValue("");
  expect(screen.queryByRole("img")).toBeNull();
});

it("requires confirmation to remove a card and does not touch the original material", () => {
  render(<Cards />);
  fireEvent.click(screen.getByRole("button", { name: "添加发现卡" }));
  fireEvent.change(screen.getByLabelText("发现卡1原始材料与定位"), { target: { value: "录音A 01:20" } });
  fireEvent.click(screen.getByRole("button", { name: "移除发现卡1" }));
  expect(screen.getByTestId("aidt-discovery-card")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "保留发现卡" }));
  expect(screen.getByLabelText("发现卡1原始材料与定位")).toHaveValue("录音A 01:20");
  fireEvent.click(screen.getByRole("button", { name: "移除发现卡1" }));
  expect(screen.getByRole("alert")).toHaveTextContent("原始访谈附件不会删除");
  fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
  expect(screen.queryByTestId("aidt-discovery-card")).toBeNull();
});

it("blocks mutations after read-only downgrade, including an already-open removal confirmation", () => {
  const change = vi.fn();
  const { rerender } = render(<AidtDiscoveryCards cards={[card]} readOnly={false} onChange={change} />);
  fireEvent.click(screen.getByRole("button", { name: "移除发现卡1" }));
  rerender(<AidtDiscoveryCards cards={[card]} readOnly onChange={change} />);
  expect(screen.getByRole("button", { name: "确认移除" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认移除" }));
  fireEvent.click(screen.getByRole("button", { name: "添加发现卡" }));
  expect(change).not.toHaveBeenCalled();
});

it("keeps card sources, unknown photos and unverified quotes in the report without promoting them to evidence", () => {
  const drafts = emptyAidtUiDrafts();
  drafts[2]!.discoveryCards = [card, { ...card, id: "b", participantCode: "B", headlineKind: "quote", headline: "<script>unsafe</script>", sourceRef: "" }];
  const summary = aidtUiStageSummary(2, drafts[2]!);
  expect(summary).toContain("Headline（学生概括）：学生认为她在犹豫");
  expect(summary).toContain("原话（待核对）：我最后还是买老样子");
  expect(summary).toContain("原始材料引用：录音A 01:20");
  expect(summary).toContain("缺少材料引用；不可视为已验证发现");
  expect(summary).toContain("照片缺失；不生成真人照片补齐");
  expect(aidtUiReportMarkdown(drafts)).toContain(summary.split("\n")[0]);
  render(<AidtDiscoveryCards cards={[drafts[2]!.discoveryCards[1]!]} readOnly onChange={vi.fn()} />);
  expect(screen.getByTestId("aidt-discovery-card").querySelector("script")).toBeNull();
  expect(screen.getByText("<script>unsafe</script>")).toBeInTheDocument();
});
