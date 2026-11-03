import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RecPrep } from "@/components/rec/rec-prep";
import { RecProcess } from "@/components/rec/rec-process";
import { RecVerify } from "@/components/rec/rec-verify";
import { LiveTranscript } from "@/components/rec/live-transcript";
import { SpeakerAssign } from "@/components/rec/speaker-assign";
import { QuoteAnnotate } from "@/components/rec/quote-annotate";
import { SPEAKERS } from "@/lib/mock/rec";
import { RightRailNav } from "@/components/rec/right-rail";
import { RetentionPanel } from "@/components/rec/retention-panel";
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("mode=project&carrier=interview&as=facilitator&projectId=raw-project") }));
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("zh-CN")}>ZH test</button><button onClick={() => setLocale("en")}>EN test</button></>; }
beforeEach(() => { localStorage.clear(); });
const cases = [
 ["preparation", <RecPrep key="prep" state="default" view="facilitator" />, "Recording preparation"],
 ["processing", <RecProcess key="process" state="default" view="facilitator" />, "Recording processing"],
 ["verification", <RecVerify key="verify" state="default" view="facilitator" />, "Verify transcript"],
 ["speakers", <SpeakerAssign key="assign" state="default" view="facilitator" />, "Transcript review · assign speakers"],
 ["quotations", <QuoteAnnotate key="annotate" state="default" view="facilitator" />, "Quotes and markers"],
 ["retention", <RetentionPanel key="retention" state="default" view="facilitator" />, "Transcript return and retention"],
] as const;
for (const [name, element, heading] of cases) it(`localizes the reachable project ${name} panel without changing navigation context`, () => {
 render(<I18nProvider initialLocale="en"><Language />{element}</I18nProvider>);
 expect(screen.getByRole("heading", { name: new RegExp("^" + heading) })).toBeVisible();
 const before = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="?"]')].map(a => a.getAttribute("href"));
 fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test"));
 expect(screen.getByRole("heading", { name: new RegExp("^" + heading) })).toBeVisible(); expect([...document.querySelectorAll<HTMLAnchorElement>('a[href^="?"]')].map(a => a.getAttribute("href"))).toEqual(before);
 for (const href of before) { const params = new URLSearchParams(href!.slice(1)); expect(params.get("projectId")).toBe("raw-project"); expect(params.get("mode")).toBe("project"); }
});
it("keeps a live transcript search draft and raw transcript through locale changes", () => {
 render(<I18nProvider initialLocale="en"><Language /><LiveTranscript state="default" carrier="interview" view="facilitator" /></I18nProvider>);
 const query = screen.getByPlaceholderText("Search this session's transcript (matches highlighted)"); fireEvent.change(query, { target: { value: "用户查询 {count}" } }); fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); expect(query).toHaveValue("用户查询 {count}");
});
it("translates processing task captions and keeps an explicit retry notice current across locales", () => {
 render(<I18nProvider initialLocale="en"><Language /><RecProcess state="default" view="facilitator" /></I18nProvider>);
 expect(screen.getByTestId("rec-process-task-upload")).toHaveTextContent("Audio upload"); expect(screen.getByTestId("rec-process-task-translate")).toHaveTextContent("German-to-Chinese translation");
 fireEvent.click(screen.getByTestId("rec-process-retry-translate")); expect(screen.getByTestId("rec-process-toast")).toHaveTextContent("Retry"); fireEvent.click(screen.getByText("ZH test")); expect(screen.getByTestId("rec-process-toast")).toHaveTextContent("重试"); fireEvent.click(screen.getByText("EN test")); expect(screen.getByTestId("rec-process-toast")).toHaveTextContent("German-to-Chinese translation");
});
it("localizes device checks and speaker correction actions while retaining literal transcript content", () => {
 const result = render(<I18nProvider initialLocale="en"><RecPrep state="default" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-prep-check-mic")).toHaveTextContent("Microphone · input ready"); result.unmount();
 render(<I18nProvider initialLocale="en"><RecVerify state="default" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-verify-lowconf-v-2-0")).toHaveTextContent("Listen to segment"); expect(screen.getByTestId("rec-verify-item-v-2")).toHaveTextContent("Vertragswerk"); expect(screen.getByTestId("rec-verify-item-v-1")).toHaveTextContent("采购委员会最后卡的不是价格");
});
it("localizes track and masking status without translating the raw transcript", () => {
 render(<I18nProvider initialLocale="en"><LiveTranscript state="default" carrier="interview" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-tracks")).toHaveTextContent("Recording"); expect(screen.getByTestId("rec-tracks")).not.toHaveTextContent("录制中"); expect(screen.getByTestId("itv-transcript")).toHaveTextContent("Email address");
});
it("localizes withdrawal information and keeps submitted consent snapshots literal", () => {
 render(<I18nProvider initialLocale="en"><Language /><RetentionPanel state="default" view="interviewee" /></I18nProvider>); fireEvent.click(screen.getByTestId("rec-interviewee-withdraw-open")); expect(screen.getByTestId("rec-interviewee-withdraw-step-01")).toHaveTextContent("Transcript and audio enter the deletion queue"); expect(screen.getByTestId("rec-interviewee-withdraw-step-02")).toHaveTextContent("≤5 minutes"); fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); expect(screen.getByTestId("rec-interviewee-withdraw-step-01")).toBeVisible();
});

it("localizes side-panel tabs and retains the selected tab across locales", () => {
 render(<I18nProvider initialLocale="en"><Language /><RightRailNav /></I18nProvider>); fireEvent.click(screen.getByRole("tab", { name: /^Materials\s*12$/ })); fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); expect(screen.getByRole("tab", { name: /^Materials\s*12$/ })).toHaveAttribute("aria-selected", "true"); expect(screen.getByTestId("rec-tab-panel-material")).toBeVisible();
});
it("translates observer role labels without revealing real speaker names", () => {
 render(<I18nProvider initialLocale="en"><LiveTranscript state="default" carrier="interview" view="observer" /></I18nProvider>); expect(screen.getByTestId("itv-transcript")).toHaveTextContent("Interviewee"); for (const speaker of SPEAKERS) expect(screen.getByTestId("itv-transcript")).not.toHaveTextContent(speaker.realName);
});
it("translates processing status details while retaining each numeric count", () => {
 render(<I18nProvider initialLocale="en"><RecProcess state="default" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-process-task-upload")).toHaveTextContent("412 MB · Complete"); expect(screen.getByTestId("rec-process-task-transcribe")).toHaveTextContent("1,284 sentences · Complete"); expect(screen.getByTestId("rec-process-task-translate")).toHaveTextContent("Local model queue timed out");
});
it("translates live connection and recording status without changing the raw session title", () => {
 render(<I18nProvider initialLocale="en"><LiveTranscript state="default" carrier="interview" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-realtime-bar")).toHaveTextContent("Connected"); expect(screen.getByTestId("rec-realtime-bar")).toHaveTextContent("Recording"); expect(screen.getByTestId("rec-track-itv")).toHaveTextContent("Interviewee P-10"); expect(screen.getByTestId("rec-track-itv")).toHaveTextContent("Live · separate audio tracks"); expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("第 3 组访谈 · 储能采购决策");
});
it("translates the voiceprint explanation and preserves the canonical fallback duration", () => {
 render(<I18nProvider initialLocale="en"><SpeakerAssign state="default" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-voiceprint-note")).toHaveTextContent("Session voiceprint embeddings"); expect(screen.getByTestId("rec-voiceprint-note")).toHaveTextContent("7 days");
});
it("translates consent choices and their fixed help while retaining submitted snapshots", () => {
 render(<I18nProvider initialLocale="en"><RetentionPanel state="default" view="interviewee" /></I18nProvider>); expect((screen.getByTestId("rec-interviewee-consent-check-record") as HTMLInputElement).labels?.[0]).toHaveTextContent("Recording"); expect((screen.getByTestId("rec-interviewee-consent-check-transcript") as HTMLInputElement).labels?.[0]).toHaveTextContent("You can request your own copy.");
});
it("uses singular English for one incomplete participant and one second without changing counts", () => {
 const result = render(<I18nProvider initialLocale="en"><RecPrep state="default" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-prep-blocked-badge")).toHaveTextContent("1 person has incomplete consent"); result.unmount();
 render(<I18nProvider initialLocale="en"><LiveTranscript state="default" carrier="thread" view="facilitator" /></I18nProvider>); expect(screen.getByTestId("rec-realtime-bar")).toHaveTextContent("1 second ago");
});
