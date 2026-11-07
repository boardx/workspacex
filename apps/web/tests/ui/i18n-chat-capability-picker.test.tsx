import * as React from "react";
import { expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CapabilityCardList } from "@/components/chat/chat-task-workbench-capability-picker";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { CapabilityListing } from "@/lib/live-capabilities";
function SwitchLanguage() { const {setLocale} = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const listing: CapabilityListing = {
  id:"agent-raw",orgId:"org-current",kind:"agent",name:"用户数字人 🌍",scope:"org-wide",enabled:true,
  agentAvailable:true,endpoint:null,abbr:"原",duty:"原始职责内容",disabledReason:null,
};
it("localizes the real picker search and automatic option without changing the selection payload", () => {
  const select=vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage/><CapabilityCardList listings={[listing]} selectedAgentId={null} onSelect={select}/></I18nProvider>);
  const search=screen.getByRole("searchbox",{name:"Search digital humans"});
  expect(screen.getByRole("option",{name:/Automatic matching/}).getAttribute("aria-selected")).toBe("true");
  fireEvent.change(search,{target:{value:"用户"}});
  fireEvent.click(screen.getByRole("button",{name:"switch language"}));
  expect(screen.getByRole("searchbox",{name:"搜索数字人"})).toBe(search);
  expect((search as HTMLInputElement).value).toBe("用户");
  expect(select).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("option",{name:/用户数字人 🌍/}));
  expect(select).toHaveBeenCalledWith("agent-raw");
  expect(select).toHaveBeenCalledTimes(1);
});
