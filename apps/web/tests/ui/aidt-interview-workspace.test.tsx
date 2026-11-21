import * as React from "react";
import { webcrypto } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { AidtInterviewWorkspace } from "@/features/aidt/components/aidt-interview-workspace";
import { aidtRoundConfirmation, aidtRoundDigest, aidtRoundPayload } from "@/features/aidt/lib/aidt-round-completion";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtInterviewDirectory } from "@/features/aidt/lib/aidt-interviews";

const mocked = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/components/session/session-provider", () => ({
  useOptionalSession: () => ({ session: { currentOrgId: "org", userId: "student", sessionToken: "session" } }),
}));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({
  readAidtStage: mocked.read,
  listAidtStageHistory: vi.fn(async () => ({ items: [] })),
}));

const projectId = "workspace-interviews";
let latest: AidtUiStageDraft;
function Workspace({ initial = emptyAidtUiDrafts()[2]!, entityId, onOpen }: {
  initial?: AidtUiStageDraft; entityId?: string | null; onOpen?: (id: string) => void;
}) {
  const [draft, setDraft] = React.useState(initial);
  latest = draft;
  return <AidtInterviewWorkspace projectId={projectId} draft={draft} update={setDraft} readOnly={false} entityId={entityId} onOpen={onOpen} />;
}

beforeEach(async () => {
  vi.stubGlobal("crypto", webcrypto);
  const draft = { ...emptyAidtUiDrafts()[1]!, fields: { rewrittenTheme: "午休见到奶茶新品时，学生如何决定是否购买？" } };
  const digest = await aidtRoundDigest(aidtRoundPayload(projectId, 1, draft, []));
  mocked.read.mockResolvedValue({ stage: { projectId, stageId: 1, revision: 2, sourceStageRevisions: [],
    content: { schemaVersion: 1, draft: { ...draft, fields: { ...draft.fields, roundCompletion: aidtRoundConfirmation(projectId, 1, digest) } } } } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps per-person questions independent across directory and saved entity views", async () => {
  const view = render(<Workspace />);
  await screen.findByText("已确认研究问题 · 第 1 步 V2");
  fireEvent.click(screen.getByRole("button", { name: "新建访谈" }));
  const guide = within(screen.getByRole("region", { name: "访谈提纲" }));
  fireEvent.change(guide.getByRole("textbox", { name: "学生提纲原稿" }), { target: { value: "U01 原稿" } });
  fireEvent.change(guide.getByRole("textbox", { name: "学生采纳清单" }), { target: { value: "U01 确认清单" } });
  fireEvent.click(guide.getByRole("button", { name: "确认此人的问题清单" }));
  fireEvent.click(screen.getByRole("button", { name: "返回访谈列表" }));
  fireEvent.click(screen.getByRole("button", { name: "新建访谈" }));
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
  expect(screen.getByRole("textbox", { name: "学生提纲原稿" })).toHaveValue("U01 原稿");
  expect(screen.getByRole("textbox", { name: "学生采纳清单" })).toHaveValue("U01 确认清单");
  expect(screen.getByRole("button", { name: "确认人物发现卡" })).toBeDisabled();
});
