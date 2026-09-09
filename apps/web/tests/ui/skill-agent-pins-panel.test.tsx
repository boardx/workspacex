import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { SkillContentEditorSection } from "@/components/admin/skill-content-editor";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SkillAgentPinsPanel } from "@/components/admin/skill-agent-pins-panel";
import { replaceSkillPins } from "@/lib/live-agent-skill-pins";
import { ApiError } from "@/lib/api-client";
vi.mock("@/components/admin/skill-multi-file-editor", () => ({ SkillMultiFileEditor: () => <div>Real editor slot</div> }));
const identity = vi.hoisted(() => ({ status: "authenticated", userId: "user-1", currentOrgId: "org-1", sessionToken: "token-1" }));
vi.mock("@/components/session/session-provider", () => ({ useSession: () => ({ status: identity.status, session: identity.status === "anonymous" ? null : { userId: identity.userId, currentOrgId: identity.currentOrgId, sessionToken: identity.sessionToken } }) }));
const m = vi.hoisted(() => ({ list: vi.fn(), directory: vi.fn(), snapshot: vi.fn(), get: vi.fn(), set: vi.fn() }));
vi.mock("@/lib/agent-definition", () => ({ listAgents: m.list }));
vi.mock("@/lib/asset-directory", () => ({ getAssetDirectory: m.directory }));
vi.mock("@/lib/live-skill-files", () => ({ getSkillFileSnapshot: m.snapshot }));
vi.mock("@/lib/live-agent-skill-pins", async original => ({ ...await original<typeof import("@/lib/live-agent-skill-pins")>(), getAgentSkillPins: m.get, setAgentSkillPins: m.set }));
const before = { agentId: "agent-1", publishedVersionId: "agent-v1", pins: [{ skillId: "other-first", versionId: "keep-1" }, { skillId: "skill-1", versionId: "skill-old" }, { skillId: "other-last", versionId: "keep-2" }] };
const after = { ...before, publishedVersionId: "agent-v2", pins: before.pins.map(pin => pin.skillId === "skill-1" ? { ...pin, versionId: "skill-new" } : pin) };
const select = () => fireEvent.change(screen.getByLabelText("选择 Agent"), { target: { value: "agent-1" } });
const agree = () => fireEvent.click(screen.getByRole("checkbox", { name: /我已核对/ }));
const click = (name: string) => fireEvent.click(screen.getByRole("button", { name }));
const ready = async () => { render(<SkillAgentPinsPanel skillId="skill-1" />); await screen.findByText(/Agent One/); select(); await screen.findByTestId("current-agent-pins"); };
beforeEach(() => { Object.assign(identity, { status: "authenticated", userId: "user-1", currentOrgId: "org-1", sessionToken: "token-1" }); vi.clearAllMocks(); m.list.mockResolvedValue([{ agentId: "agent-1", name: "Agent One" }]); m.directory.mockResolvedValue({ currentVersionId: "skill-new" }); m.snapshot.mockResolvedValue({ skillId: "skill-1", versionId: "skill-new", semanticLabel: "v2" }); m.get.mockResolvedValue(before); });
describe("real Agent Skill pin controls", () => {
  it("connects the real Skill editor to an existing binding route", () => {
    render(<SkillContentEditorSection id="editor" row={{ id:"skill-1", orgId:"org-1", kind:"skill", name:"Skill One", scope:"org-wide", enabled:true, endpoint:null, disabledReason:null, duty:null, abbr:null }} />);
    expect(screen.getByRole("link", { name: "固定版本到 Agent / 恢复旧绑定" })).toHaveAttribute("href", "/platform-admin/skill/skill-1/bindings");
    expect(existsSync(resolve(process.cwd(), "app/platform-admin/skill/[id]/bindings/page.tsx"))).toBe(true);
  });
  it("requires consent, preserves every other pin and uses the current published Agent CAS", async () => {
    await ready(); expect(screen.getByRole("button", { name: "固定所示 Skill 版本" })).toBeDisabled();
    m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v2", skillVersionIds: ["keep-1", "skill-new", "keep-2"] }); m.get.mockResolvedValue(after);
    agree(); click("固定所示 Skill 版本");
    await waitFor(() => expect(m.set).toHaveBeenCalledWith("agent-1", "agent-v1", ["keep-1", "skill-new", "keep-2"]));
    await waitFor(() => expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("agent-v2"));
    expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("other-first · keep-1");
    m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v3", skillVersionIds: ["keep-1", "skill-old", "keep-2"] }); m.get.mockResolvedValue({ ...before, publishedVersionId: "agent-v3" });
    expect(screen.getByRole("button", { name: "恢复本页上次 Skill 固定项" })).toBeDisabled(); agree(); click("恢复本页上次 Skill 固定项");
    await waitFor(() => expect(m.set).toHaveBeenLastCalledWith("agent-1", "agent-v2", ["keep-1", "skill-old", "keep-2"]));
  });
  it("restores an originally empty pin set with explicit organization-default semantics", async () => {
    m.get.mockResolvedValue({ ...before, pins: [] }); await ready();
    expect(screen.getByText(/自动加载全部已启用 Skill/)).toBeVisible();
    m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v2", skillVersionIds: ["skill-new"] }); m.get.mockResolvedValue({ ...after, pins: [{ skillId: "skill-1", versionId: "skill-new" }] });
    agree(); click("固定所示 Skill 版本"); await screen.findByRole("button", { name: "恢复本页上次 Skill 固定项" });
    expect(screen.getByText(/恢复组织默认 Skill 选择/)).toBeVisible();
    m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v3", skillVersionIds: [] }); m.get.mockResolvedValue({ ...before, publishedVersionId: "agent-v3", pins: [] });
    agree(); click("恢复本页上次 Skill 固定项"); await waitFor(() => expect(m.set).toHaveBeenLastCalledWith("agent-1", "agent-v2", []));
  });
  it("clears stale authority after conflict and requires a fresh read and confirmation", async () => {
    await ready(); m.set.mockRejectedValue(new ApiError(409, "VERSION_CHANGED", {})); agree(); click("固定所示 Skill 版本");
    expect(await screen.findByRole("alert")).toHaveTextContent("未覆盖其他人的绑定"); expect(screen.queryByTestId("current-agent-pins")).not.toBeInTheDocument();
    m.get.mockResolvedValue({ ...before, publishedVersionId: "concurrent-version" }); click("重新读取 Agent 绑定");
    await screen.findByTestId("current-agent-pins"); expect(screen.getByRole("checkbox", { name: /我已核对/ })).not.toBeChecked(); expect(m.set).toHaveBeenCalledTimes(1);
  });
  it("restores only this Skill after refreshing a concurrent change to another pin", async () => {
    await ready(); m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v2", skillVersionIds: ["keep-1", "skill-new", "keep-2"] }); m.get.mockResolvedValue(after);
    agree(); click("固定所示 Skill 版本"); await screen.findByRole("button", { name: "恢复本页上次 Skill 固定项" });
    const concurrent = { ...after, publishedVersionId: "agent-v3", pins: [...after.pins, { skillId: "added-elsewhere", versionId: "must-preserve" }] };
    m.get.mockResolvedValue(concurrent); click("重新读取 Agent 绑定");
    await waitFor(() => expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("agent-v3"));
    m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v4", skillVersionIds: ["keep-1", "skill-old", "keep-2", "must-preserve"] });
    agree(); click("恢复本页上次 Skill 固定项");
    await waitFor(() => expect(m.set).toHaveBeenLastCalledWith("agent-1", "agent-v3", ["keep-1", "skill-old", "keep-2", "must-preserve"]));
  });
  it("never offers Agent A recovery after switching to Agent B", async () => {
    m.list.mockResolvedValue([{ agentId: "agent-1", name: "Agent One" }, { agentId: "agent-2", name: "Agent Two" }]);
    await ready(); m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v2", skillVersionIds: ["keep-1", "skill-new", "keep-2"] }); m.get.mockResolvedValue(after);
    agree(); click("固定所示 Skill 版本"); await screen.findByRole("button", { name: "恢复本页上次 Skill 固定项" });
    m.get.mockResolvedValue({ agentId: "agent-2", publishedVersionId: "b-head", pins: [{ skillId: "skill-1", versionId: "b-old" }] });
    fireEvent.change(screen.getByLabelText("选择 Agent"), { target: { value: "agent-2" } });
    await waitFor(() => expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("b-head"));
    expect(screen.queryByRole("button", { name: "恢复本页上次 Skill 固定项" })).not.toBeInTheDocument();
    expect(screen.queryByText(/skill-old/)).not.toBeInTheDocument();
    agree(); click("固定所示 Skill 版本");
    await waitFor(() => expect(m.set).toHaveBeenLastCalledWith("agent-2", "b-head", ["skill-new"]));
  });
  it("ignores an Agent A write resolving after a forced Agent selection change", async () => {
    m.list.mockResolvedValue([{ agentId: "agent-1", name: "Agent One" }, { agentId: "agent-2", name: "Agent Two" }]);
    let finish!: (value: unknown) => void; m.set.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    await ready(); agree(); click("固定所示 Skill 版本");
    expect(screen.getByLabelText("选择 Agent")).toBeDisabled();
    // Deliberately exercise the async boundary even though ordinary user switching is disabled while saving.
    m.get.mockResolvedValue({ agentId: "agent-2", publishedVersionId: "b-head", pins: [] });
    fireEvent.change(screen.getByLabelText("选择 Agent"), { target: { value: "agent-2" } });
    await waitFor(() => expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("b-head"));
    const reads = m.get.mock.calls.length;
    await act(async () => { finish({ agentId: "agent-1", versionId: "a-late-head", skillVersionIds: ["skill-new"] }); });
    expect(m.get).toHaveBeenCalledTimes(reads);
    expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("b-head");
    expect(screen.queryByRole("button", { name: "恢复本页上次 Skill 固定项" })).not.toBeInTheDocument();
    expect(screen.queryByText(/a-late-head/)).not.toBeInTheDocument();
  });
  it("isolates an in-flight write when the authenticated organization changes", async () => {
    let finish!: (value: unknown) => void; m.set.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<SkillAgentPinsPanel skillId="skill-1" />); await screen.findByText(/Agent One/); select(); await screen.findByTestId("current-agent-pins"); agree(); click("固定所示 Skill 版本");
    identity.currentOrgId = "org-2"; identity.userId = "user-2"; identity.sessionToken = "token-2";
    view.rerender(<SkillAgentPinsPanel skillId="skill-1" />);
    expect(screen.queryByTestId("current-agent-pins")).not.toBeInTheDocument();
    m.get.mockResolvedValue({ ...before, publishedVersionId: "new-identity-head", pins: [] });
    await screen.findByText(/Agent One/); select(); await screen.findByTestId("current-agent-pins");
    await act(async () => { finish({ agentId: "agent-1", versionId: "old-identity-late-write", skillVersionIds: ["skill-new"] }); });
    expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("new-identity-head");
    expect(screen.queryByText(/old-identity-late-write/)).not.toBeInTheDocument(); expect(screen.queryByRole("button", { name: "恢复本页上次 Skill 固定项" })).not.toBeInTheDocument();
  });
  it("hides all prior pins immediately on logout and rejects delayed reads", async () => {
    let finish!: (value: unknown) => void; m.get.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<SkillAgentPinsPanel skillId="skill-1" />); await screen.findByText(/Agent One/); select();
    identity.status = "anonymous"; view.rerender(<SkillAgentPinsPanel skillId="skill-1" />);
    expect(screen.queryByLabelText("选择 Agent")).not.toBeInTheDocument();
    await act(async () => { finish(before); });
    expect(screen.queryByTestId("current-agent-pins")).not.toBeInTheDocument(); expect(screen.getByRole("status")).toHaveTextContent("请登录");
  });
  it("retains a recovery intent and requires re-read when a successful write response cannot be confirmed", async () => {
    await ready(); m.set.mockRejectedValue(new Error("invalid response after 201")); agree(); click("固定所示 Skill 版本");
    expect(await screen.findByRole("alert")).toHaveTextContent("写入结果未确认"); expect(screen.queryByTestId("current-agent-pins")).not.toBeInTheDocument();
    m.get.mockResolvedValue(after); click("重新读取 Agent 绑定"); await screen.findByTestId("current-agent-pins");
    expect(screen.getByText(/本页上次变更前/)).toHaveTextContent("skill-old"); expect(screen.getByRole("checkbox", { name: /我已核对/ })).not.toBeChecked();
  });
  it("does not mistake a successful write followed by failed read for an unapplied change", async () => {
    await ready(); m.set.mockResolvedValue({ agentId: "agent-1", versionId: "agent-v2", skillVersionIds: ["keep-1", "skill-new", "keep-2"] }); m.get.mockRejectedValue(new Error("read outage"));
    agree(); click("固定所示 Skill 版本"); expect(await screen.findByRole("alert")).toHaveTextContent("写入已成功，但重新读取失败"); expect(screen.queryByTestId("current-agent-pins")).not.toBeInTheDocument();
  });
  it("rejects late writes from the old Skill page and preserves non-target order for multi-pins", async () => {
    expect(replaceSkillPins([...before.pins, { skillId: "skill-1", versionId: "another-old" }], "skill-1", ["new-a", "new-b"])).toEqual(["keep-1", "new-a", "new-b", "keep-2"]);
    let finish!: (value: unknown) => void; m.set.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const view = render(<SkillAgentPinsPanel skillId="skill-1" />); await screen.findByText(/Agent One/); select(); await screen.findByTestId("current-agent-pins"); agree(); click("固定所示 Skill 版本");
    m.get.mockResolvedValue({ ...before, publishedVersionId: "other-skill-head" }); view.rerender(<SkillAgentPinsPanel skillId="skill-2" />);
    await screen.findByText(/Agent One/); select();
    await waitFor(() => expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("other-skill-head"));
    await act(async () => { finish({ agentId: "agent-1", versionId: "late-head", skillVersionIds: [] }); });
    expect(screen.getByTestId("current-agent-pins")).toHaveTextContent("other-skill-head"); expect(screen.queryByText(/late-head/)).not.toBeInTheDocument();
  });
});
