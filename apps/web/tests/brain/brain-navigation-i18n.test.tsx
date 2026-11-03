import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n/provider";
import { LanguageSwitcher } from "@/components/shell/language-switcher";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
import { SESSION_TOKEN_STORAGE_KEY } from "@/lib/api-client";
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ session: { currentOrgId: "org" } }) }));
vi.mock("@/components/brain/about-me", () => ({ AboutMe: () => null }));
vi.mock("@/components/brain/personal-memory", () => ({ PersonalMemory: () => null }));
vi.mock("@/components/brain/consolidation-history", () => ({ ConsolidationHistory: () => null }));
import { BrainScreen, BrainView } from "@/components/brain/brain-screen";
import { SessionMemory } from "@/components/brain/session-memory";
import { SharedLayers } from "@/components/brain/shared-layers";
const personal = knowledgeGraph.getPersonalKnowledge.out.parse({ scope: { kind: "personal", id: "me" }, revision: 0, claims: [], objects: [], edges: [], replaced: [] });
const threads = [{ threadId: "thread-original", projectId: "project-original", title: "原文 {title}", lastActivityAt: "2026-09-26T12:00:00Z", claims: 3, pending: 1, confirmed: 1, conflict: 1, objects: 2 }];
const overview = knowledgeGraph.getBrainOverview.out.parse({ threads, personalOrigins: [] });
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><LanguageSwitcher />{children}</I18nProvider>); }
function locale(value: string) { fireEvent.change(screen.getByTestId("language-switcher"), { target: { value } }); }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
beforeEach(() => { window.localStorage.clear(); window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, "token"); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("localizes live shell/tabs without re-reading or resetting the selected tab", async () => {
 const fetcher = vi.fn(async (input: RequestInfo | URL) => String(input).endsWith("/personal") ? json(personal) : json(overview)); vi.stubGlobal("fetch", fetcher);
 show(<BrainScreen />); await screen.findByTestId("brain-tabs");
 expect(screen.getByRole("heading", { name: "Brain" })).toBeTruthy();
 fireEvent.mouseDown(screen.getByTestId("brain-tab-sessions")); fireEvent.click(screen.getByTestId("brain-tab-sessions"));
 expect(screen.getByTestId("brain-sessions")).toContainHTML("原文 {title}");
 locale("zh-CN"); expect(screen.getByRole("heading", { name: "大脑" })).toBeTruthy();
 expect(screen.getByTestId("brain-tab-sessions")).toHaveAttribute("data-state", "active");
 locale("en"); expect(fetcher).toHaveBeenCalledTimes(2);
 expect(screen.getByTestId("brain-tab-sessions-count")).toHaveTextContent("1");
 expect(screen.getByTestId("brain-refresh")).toHaveTextContent("Refresh");
});
it("preserves original titles/links/counts and translates tri-state wrappers and dates", () => {
 show(<SessionMemory threads={threads} />);
 expect(screen.getByTestId("brain-sessions-summary")).toHaveTextContent("1 conversation");
 expect(screen.getByTestId("brain-sessions-summary")).toHaveTextContent("3 memories");
 const row = screen.getByTestId("brain-session-row"); expect(row).toHaveAttribute("href", "/chat/thread-original?projectId=project-original&memory=1");
 expect(row).toHaveTextContent("原文 {title}"); expect(row).toHaveTextContent("Project conversation"); expect(row).toHaveTextContent("Saved by AI"); expect(row).toHaveTextContent("Confirmed by you"); expect(row).toHaveTextContent("Conflicting");
 locale("zh-CN"); expect(row).toHaveTextContent("项目对话"); expect(row).toHaveTextContent("原文 {title}");
});
it("localizes empty and untitled conversation states without changing the destination", () => {
 const node=show(<SessionMemory threads={[]} />); expect(screen.getByTestId("brain-sessions")).toHaveTextContent("No conversation memories yet"); node.unmount();
 show(<SessionMemory threads={[{ ...threads[0]!, title: "  ", lastActivityAt: "invalid" }]} />);
 expect(screen.getByTestId("brain-session-row")).toHaveTextContent("Untitled conversation"); expect(screen.getByTestId("brain-session-row")).toHaveTextContent("—");
});
it.each(["loading", "failed", "denied"] as const)("localizes the %s state and retains reload behavior", (status) => {
 const reload=vi.fn(); show(<BrainView state={{ status }} reload={reload} refresh={async () => personal} />);
 const root=screen.getByTestId("brain-screen"); expect(root).not.toHaveTextContent("暂时读不到"); expect(root).not.toHaveTextContent("你已不在");
 if(status==="loading") expect(screen.getByTestId("brain-refresh")).toHaveTextContent("Loading…");
 if(status==="failed") expect(root).toHaveTextContent("Could not read your memories");
 if(status==="denied") expect(root).toHaveTextContent("no longer a member");
 locale("zh-CN"); locale("en"); expect(reload).not.toHaveBeenCalled();
});
it("retranslates an existing organization denial without replaying its read", async () => {
 const fetcher=vi.fn(async () => json({ error:"forbidden", traceId:"t", reasonCode:"KG_NOT_VISIBLE", message:"private detail" },403)); vi.stubGlobal("fetch",fetcher);
 show(<SharedLayers />); expect(screen.getByTestId("brain-layer-project")).toHaveTextContent("Project memory");
 fireEvent.click(screen.getByRole("button",{name:"View organization memory"}));
 await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("permission"));
 locale("zh-CN"); expect(screen.getByRole("alert")).toHaveTextContent("你没有权限"); locale("en");
 expect(fetcher).toHaveBeenCalledTimes(1); expect(screen.getByRole("alert")).not.toHaveTextContent("private detail");
 expect(screen.getByRole("link",{name:"View project memory"})).toHaveAttribute("href","/projects");
});
it("retains a raw organization statement when an already loaded view changes language", async () => {
 const scope={kind:"org",id:"org"};
 const org=knowledgeGraph.getOrgKnowledge.out.parse({scope,revision:1,objects:[],edges:[],claims:[{
  id:"claim-original",scope,kind:"fact",statement:"原文 {claim}",status:"accepted",triState:"confirmed",confidence:0.8,createdBy:"human",reviewedBy:"me",supersedesClaimId:null,derivedFromClaimId:null,aboutObjectIds:[],supportingCount:1,contradictingCount:0,createdAt:"2026-09-26T12:00:00Z",
 }]});
 const fetcher=vi.fn(async()=>json(org)); vi.stubGlobal("fetch",fetcher); show(<SharedLayers />);
 fireEvent.click(screen.getByRole("button",{name:"View organization memory"}));
 await waitFor(()=>expect(screen.getByTestId("brain-org-content")).toHaveTextContent("原文 {claim}"));
 locale("zh-CN"); locale("en"); expect(screen.getByTestId("brain-org-content")).toHaveTextContent("原文 {claim}"); expect(fetcher).toHaveBeenCalledTimes(1);
});
