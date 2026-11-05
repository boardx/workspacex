import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ApiError, SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { KnowledgeGraphError, type fetchProjectKnowledge, type fetchProjectReasoning } from "@/lib/knowledge-graph-api";
import type { listThreads } from "@/lib/live-chat";
import type { listProjectResources } from "@/lib/live-project-resources";
import type { listNonWorkshopMembers } from "@/lib/live-project-collaborators";
import { TabGeneralOverview } from "@/components/project/tab-general-overview";

const api = vi.hoisted(() => ({ threads: vi.fn(), resources: vi.fn(), members: vi.fn(), knowledge: vi.fn(), reasoning: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/live-chat", async (original) => ({ ...await original<typeof import("@/lib/live-chat")>(), listThreads: (...args: unknown[]) => api.threads(...args) }));
vi.mock("@/lib/live-project-resources", async (original) => ({ ...await original<typeof import("@/lib/live-project-resources")>(), listProjectResources: (...args: unknown[]) => api.resources(...args) }));
vi.mock("@/lib/live-project-collaborators", async (original) => ({ ...await original<typeof import("@/lib/live-project-collaborators")>(), listNonWorkshopMembers: (...args: unknown[]) => api.members(...args) }));
vi.mock("@/lib/knowledge-graph-api", async (original) => ({ ...await original<typeof import("@/lib/knowledge-graph-api")>(), fetchProjectKnowledge: (...args: unknown[]) => api.knowledge(...args), fetchProjectReasoning: (...args: unknown[]) => api.reasoning(...args) }));

const threads: Awaited<ReturnType<typeof listThreads>> = { groups: [], capabilities: [] };
const resources: Awaited<ReturnType<typeof listProjectResources>> = {
  items: [{ kind: "whiteboard", id: "raw-board", title: "原始标题 / raw title", ownerUserId: "raw-owner", status: null, updatedAt: "2026-09-28T10:00:00.000Z", linkedAt: "2026-09-28T10:00:00.000Z" }],
  counts: { survey: 0, guided_research: 0, personal_transcription: 0, interview: 0, whiteboard: 1, design: 0 },
};
const members: Awaited<ReturnType<typeof listNonWorkshopMembers>> = { members: [{ userId: "raw-owner", displayName: "成员原名 / raw member", role: "owner" }] };
const knowledge: Awaited<ReturnType<typeof fetchProjectKnowledge>> = { scope: { kind: "project", id: "project-raw" }, revision: 1, objects: [], edges: [], claims: [] };
const reasoning: Awaited<ReturnType<typeof fetchProjectReasoning>> = { conflicts: [], gaps: [], chains: [], computedAt: "2026-09-28T00:00:00.000Z" };
function LanguageControl() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Change test language</button>;
}
const switchLocale = () => fireEvent.click(screen.getByRole("button", { name: "Change test language" }));
function host() {
  return render(<I18nProvider initialLocale="en"><LanguageControl /><TabGeneralOverview projectId="project-raw" liveOverview={null} tabHref={(tab, sub) => `/projects/project-raw?org=org-raw&tab=${tab}${sub ? `&sub=${sub}` : ""}`} /></I18nProvider>);
}
const readCounts = () => Object.values(api).map((fn) => fn.mock.calls.length);
beforeEach(() => {
  localStorage.clear(); localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "test-session");
  Object.values(api).forEach((fn) => fn.mockReset());
  api.threads.mockResolvedValue(threads); api.resources.mockResolvedValue(resources); api.members.mockResolvedValue(members); api.knowledge.mockResolvedValue(knowledge); api.reasoning.mockResolvedValue(reasoning);
});
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });

it("localizes populated overview labels and dates while preserving raw members, entries, links and request counts", async () => {
  host();
  const recent = await screen.findByTestId("project-general-overview-recent");
  await screen.findByTestId("project-general-overview-brain-claims");
  expect(screen.getByRole("heading", { name: "Project members" })).toBeInTheDocument();
  expect(screen.getByTestId("project-general-overview-members")).toHaveTextContent("成员原名 / raw member");
  expect(screen.getByTestId("project-general-overview-members")).toHaveTextContent("Owner");
  expect(recent).toHaveTextContent("原始标题 / raw title");
  expect(recent).toHaveTextContent("Whiteboard");
  expect(recent).toHaveTextContent(new Date(resources.items[0]!.updatedAt).toLocaleDateString("en"));
  const link = within(recent).getByRole("link"); const href = link.getAttribute("href"); const reads = readCounts();
  expect(screen.getByTestId("project-general-overview-count-whiteboard")).toHaveTextContent("1");
  expect(screen.getByTestId("project-general-overview-workflow-runs")).toHaveTextContent("View run board");
  switchLocale();
  expect(screen.getByTestId("project-general-overview-recent")).toBe(recent);
  expect(within(recent).getByRole("link")).toBe(link); expect(link).toHaveAttribute("href", href);
  expect(recent).toHaveTextContent("白板"); expect(recent).toHaveTextContent("原始标题 / raw title");
  expect(readCounts()).toEqual(reads);
});

