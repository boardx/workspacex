import * as React from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api-client";
import { skills } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
const {listMounts,mount,listSkills}=vi.hoisted(()=>({listMounts:vi.fn(),mount:vi.fn(),listSkills:vi.fn()}));
vi.mock("@/lib/live-skill-mount",()=>({listThreadMounts:listMounts,mountSkills:mount,unmountSkill:vi.fn()}));
vi.mock("@/lib/live-skill",()=>({listSkills}));

vi.mock("@/components/chat/chat-live-message-panel",async()=>{
  const {describeMessageFailure}=await import("@/lib/live-chat");
  return {describeMessageFailure};
});
vi.mock("@/components/feedback/feedback-button",()=>({FeedbackButton:()=>null}));
import { ChatSkillMountPanel } from "@/components/chat/chat-skill-mount-panel";
beforeEach(()=>{listMounts.mockReset();mount.mockReset();listSkills.mockReset();});
function SwitchLanguage(){const {setLocale}=useI18n();return <button onClick={()=>setLocale("zh-CN")}>switch language</button>;}
it("searches manually opened skills by task description, clears no-match, and mounts the selected identity", async () => {
  const rows = [
    { skillId: "pdf", name: "PDF", duty: "整理报告与中文文档" },
    { skillId: "slides", name: "Slides", duty: "制作演示稿" },
  ].map((row) => skills.SkillListItem.parse({ ...row, status: "已启用", source: "自建", visibility: "org-wide", currentVersionId: `version-${row.skillId}`, satisfaction: null }));
  listMounts.mockResolvedValue({ temporary: [], version: "fingerprint" });
  listSkills.mockResolvedValue(rows);
  mount.mockResolvedValue(undefined);
  render(<I18nProvider initialLocale="zh-CN"><ChatSkillMountPanel threadId="thread" orgId="org" bearer="fixture" /></I18nProvider>);
  const add = await screen.findByRole("button", { name: "加 skill" });
  await waitFor(() => expect(add).toBeEnabled());
  fireEvent.click(add);
  await screen.findByTestId("chat-skill-mount-option-pdf");
  const search = screen.getByRole("searchbox", { name: "搜索技能名称或用途" });
  fireEvent.change(search, { target: { value: "报告" } });
  expect(screen.getByTestId("chat-skill-mount-option-pdf")).toBeVisible();
  expect(screen.queryByTestId("chat-skill-mount-option-slides")).toBeNull();
  fireEvent.change(search, { target: { value: "unmatched" } });
  expect(screen.getByTestId("chat-skill-mount-mention-no-match")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "清除搜索" }));
  expect(screen.getByTestId("chat-skill-mount-option-slides")).toBeVisible();
  fireEvent.change(search, { target: { value: "sLiDeS" } });
  expect(screen.queryByTestId("chat-skill-mount-option-pdf")).toBeNull();
  fireEvent.click(screen.getByTestId("chat-skill-mount-option-slides"));
  await waitFor(() => expect(mount).toHaveBeenCalledWith("thread", undefined, { skillIds: ["slides"], expectedVersion: "fingerprint" }, "fixture"));
});

it("keeps source maintenance instructions out of the task choice and offers them in details", async () => {
  const duty = "这个 skill 的内容是文件形式（导入 / 由文件浏览器维护），不是声明式契约表单——查看/编辑源码请点卡片上的「编辑源码」。";
  listMounts.mockResolvedValue({ temporary: [], version: "fingerprint" });
  listSkills.mockResolvedValue([skills.SkillListItem.parse({ skillId: "file", name: "文档理解", duty, status: "已启用", source: "自建", visibility: "org-wide", currentVersionId: "version-file", satisfaction: null })]);
  render(<I18nProvider initialLocale="zh-CN"><ChatSkillMountPanel variant="composer" mentionQuery="" threadId="thread" orgId="org" bearer="fixture" /></I18nProvider>);
  const option = await screen.findByTestId("chat-skill-mount-option-file");
  expect(option).not.toHaveTextContent("声明式契约");
  expect(screen.getByText("技术说明").closest("details")).not.toHaveAttribute("open");
  expect(screen.getByText(duty).closest("details")).toBeTruthy();
});

it("localizes the live picker without refetching on locale change or changing the mount command",async()=>{
  const row=skills.SkillListItem.parse({skillId:"skill-raw",name:"用户技能 🌍",duty:"原始职责",status:"已启用",source:"自建",visibility:"org-wide",currentVersionId:"version-raw",satisfaction:null});
  listMounts.mockResolvedValue({temporary:[],version:"version-fingerprint-raw"});listSkills.mockResolvedValue([row]);mount.mockResolvedValue(undefined);
  render(<I18nProvider initialLocale="en"><SwitchLanguage/><ChatSkillMountPanel threadId="thread-raw" orgId="org-raw" bearer="unit-fixture-bearer"/></I18nProvider>);
  const add=await screen.findByRole("button",{name:"Add skill"});await waitFor(()=>expect(add.hasAttribute("disabled")).toBe(false));
  fireEvent.click(add);await screen.findByTestId("chat-skill-mount-option-skill-raw");
  const reads=listMounts.mock.calls.length,catalogReads=listSkills.mock.calls.length;
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByTestId("chat-skill-mount")).toBe(add);expect(screen.getByText("用户技能 🌍")).toBeTruthy();expect(row.duty).toBe("原始职责");
  expect(listMounts).toHaveBeenCalledTimes(reads);expect(listSkills).toHaveBeenCalledTimes(catalogReads);expect(mount).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("chat-skill-mount-option-skill-raw"));
  await waitFor(()=>expect(mount).toHaveBeenCalledWith("thread-raw",undefined,{skillIds:["skill-raw"],expectedVersion:"version-fingerprint-raw"},"unit-fixture-bearer"));
  expect(mount).toHaveBeenCalledTimes(1);
});

it("retranslates a persisted mount-list permission failure without issuing another request",async()=>{
  listMounts.mockRejectedValue(new ApiError(403,"NO_WRITE_ROLE","private upstream diagnostics"));
  listSkills.mockResolvedValue([]);
  render(<I18nProvider initialLocale="en"><SwitchLanguage/><ChatSkillMountPanel threadId="thread-raw" orgId="org-raw" bearer="unit-fixture-bearer"/></I18nProvider>);
  const message=await screen.findByText("Load mounted skills failed: the current identity does not have write permission (HTTP 403).");
  const reads=listMounts.mock.calls.length;
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByTestId("chat-skill-mount-failure").contains(message)).toBe(true);
  expect(message.textContent).toContain("HTTP 403");
  expect(message.textContent).not.toContain("Load mounted skills");
  expect(screen.queryByText("private upstream diagnostics")).toBeNull();
  expect(listMounts).toHaveBeenCalledTimes(reads);
  expect(mount).not.toHaveBeenCalled();
});
