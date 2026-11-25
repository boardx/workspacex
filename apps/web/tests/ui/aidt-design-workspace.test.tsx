import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtDesignWorkspace } from "@/features/aidt/components/aidt-design-workspace";
const mock = vi.hoisted(() => ({ enabled: true, load: vi.fn(), native: vi.fn(), projects: vi.fn(), stage: vi.fn(), material: vi.fn(), learning: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mock.enabled }));
vi.mock("@/features/aidt/lib/aidt-design-handoff", () => ({ loadAidtDesignHandoff: mock.load }));
vi.mock("@/lib/live-design-workbench", async original => ({ ...await original<typeof import("@/lib/live-design-workbench")>(), listMyProjects: mock.projects }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mock.stage }));
vi.mock("@/features/aidt/lib/aidt-research-materials", () => ({ readAidtResearchMaterial: mock.material }));
vi.mock("@/features/aidt/lib/aidt-iteration-design-context", async original => ({ ...await original<typeof import("@/features/aidt/lib/aidt-iteration-design-context")>(), loadAidtIterationDesignContext: mock.learning }));
vi.mock("@/components/design-loop/detail-screen", () => ({ DesignDetailScreen: (props: { requiredContextText?: string; requiredContextId?: string; beforeSend?: (signal: AbortSignal) => Promise<void>; sendBlockedReason?: string; autoStart?: boolean; contained?: boolean }) => {
  mock.native(props);
  return <div data-testid="native-props" data-autostart={String(props.autoStart)} data-contained={String(props.contained)} data-context-id={props.requiredContextId}><span>{props.requiredContextText}</span>{props.sendBlockedReason && <span data-testid="native-blocked">{props.sendBlockedReason}</span>}</div>;
} }));
const sourceImage = { ideaId: "idea-a", title: "固定来源图", stage4Revision: 2, brainstormId: "round-a", reference: { projectId: "class", runId: "image-run", artifactId: "image-artifact", versionId: "image-v1", name: "source.png", mime: "image/png", sha256: "b".repeat(64), bytes: 42 } };
const nativeImage = { id: "actual-native-image", name: "saved-source.png", size: 42, mime: "image/png", createdAt: "2026-11-22" };
const nativeProject = { id: "design", refImages: [nativeImage] };
const result = (text = "已保存旧轮问题") => ({ offer: { id: text, label: "来源", text }, sources: [{ stageId: 5, revision: 3 }], sourceImages: [sourceImage], warnings: [], textBasis: { designId: "design", stageRevision: 3, textVersion: "text-v2", textSha256: "a".repeat(64) } });
const props = { projectId: "design", teachingProjectId: "class", stageId: 6, lifecycleKey: "org/student", sessionToken: "token" };
beforeEach(() => {
  vi.clearAllMocks(); mock.enabled = true; mock.load.mockResolvedValue(result());
  mock.learning.mockResolvedValue("第6步 V31 · 固定上轮学习：先补研究，不代表验证成功。");
  mock.projects.mockResolvedValue({ items: [nativeProject] }); mock.material.mockResolvedValue({ reference: sourceImage.reference });
  const images = [{ sourceRunId: "image-run", artifactId: "image-artifact", versionId: "image-v1", sha256: "b".repeat(64), stage4Revision: 2, brainstormId: "round-a",
    nativeImageId: nativeImage.id, nativeName: nativeImage.name, nativeSize: nativeImage.size, nativeMime: nativeImage.mime }];
  mock.stage.mockResolvedValue({ stage: { content: { draft: { fields: { "prototypeEntity:design": JSON.stringify({
    prototypeIdeaSource: JSON.stringify({ revision: 2, brainstormId: "round-a", ideaIds: ["idea-a"] }),
    prototypeSourceImages: JSON.stringify({ schemaVersion: 1, projectId: "class", designId: "design", textStageRevision: 3, textVersion: "text-v2", textSha256: "a".repeat(64), images }),
  }) }, ideas: [], selectedIdeaId: "" } } } });
});
it("pins the confirmed text and its source ID to the native host props after a saved-context read, explicitly disabling autostart", async () => {
  render(<AidtDesignWorkspace {...props} returnRevision="7" />);
  expect(await screen.findByText("已保存旧轮问题")).toBeVisible();
  expect(screen.getByTestId("native-props")).toHaveAttribute("data-contained", "true");
  expect(screen.getByTestId("native-props")).toHaveAttribute("data-autostart", "false");
  expect(screen.getByTestId("native-props")).toHaveAttribute("data-context-id", "已保存旧轮问题");
  expect(mock.native.mock.calls.at(-1)?.[0].beforeSend).toBeTypeOf("function");
  expect(screen.queryByTestId("native-blocked")).not.toBeInTheDocument();
  expect(mock.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: "class", stageId: 6, roundRevision: 7, sessionToken: "token" }));
});
it("keeps failed reads distinct from empty context and offers an explicit retry", async () => {
  mock.load.mockRejectedValueOnce(new Error("503")); render(<AidtDesignWorkspace {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("未使用当前草稿或其他版本替代");
  expect(screen.getByTestId("native-blocked")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "重新读取已保存制作说明" }));
  expect(await screen.findByText("已保存旧轮问题")).toBeVisible();
});
it("aborts a previous actor's delayed read and does not leak their offer into a new identity", async () => {
  let finish!: (value: ReturnType<typeof result>) => void;
  mock.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; })).mockResolvedValue(result("新身份保存问题"));
  const { rerender } = render(<AidtDesignWorkspace {...props} />);
  const signal = mock.load.mock.calls[0]![0].signal as AbortSignal;
  rerender(<AidtDesignWorkspace {...props} lifecycleKey="org/another" sessionToken="new-token" />);
  expect(signal.aborted).toBe(true); expect(await screen.findByText("新身份保存问题")).toBeVisible();
  await act(async () => { finish(result("前身份私有说明")); });
  expect(screen.queryByText("前身份私有说明")).not.toBeInTheDocument();
});
it("performs no context read while the optional module is disabled", () => {
  mock.enabled = false; render(<AidtDesignWorkspace {...props} />);
  expect(screen.queryByTestId("native-props")).not.toBeInTheDocument(); expect(mock.load).not.toHaveBeenCalled();
});


