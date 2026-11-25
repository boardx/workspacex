import * as React from "react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtInterviewWorkspace } from "@/features/aidt/components/aidt-interview-workspace";
import { aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload } from "@/features/aidt/lib/aidt-round-completion";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtInterviewDirectory } from "@/features/aidt/lib/aidt-interviews";

const mocked = vi.hoisted(() => ({ read: vi.fn(), history: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org", userId: "student", sessionToken: "session" } }),
}));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({
  readAidtStage: mocked.read,
  listAidtStageHistory: mocked.history,
}));

const projectId = "workspace-interviews";
let latest: AidtUiStageDraft;
function Workspace({ initial = emptyAidtUiDrafts()[2]!, entityId, onOpen, problemEntityId, problemRevision }: {
  problemEntityId?: string; problemRevision?: number;
  initial?: AidtUiStageDraft; entityId?: string | null; onOpen?: (id: string) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  latest = draft;
  return <AidtInterviewWorkspace projectId={projectId} draft={draft} update={setDraft} readOnly={false} entityId={entityId} onOpen={onOpen} problemEntityId={problemEntityId} problemRevision={problemRevision} />;
}

beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  mocked.history.mockResolvedValue({ items: [] });
  const draft = { ...emptyAidtUiDrafts()[1]!, fields: { rewrittenTheme: "午休见到奶茶新品时，学生如何决定是否购买？" } };
  const digest = await aidtRoundDigest(aidtRoundPayload(projectId, 1, draft, []));
  mocked.read.mockResolvedValue({ stage: { projectId, stageId: 1, revision: 2, sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: { ...draft, fields: { ...draft.fields, roundCompletion: aidtRoundConfirmation(projectId, 1, digest) } } } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps per-person questions independent across directory and saved entity views", async () => {
  const view = render(<Workspace />);
  await waitFor(() => expect(screen.getByTestId("aidt-new-entity-card")).toBeEnabled());
  fireEvent.click(screen.getByTestId("aidt-new-entity-card"));
  fireEvent.click(screen.getByRole("button", { name: "创建访谈" }));
  const guide = within(screen.getByRole("region", { name: "访谈提纲" }));
  fireEvent.change(guide.getByRole("textbox", { name: "学生提纲原稿" }), { target: { value: "U01 原稿" } });
  fireEvent.change(guide.getByRole("textbox", { name: "学生采纳清单" }), { target: { value: "U01 确认清单" } });
  fireEvent.click(guide.getByRole("button", { name: "确认此人的问题清单" }));
  fireEvent.click(screen.getByRole("button", { name: "返回访谈列表" }));
  fireEvent.click(screen.getByTestId("aidt-new-entity-card"));
  fireEvent.click(screen.getByRole("button", { name: "创建访谈" }));
  expect(screen.getByRole("textbox", { name: "学生提纲原稿" })).toHaveValue("");
  fireEvent.change(screen.getByRole("textbox", { name: "学生提纲原稿" }), { target: { value: "U02 原稿" } });
  const saved = StageDraft.parse(JSON.parse(JSON.stringify(latest)));
  const [first, second] = aidtInterviewDirectory(saved);
  expect(first?.id).not.toEqual(second?.id);
  view.unmount();

  const onOpen = vi.fn();
  const directory = render(<Workspace initial={saved} entityId={null} onOpen={onOpen} />);
  fireEvent.click(screen.getByRole("button", { name: /U01/ }));
  expect(onOpen).toHaveBeenCalledWith(first?.id);
  directory.unmount();

  render(<Workspace initial={saved} entityId={first!.id} />);
  const output = within(screen.getByRole("region", { name: "本次访谈产物" }));
  expect(output.getByText("U01 确认清单")).toBeVisible();
  expect(output.getByTestId("aidt-interview-guide-print")).toBeEnabled();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "确认人物发现卡" })).toBeNull();
});

