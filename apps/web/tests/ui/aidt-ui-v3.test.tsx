import * as React from "react";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AidtReportPreview } from "@/features/aidt/components/aidt-report-preview";
import { AidtMaterials } from "@/features/aidt/components/aidt-materials";
import { AidtStageBridge } from "@/features/aidt/components/aidt-stage-bridge";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { AidtDashboard } from "@/features/aidt/components/project-aidt-dashboard";
import { AIDT_STEPS } from "@/lib/project-aidt";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ list: vi.fn(), session: { currentOrgId: "o", userId: "u", sessionToken: "t" } }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: mocks.session }) }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list, PROJECT_RESOURCE_KIND_LABEL_ZH: { design: "设计" } }));
vi.mock("@/components/project/project-resource-section", () => ({ projectResourceHref: (_kind: string, id: string) => `/source/${id}`, describeProjectResourceFailure: () => "资料读取失败" }));
vi.mock("@/lib/research-report-export", () => ({ printResearchPdf: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); mocks.list.mockResolvedValue({ items: [] }); });
it("shows page draft activity without calling it shared completion", () => {
  const drafts = emptyAidtUiDrafts(); drafts[1]!.fields.initial = "研究排队";
  render(<AidtDashboard href={(id) => `/aidt/g?step=${id}`} drafts={drafts} />);
  expect(screen.getByTestId("aidt-step-1")).toHaveTextContent("本页草稿 · 1 项已填写");
  expect(screen.getByTestId("aidt-step-2")).toHaveTextContent("本页尚未填写");
  expect(screen.getByText(/不代表小组进度或阶段确认/)).toBeVisible();
});
it("carries student-authored earlier context with missing-history limits and a group-safe return", () => {
  const drafts = emptyAidtUiDrafts(); drafts[1]!.fields.focus = "只研究午休排队";
  render(<AidtStageBridge projectId="g/1" stageNumber={3} drafts={drafts} />);
  fireEvent.click(screen.getByText(/1\. 工作坊主题命题/));
  expect(screen.getByText("只研究午休排队")).toBeVisible();
  expect(screen.getByText(/未自动发送给 AI/)).toBeVisible();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/aidt/g%2F1?step=1&tool=outcome");
});
it("a material read failure stays an error and can recover without pretending to be empty", async () => {
  mocks.list.mockRejectedValueOnce(new Error("offline"));
  render(<AidtMaterials projectId="g" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("资料读取失败");
  expect(screen.queryByText(/当前没有已关联资料/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "重新读取资料" }));
  expect(await screen.findByText(/当前没有已关联资料/)).toBeVisible();
});
it("ignores a stale group's response and keeps linked design separate from verified evidence", async () => {
  let finish!: (value: unknown) => void;
  mocks.list.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const { rerender } = render(<AidtMaterials projectId="old" />);
  mocks.list.mockResolvedValue({ items: [{ kind: "design", id: "d/1", title: "本组原型", status: "draft", updatedAt: "2026-11-14T00:00:00Z" }] });
  rerender(<AidtMaterials projectId="new" />);
  expect(await screen.findByRole("link", { name: "本组原型" })).toHaveAttribute("href", "/aidt/new?step=5&tool=design&resource=d%2F1");
  finish({ items: [{ title: "旧组资料", kind: "design", id: "old" }] });
  await waitFor(() => expect(screen.queryByText("旧组资料")).toBeNull());
  expect(screen.getByText(/不能自动当作真实访谈证据/)).toBeVisible();
});
it("reports an occupied native composer and keeps the outcome available", () => {
  const drafts = emptyAidtUiDrafts(); drafts[1]!.fields.initial = "我们自己的观察";
  const handoff = vi.fn().mockReturnValue("occupied");
  render(<AidtStageOutput projectId="g" step={AIDT_STEPS[0]!} draft={drafts[1]!} update={vi.fn()} readOnly={false} toolHref={() => ""} toChat={handoff} />);
  fireEvent.click(screen.getByRole("button", { name: "审阅并发送到本步聊天" }));
  expect(handoff).toHaveBeenCalledWith(expect.stringContaining("我们自己的观察"));
  expect(screen.getByText(/聊天输入框已有未发送内容，未覆盖/)).toBeVisible();
  expect(screen.getByLabelText("初始问题")).toHaveValue("我们自己的观察");
});

it("uses saved group revisions after re-entry without equating saving with completion", () => {
  const drafts=emptyAidtUiDrafts();drafts[1]!.fields.initial="小组问题";
  const stage=SharedStage.parse({projectId:"g",stageId:1,revision:3,content:{schemaVersion:1,draft:structuredClone(drafts[1]!)},sourceStageRevisions:[],updatedBy:"student",updatedAt:"2026-11-15T00:00:00.000Z"});
  drafts[1]!.fields.scene="本页新增场景";
  render(<AidtDashboard href={id=>`/aidt/g?step=${id}`} drafts={drafts} shared={{phase:"ready",stages:{1:stage}}} />);
  expect(screen.getByRole("heading",{level:1,name:"本组六步研究"})).toBeVisible();
  expect(screen.getByTestId("aidt-stage-save-1")).toHaveTextContent("小组已保存 · V3 · 本页有修改");
  expect(screen.getByTestId("aidt-stage-save-2")).toHaveTextContent("尚未保存成果");
  expect(screen.getByRole("link", { name: "继续第1步 · 理解与提出问题" })).toHaveAttribute("href", "/aidt/g?step=1");
  expect(screen.getByTestId("aidt-step-2")).toHaveTextContent("进入对话");
  expect(screen.getByText(/保存版本不代表阶段完成或全员确认/)).toBeVisible();
  expect(screen.queryByText(/刷新后重置/)).toBeNull();
});
it("a failed group status read stays an error and never labels stages unsaved", () => {
  const retry=vi.fn();render(<AidtDashboard href={id=>`/aidt/g?step=${id}`} drafts={emptyAidtUiDrafts()} shared={{phase:"error",stages:{},reload:retry}} />);
  expect(screen.getByTestId("aidt-dashboard-error")).toBeVisible();expect(screen.queryByText("尚未保存成果")).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"重新读取成果"}));expect(retry).toHaveBeenCalledTimes(1);
});

it("gives a real unsaved empty group a clear first-step action without inferring completion", () => {
  const {rerender}=render(<AidtDashboard href={id=>`/aidt/g?step=${id}`} drafts={emptyAidtUiDrafts()} shared={{phase:"ready",stages:{}}} />);
  expect(screen.getByRole("link",{name:"从第1步开始"})).toHaveAttribute("href","/aidt/g?step=1");
  rerender(<AidtDashboard href={id=>`/aidt/g?step=${id}`} drafts={emptyAidtUiDrafts()} shared={{phase:"loading",stages:{}}} />);
  expect(screen.queryByTestId("aidt-first-start")).toBeNull();expect(screen.queryByText("尚未保存成果")).toBeNull();
});

it("opens the report as formatted reading content and exposes the original only in edit mode", () => {
  const report = "# 长租成本研究\n\n**当前证据不足**\n\n| 指标 | 状态 |\n| --- | --- |\n| 误判率 | 待测 |";
  render(<AidtReportPreview drafts={emptyAidtUiDrafts()} text={report} sourceRevision={1} revision={1} onChange={vi.fn()} regenerate={vi.fn()} readOnly={false} initialPreview />);
  expect(screen.getByRole("heading", { name: "长租成本研究" })).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("误判率");
  expect(screen.queryByLabelText("小组报告草稿")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑报告" }));
  expect(screen.getByLabelText("小组报告草稿")).toHaveValue(report);
});
