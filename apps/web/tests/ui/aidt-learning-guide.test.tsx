import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AidtLearningStart, AidtEvidenceGuide, AidtDecisionGuide } from "@/features/aidt/components/aidt-learning-guide";
import { AIDT_STEPS } from "@/lib/project-aidt";
it.each(AIDT_STEPS)("gives student-first, stage-specific questions for step$id", (step) => {
  render(<AidtLearningStart step={step} />);
  expect(screen.getAllByRole("listitem")).toHaveLength(3);
  expect(screen.getByText(/私人经历可以跳过/)).toBeVisible();
  expect(screen.getByText(/由你们决定/)).toBeVisible();
  expect(screen.queryByText(/调研市场/)).toBeNull();
});

it("keeps synthetic evidence, personal transcription and consent boundaries explicit", () => {
  render(<AidtEvidenceGuide />);
  expect(screen.getByText(/不能充当真实采访或测试证据/)).toBeVisible();
  expect(screen.getByText(/关联小组不代表组员都能读取/)).toBeVisible();
  expect(screen.getByText(/去除不必要的姓名/)).toBeVisible();
});

it("copies a decision framework without claiming it was saved or unanimously agreed", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  render(<AidtDecisionGuide step={AIDT_STEPS[2]} />);
  fireEvent.click(screen.getByText("记录本组决定与不同意见"));
  fireEvent.click(screen.getByRole("button", { name: "复制模板" }));
  expect(await screen.findByText(/复制不代表已保存或全组确认/)).toBeVisible();
  expect((screen.getByLabelText("本组决定模板") as HTMLTextAreaElement).value).toContain("不同意见");
});
it("offers a manual fallback after clipboard failure, without false save feedback", async () => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
  render(<AidtDecisionGuide step={AIDT_STEPS[0]} />);
  fireEvent.click(screen.getByText("记录本组决定与不同意见"));
  fireEvent.click(screen.getByRole("button", { name: "复制模板" }));
  expect(await screen.findByText(/当前尚未保存/)).toBeVisible();
});

it("records changes of hypothesis and asks for teacher help without inventing anonymity or votes", () => {
  render(<AidtDecisionGuide step={AIDT_STEPS[5]} />);
  fireEvent.click(screen.getByText("记录本组决定与不同意见"));
  const text = (screen.getByLabelText("本组决定模板") as HTMLTextAreaElement).value;
  expect(text).toContain("原假设 → 新假设");
  expect(text).toContain("测试前认识 → 测试后认识（可未改变／证据不足）");
  expect(text).toContain("1理解问题／2共情用户／3综合定义／4创意发散／5原型制作／尚未决定");
  expect(text).toContain("不强制生成新版");
  expect(text).toContain("需要老师帮助的问题");
  expect(screen.getByText(/未启用匿名提交或小组投票/)).toBeVisible();
});

it("puts source reflection and the possibility of no surprising findings before later synthesis", () => {
  const problem = render(<AidtLearningStart step={AIDT_STEPS[0]} />);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("为什么这是一个值得研究的问题");
  expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("亲自观察、听到抱怨，还是某种猜测");
  problem.unmount();
  render(<AidtLearningStart step={AIDT_STEPS[2]} />);
  expect(screen.getAllByRole("listitem")[0]).toHaveTextContent("暂无也可以");
  expect(screen.getAllByRole("listitem")[1]).toHaveTextContent("保留矛盾和例外");
});