it("keeps native generation blocked when the saved context has no exact text basis for this Design", async () => {
  mock.load.mockResolvedValueOnce({ ...result(), textBasis: undefined });
  const view = render(<AidtDesignWorkspace {...props} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("保存并确认文字设计的确切修订");
  expect(screen.getByTestId("native-blocked")).toBeVisible(); view.unmount();
  mock.load.mockResolvedValueOnce({ ...result(), textBasis: { ...result().textBasis, designId: "another-design" } });
  render(<AidtDesignWorkspace {...props} />); expect(await screen.findByRole("alert")).toHaveTextContent("保存并确认文字设计的确切修订");
});

it("rechecks the same saved text before a native send and rejects a replacement revision", async () => {
  render(<AidtDesignWorkspace {...props} prototypeEntityId="design" />); await screen.findByText("已保存旧轮问题");
  const beforeSend = mock.native.mock.calls.at(-1)![0].beforeSend;
  const controller = new AbortController();
  await expect(beforeSend(controller.signal, nativeProject)).resolves.toEqual(nativeProject);
  expect(mock.load.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({ projectId: "class", stageId: 6, prototypeEntityId: "design", sessionToken: "token", signal: controller.signal }));
  mock.load.mockResolvedValueOnce(result("不同确认稿"));
  await expect(beforeSend(controller.signal, nativeProject)).rejects.toThrow("AIDT_CONTEXT_CHANGED");
});

it("does not read or permit source generation without a session", async () => {
  render(<AidtDesignWorkspace {...props} sessionToken={null} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("登录并选择组织"); expect(mock.load).not.toHaveBeenCalled();
  await expect(mock.native.mock.calls.at(-1)![0].beforeSend(new AbortController().signal)).rejects.toThrow("AIDT_PROTOTYPE_TEXT_CONFIRMATION_REQUIRED");
});

it("uses current confirmed S5 text plus independently pinned old learning in returnEntity mode, and rechecks both before native send", async () => {
  const current = { ...result("当前已确认V3文字设计"), textBasis: { ...result().textBasis, stageRevision: 24, textVersion: "text-v3", textSha256: "c".repeat(64) } };
  mock.load.mockResolvedValue(current);
  const previous = await mock.stage();
  const entity = JSON.parse(previous.stage.content.draft.fields["prototypeEntity:design"]);
  entity.prototypeSourceImages = JSON.stringify({ ...JSON.parse(entity.prototypeSourceImages), textStageRevision: 24, textVersion: "text-v3", textSha256: "c".repeat(64) });
  mock.stage.mockResolvedValue({ ...previous, stage: { ...previous.stage, content: { draft: { ...previous.stage.content.draft, fields: { "prototypeEntity:design": JSON.stringify(entity) } } } } });
  render(<AidtDesignWorkspace {...props} stageId={5} prototypeEntityId="design" returnRevision="31" returnEntity="test-group-a" />);
  await waitFor(() => expect(mock.native.mock.calls.at(-1)![0].requiredContextText).toContain("当前已确认V3文字设计"));
  const native = mock.native.mock.calls.at(-1)![0];
  expect(native.requiredContextText).toContain("固定上轮学习"); expect(native.requiredContextText).not.toContain("已保存旧轮问题");
  expect(mock.load.mock.calls[0]![0]).toMatchObject({ stageId: 5, roundRevision: undefined, prototypeEntityId: "design" });
  expect(mock.learning).toHaveBeenCalledWith(expect.objectContaining({ projectId: "class", designId: "design", entityId: "test-group-a", revision: "31", sessionToken: "token" }));
  await expect(native.beforeSend(new AbortController().signal, nativeProject)).resolves.toEqual(nativeProject);
  mock.learning.mockResolvedValueOnce("另一测试组或已变化的学习内容");
  await expect(native.beforeSend(new AbortController().signal, nativeProject)).rejects.toThrow("AIDT_CONTEXT_CHANGED");
});

it("does not fall back to old design text when an entity-specific learning record is unavailable", async () => {
  mock.learning.mockRejectedValueOnce(new Error("AIDT_DESIGN_RETURN_CONTEXT_INVALID"));
  render(<AidtDesignWorkspace {...props} stageId={5} prototypeEntityId="design" returnRevision="31" returnEntity="test-group-a" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("历史学习记录尚未确认");
  expect(screen.getByTestId("native-blocked")).toBeVisible();
  expect(mock.native.mock.calls.at(-1)![0].requiredContextText).toBe("");
});

it("retains legacy frozen returnRevision semantics without inventing an entity-specific current-text return", async () => {
  render(<AidtDesignWorkspace {...props} stageId={5} returnRevision="31" prototypeEntityId="design" />);
  expect(await screen.findByText("已保存旧轮问题")).toBeVisible();
  expect(mock.load).toHaveBeenCalledWith(expect.objectContaining({ stageId: 5, roundRevision: 31 }));
  expect(mock.learning).not.toHaveBeenCalled();
});
