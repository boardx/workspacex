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
