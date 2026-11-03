import * as React from "react";
import { expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RealtimeVoiceSession } from "@/components/chat/realtime-voice-session";
import type { openOmniConversation, OmniConversationHandlers } from "@/lib/live-omni-conversation";

const persona={agentId:"agent-raw",name:"用户数字人 🌍",subtitle:"原始职责",avatarKey:null};
function driver() {
  const stop=vi.fn(async()=>{}),cancelResponse=vi.fn(),setMuted=vi.fn();
  const calls:Array<{target:Parameters<typeof openOmniConversation>[0];handlers:OmniConversationHandlers}>=[];
  const connect:typeof openOmniConversation=async(target,handlers)=>{calls.push({target,handlers});return {stop,cancelResponse,setMuted};};
  let changeLanguage:()=>void=()=>{throw new Error("locale driver not ready");};
  function LocaleDriver(){const {setLocale}=useI18n();React.useEffect(()=>{changeLanguage=()=>setLocale("zh-CN");},[setLocale]);return null;}
  const resolve=vi.fn(async()=>"thread-raw");
  render(<I18nProvider initialLocale="en"><LocaleDriver/><RealtimeVoiceSession open onOpenChange={vi.fn()} persona={persona} resolveThreadId={resolve} connect={connect}/></I18nProvider>);
  return {calls,stop,cancelResponse,setMuted,resolve,changeLanguage:()=>changeLanguage()};
}
it("updates live call chrome in place while preserving connection, raw transcripts, mute state and canonical target",async()=>{
  const d=driver();await waitFor(()=>expect(d.calls).toHaveLength(1));const call=d.calls[0];if(!call)throw new Error("connect was not called");
  expect(call.target).toEqual({threadId:"thread-raw",agentId:"agent-raw"});
  act(()=>{call.handlers.onReady("model-raw");call.handlers.onUserTranscript("用户原文 {count}",true);call.handlers.onAssistantTranscript("助手原文 🌍",true);});
  expect(screen.getByTestId("realtime-voice-status").textContent).toBe("In conversation, waiting for you to speak");
  expect(screen.getByRole("dialog",{name:"Live conversation with 用户数字人 🌍"})).toBeTruthy();
  const mute=screen.getByTestId("realtime-voice-mute");expect(mute.getAttribute("aria-label")).toBe("Mute (M)");
  fireEvent.keyDown(screen.getByTestId("realtime-voice-status"),{key:"m"});
  expect(d.setMuted).toHaveBeenLastCalledWith(true);
  const count=d.setMuted.mock.calls.length;const caption=screen.getByText("用户原文 {count}");
  act(()=>d.changeLanguage());
  expect(screen.getByTestId("realtime-voice-mute")).toBe(mute);expect(mute.getAttribute("aria-label")).toBe("取消静音（快捷键 M）");
  expect(screen.getByText("用户原文 {count}")).toBe(caption);expect(screen.getByText("助手原文 🌍")).toBeTruthy();
  expect(screen.getAllByText(persona.name).length).toBeGreaterThan(0);
  expect(d.calls).toHaveLength(1);expect(d.resolve).toHaveBeenCalledTimes(1);expect(d.stop).not.toHaveBeenCalled();expect(d.setMuted).toHaveBeenCalledTimes(count);
});
it("retranslates an existing credit failure without reconnecting or exposing the raw upstream message",async()=>{
  const d=driver();await waitFor(()=>expect(d.calls).toHaveLength(1));const call=d.calls[0];if(!call)throw new Error("connect was not called");
  act(()=>{call.handlers.onReady("model-raw");call.handlers.onError("private raw upstream diagnostics","CREDIT_REQUIRED");call.handlers.onClosed();});
  expect(screen.getByTestId("realtime-voice-status").textContent).toBe("Insufficient credits");
  expect(screen.queryByText("private raw upstream diagnostics")).toBeNull();
  act(()=>d.changeLanguage());expect(screen.getByTestId("realtime-voice-status").textContent).toBe("额度不足");expect(d.calls).toHaveLength(1);
});
it("keeps English footer sentences separated in both live and muted states",async()=>{
  const d=driver();await waitFor(()=>expect(d.calls).toHaveLength(1));const call=d.calls[0];if(!call)throw new Error("connect was not called");
  act(()=>call.handlers.onReady("model-raw"));
  const scope=document.getElementById("realtime-voice-session-scope");
  if(!scope)throw new Error("scope footer missing");
  expect(scope.textContent).toContain("interrupt. Voice mode");
  expect(scope.textContent).toContain("need them. The transcript");
  fireEvent.click(screen.getByTestId("realtime-voice-mute"));
  expect(scope.textContent).toContain("hear you. Voice mode");
  expect(d.calls).toHaveLength(1);
});