it("localizes the full empty onboarding state without changing the actual destination links", async () => {
  api.resources.mockResolvedValue({ ...resources, items: [], counts: { ...resources.counts, whiteboard: 0 } });
  api.members.mockResolvedValue({ members: [] }); host();
  const guide = await screen.findByTestId("project-general-overview-start");
  expect(guide).toHaveTextContent("Get started with this project");
  expect(screen.getByTestId("project-general-overview-recent-empty")).toHaveTextContent("This project has no content yet");
  expect(screen.getByTestId("project-general-overview-members")).toHaveTextContent("No members yet.");
  const content = screen.getByTestId("project-general-overview-start-content"); const invite = screen.getByTestId("project-general-overview-start-invite");
  expect(content).toHaveAttribute("href", "/projects/project-raw?org=org-raw&tab=content"); expect(invite).toHaveAttribute("href", "/projects/project-raw?org=org-raw&tab=settings");
  const reads = readCounts(); switchLocale(); expect(screen.getByTestId("project-general-overview-start")).toBe(guide); expect(guide).toHaveTextContent("开始使用这个项目"); expect(readCounts()).toEqual(reads);
});

it("projects unresolved member, content and brain loading states without restarting pending requests", async () => {
  for (const fn of Object.values(api)) fn.mockImplementation(() => new Promise(() => {}));
  host(); const member = screen.getByTestId("project-general-overview-members");
  expect(member).toHaveTextContent("Loading members…"); expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
  const reads = readCounts(); switchLocale(); expect(member).toHaveTextContent("读取成员中…"); expect(readCounts()).toEqual(reads);
});

it("renders original member HTTP, resource role and brain visibility causes in current locale without refetch", async () => {
  api.members.mockRejectedValue(new ApiError(403, null, null));
  api.resources.mockRejectedValue(new ApiError(403, "NO_PROJECT_ROLE", null));
  api.knowledge.mockRejectedValue(new KnowledgeGraphError("KG_NOT_VISIBLE", 403));
  host(); const member = await screen.findByTestId("project-general-overview-members-error");
  const content = await screen.findByTestId("project-general-overview-content-error"); const brain = await screen.findByTestId("project-general-overview-brain-error");
  expect(member).toHaveTextContent("permission"); expect(content).toHaveTextContent("You are not a member of this project"); expect(brain).toHaveTextContent("You cannot view this project's brain.");
  const reads = readCounts(); switchLocale(); expect(screen.getByTestId("project-general-overview-members-error")).toBe(member); expect(content).toHaveTextContent("你不在这个项目里"); expect(brain).toHaveTextContent("你看不到这个项目的项目大脑"); expect(readCounts()).toEqual(reads);
});

it("keeps unknown resource caller text raw while localizing the overview-owned generic fallbacks", async () => {
  const raw = "unknown caller 原始原因 {unchanged}";
  api.resources.mockRejectedValue(new Error(raw)); api.members.mockRejectedValue(new Error("private member cause")); api.knowledge.mockRejectedValue(new Error("private brain cause"));
  host(); const content = await screen.findByTestId("project-general-overview-content-error");
  const member = await screen.findByTestId("project-general-overview-members-error"); const brain = await screen.findByTestId("project-general-overview-brain-error");
  expect(content).toHaveTextContent(raw); expect(member).toHaveTextContent("Members are temporarily unavailable."); expect(brain).toHaveTextContent("The project brain is temporarily unavailable.");
  const reads = readCounts(); switchLocale(); expect(content).toHaveTextContent(raw); expect(member).toHaveTextContent("成员暂时读不到"); expect(brain).toHaveTextContent("项目大脑暂时读不到"); expect(readCounts()).toEqual(reads);
});

it("retains successful knowledge with unknown conflict count when reasoning fails, in both locales", async () => {
  api.reasoning.mockRejectedValue(new Error("reasoning unavailable")); host();
  const claims = await screen.findByTestId("project-general-overview-brain-claims"); const conflicts = screen.getByTestId("project-general-overview-brain-conflicts");
  expect(claims).toHaveTextContent("0"); expect(claims).toHaveTextContent("Conclusions"); expect(conflicts).toHaveTextContent("—"); expect(conflicts).toHaveTextContent("Conflicts");
  const reads = readCounts(); switchLocale(); expect(screen.getByTestId("project-general-overview-brain-conflicts")).toBe(conflicts); expect(conflicts).toHaveTextContent("冲突"); expect(readCounts()).toEqual(reads);
});
