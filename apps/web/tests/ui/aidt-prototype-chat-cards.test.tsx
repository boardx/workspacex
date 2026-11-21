import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { AidtPrototypeConversation, AidtPrototypeEntityOutput } from "@/features/aidt/components/aidt-prototype-handoff";
import { AidtPrototypeDirectory } from "@/features/aidt/components/aidt-prototype-directory";
import { aidtAllActivePrototypeEntitiesConfirmed, archiveAidtPrototypeCard, confirmAidtPrototypeEntityHandoff, readAidtPrototypeEntityDraft, updateAidtPrototypeCard, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";

const mocks = vi.hoisted(() => ({ create: vi.fn(), list: vi.fn(), link: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => ({ session: { currentOrgId: "o", userId: "u", sessionToken: "token" } }) }));
vi.mock("@/lib/live-project-resources", () => ({ listProjectResources: mocks.list, linkProjectResource: mocks.link }));
vi.mock("@/lib/live-design-workbench", () => ({ createProject: mocks.create }));
vi.mock("@/features/aidt/components/aidt-prototype-version-picker", () => ({ AidtPrototypeVersionPicker: () => <div>原生版本选择器</div> }));

const empty = (): AidtUiStageDraft => ({ fields: {}, ideas: [], selectedIdeaId: "" });
const designId = "native-design";
const requestSave = vi.fn();

it("projects the entity discussion to the read-only inspector, confirming only from Chat", async () => {
  const messages = [
    { id: "student", role: "user", content: "我们想试一张菜单卡" },
    { id: "coach", role: "assistant", content: '草稿\n```aidt-prototype\n{"verificationQuestion":"学生能否快速区分口味？","type":"菜单卡","prototypeReference":"偽造授信","prototypeArchived":"true"}\n```' },
  ];
  function Harness() {
    const [stageDraft, setDraft] = React.useState(() => updateAidtPrototypeCard(empty(), designId, "菜单卡"));
    const shared = { designId, projectId: "project", workflow: { matchesServer: false }, stageDraft, update: setDraft, readOnly: false };
    return <><AidtPrototypeConversation {...shared} messages={messages} loading={false} running={false} requestSave={requestSave} />
      <AidtPrototypeEntityOutput {...shared} presentationOnly /><output data-testid="stage">{JSON.stringify(stageDraft)}</output></>;
  }
  render(<Harness />);
  const inspector = screen.getByRole("region", { name: "当前原型产物" });
  await within(inspector).findByText("学生能否快速区分口味？");
  expect(within(inspector).queryByRole("textbox")).toBeNull();
  expect(within(inspector).queryByRole("button", { name: /确认/ })).toBeNull();
  expect(requestSave).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole("region", { name: "原型对话操作" })).getByRole("button", { name: "确认原型草稿" }));
  const draft = readAidtPrototypeEntityDraft(JSON.parse(screen.getByTestId("stage").textContent!), designId);
  expect(draft?.fields.verificationQuestion).toBe("学生能否快速区分口味？");
  expect(draft?.fields.prototypeReference).toBeUndefined();
  expect(draft?.fields.prototypeArchived).toBeUndefined();
  expect(requestSave).toHaveBeenCalledOnce();
});

it("requires every active prototype to have a matching persisted confirmation and preserves archived drafts", () => {
  const makeReady = (id: string) => confirmAidtVerificationQuestion(updateAidtPrototypeReference({
    ...empty(), fields: {
      verificationQuestion: "能否区分口味？", beforeTestBelief: "可能可以", verificationBasis: "暂无材料", verificationLimits: "静态图",
      prototypeIdeaSource: '{"revision":1,"ideaIds":["menu"]}', type: "菜单卡", situation: "午休", task: "选择口味",
    },
  }, { designId: id, versionId: "v1", designName: id, seq: 1, summary: "学生稿", source: "user",
    createdAt: "2026-11-16T00:00:00.000Z", frameCount: 1, generatedFrameCount: 1 }))!;
  const one = confirmAidtPrototypeEntityHandoff(updateAidtPrototypeEntityDraft(empty(), "A", () => makeReady("A")), "A");
  const incomplete = updateAidtPrototypeCard(one, "B", "第二张卡");
  expect(aidtAllActivePrototypeEntitiesConfirmed(incomplete)).toBe(false);
  const complete = confirmAidtPrototypeEntityHandoff(updateAidtPrototypeEntityDraft(incomplete, "B", () => makeReady("B")), "B");
  expect(aidtAllActivePrototypeEntitiesConfirmed(complete)).toBe(true);
  const archived = archiveAidtPrototypeCard(complete, "B");
  expect(aidtAllActivePrototypeEntitiesConfirmed(archived)).toBe(true);
  expect(readAidtPrototypeEntityDraft(archived, "B")?.fields.verificationQuestion).toBe("能否区分口味？");
});

it("saves card create, rename and archive while retaining the native Design relationship", async () => {
  const resources: { id: string; kind: string; title: string }[] = [];
  mocks.list.mockImplementation(async () => ({ items: [...resources] }));
  mocks.create.mockResolvedValue({ project: { id: designId } });
  mocks.link.mockImplementation(async () => { resources.push({ id: designId, kind: "design", title: "菜单卡" }); });
  function Harness() {
    const [draft, setDraft] = React.useState(empty);
    return <AidtPrototypeDirectory projectId="project" canWrite draft={draft} ideaRevision="8" saveDraft={async change => { setDraft(change); return true; }} />;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "新建原型" }));
  fireEvent.change(screen.getByLabelText("原型名称"), { target: { value: "菜单卡" } });
  fireEvent.click(screen.getByRole("button", { name: "创建原型" }));
  expect(await screen.findByRole("link", { name: "菜单卡" })).toHaveAttribute("href", expect.stringContaining("ideaRevision=8"));
  expect(mocks.link).toHaveBeenCalledWith({ projectId: "project", kind: "design", resourceId: designId });
  fireEvent.click(screen.getByRole("button", { name: "编辑原型 菜单卡" }));
  fireEvent.change(screen.getByLabelText("原型名称"), { target: { value: "饮品对比卡" } });
  fireEvent.click(screen.getByRole("button", { name: "保存修改" }));
  await screen.findByRole("link", { name: "饮品对比卡" });
  fireEvent.click(screen.getByRole("button", { name: "删除原型 饮品对比卡" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "饮品对比卡" })).toBeNull());
  expect(resources).toHaveLength(1);
});