it("opens only the explicitly selected historical problem entity and persists both coordinates", async () => {
  const id = "15c7b5e2-9d0e-4b10-bc47-000000000012";
  const confirmed = { fields: { rewrittenTheme: "第二个问题：怎样比较菜单上的口味？" }, ideas: [], selectedIdeaId: "" };
  const digest = await aidtRoundDigest(aidtRoundPayload(projectId, 1, confirmed, []));
  const entityFields = { ...confirmed.fields, roundCompletion: aidtRoundConfirmation(projectId, 1, digest) };
  const stage = { projectId, stageId: 1, revision: 3, sourceStageRevisions: [], content: { schemaVersion: 1, draft: { ...confirmed, fields: {
    ["problemEntity:" + id]: JSON.stringify({ id, archived: false }),
    ["problemDraft:" + id]: JSON.stringify(entityFields),
    rewrittenTheme: "另一条当前问题",
  } } } };
  mocked.read.mockResolvedValue({ stage: { ...stage, revision: 4 } });
  mocked.history.mockResolvedValue({ items: [stage] });
  const view = render(<Workspace problemEntityId={id} problemRevision={3} />);
  await waitFor(() => expect(screen.getByTestId("aidt-new-entity-card")).toBeEnabled());
  fireEvent.click(screen.getByTestId("aidt-new-entity-card"));
  fireEvent.click(screen.getByRole("button", { name: "创建访谈" }));
  expect(screen.getByText("第 1 步 V3 · 第二个问题：怎样比较菜单上的口味？")).toBeInTheDocument();
  const record = JSON.parse(Object.entries(latest.fields).find(([key]) => key.startsWith("interviewRecord:"))![1]);
  expect(record).toMatchObject({ problemEntityId: id, topicRevision: 3, topic: confirmed.fields.rewrittenTheme });
  view.unmount();

  render(<Workspace problemEntityId="15c7b5e2-9d0e-4b10-bc47-000000000099" problemRevision={3} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("研究问题读取失败");
  expect(screen.getByTestId("aidt-new-entity-card")).toBeDisabled();
});

it("persists card names and tags, filters, and removes a card without recycling its thread or code", async () => {
  const view = render(<Workspace entityId={null} />);
  await waitFor(() => expect(screen.getByTestId("aidt-new-entity-card")).toBeEnabled());
  const create = screen.getByTestId("aidt-new-entity-card");
  for (let n = 0; n < 10; n++) {
    fireEvent.click(create);
    if (n === 0) {
      fireEvent.change(screen.getByLabelText("受访者姓名或化名"), { target: { value: "小林" } });
      fireEvent.change(screen.getByTestId("interview-tag-input"), { target: { value: "茶饮" } });
    }
    if (n === 1) {
      const chip = within(screen.getByRole("group", { name: "已有标签" })).getByRole("button", { name: "茶饮" });
      fireEvent.click(chip);
      expect(chip).toHaveAttribute("aria-pressed", "true");
    }
    fireEvent.click(screen.getByRole("button", { name: "创建访谈" }));
  }
  const cards = () => within(screen.getByRole("list", { name: "访谈卡片" })).getAllByRole("listitem");
  expect(cards()).toHaveLength(10);
  const before = aidtInterviewDirectory(latest);
  fireEvent.click(within(cards()[0]!).getByRole("button", { name: "改名与标签" }));
  const editor = within(screen.getByRole("dialog"));
  fireEvent.change(editor.getByLabelText("受访者姓名或化名"), { target: { value: "校园茶饮访谈" } });
  fireEvent.change(editor.getByTestId("interview-tag-input"), { target: { value: "午休" } });
  fireEvent.click(editor.getByRole("button", { name: "保存修改" }));
  const persisted = StageDraft.parse(JSON.parse(JSON.stringify(latest)));
  view.unmount();
  const onOpen = vi.fn();
  render(<Workspace initial={persisted} entityId={null} onOpen={onOpen} />);
  await waitFor(() => expect(screen.getByTestId("aidt-new-entity-card")).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /午休/ }));
  expect(cards()).toHaveLength(1);
  expect(cards()[0]).toHaveTextContent("校园茶饮访谈");
  fireEvent.click(within(cards()[0]!).getByRole("button", { name: /^U01 / }));
  expect(onOpen).toHaveBeenLastCalledWith(before[0]!.id);
  fireEvent.click(within(cards()[0]!).getByRole("button", { name: "删除访谈卡" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "确认删除" }));
  expect(cards()).toHaveLength(9);
  expect(aidtInterviewDirectory(latest).find(item => item.id === before[0]!.id)?.archived).toBe(true);
  fireEvent.click(screen.getByTestId("aidt-new-entity-card"));
  fireEvent.click(screen.getByRole("button", { name: "创建访谈" }));
  expect(cards()).toHaveLength(10);
  expect(screen.getByRole("button", { name: /^U11 / })).toBeEnabled();
});
