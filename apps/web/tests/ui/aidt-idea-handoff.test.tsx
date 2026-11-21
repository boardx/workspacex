import * as React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AIDT_STEPS } from "@/features/aidt/lib/project-aidt";
import { AidtBrainstormDirectory } from "@/features/aidt/components/aidt-brainstorm";
import { AidtEntityCardDirectory } from "@/features/aidt/components/aidt-entity-card";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { AidtIdeaDirectory } from "@/features/aidt/components/aidt-idea-directory";
import { AidtIdeaHandoff } from "@/features/aidt/components/aidt-idea-handoff";
import { AidtStageOutput } from "@/features/aidt/components/aidt-stage-output";
import { archiveAidtIdea, createAidtIdea, invalidateAidtIdeaSheets, readAidtIdeaDirectory, readAidtIdeaHandoff } from "@/features/aidt/lib/aidt-idea-handoff";
import { emptyAidtUiDrafts } from "@/features/aidt/lib/aidt-ui-drafts";

const ids = ["menu", "comparison", "samples"];
const hmw = { revision: 7, id: "hmw-1", text: "我们如何帮助学生看懂新品口味？" };
const ideaImage = (id: string, projectId = "project-1") => JSON.stringify({
  projectId, runId: `run-${id}`, artifactId: `artifact-${id}`, versionId: "version-1",
  name: "图.png", mime: "image/png", sha256: "a".repeat(64), bytes: 100,
});

function draftFixture() {
  const draft = emptyAidtUiDrafts()[4]!;
  return {
    ...draft,
    ideas: ids.map((id, index) => ({ id, title: ["菜单标签", "对比卡", "试饮"][index]!, description: "显示三种口味。方便快速比较。" })),
    fields: {
      ...Object.fromEntries(ids.map(id => [`ideaFile:${id}`, ideaImage(id)])),
      ideaHmwSource: JSON.stringify(hmw),
      ideaClassificationConfirmed: "true",
      ideaSheetIds: JSON.stringify(ids),
      ideaHandoffIds: JSON.stringify(ids.slice(0, 2)),
    },
  };
}

it("creates a named tagged brainstorm card and keeps its saved route after rename", async () => {
  const definition = { stageId: 3, revision: 7, content: { draft: { fields: {
    ["definitionHmw:" + hmw.id]: JSON.stringify({ id: hmw.id, text: hmw.text, confirmed: true, archived: false, cardIds: [], personaIds: [], rationale: "" }),
  } } } } as AidtSharedStage;
  const opened: string[] = [];
  function Harness() {
    const [draft, setDraft] = React.useState(() => emptyAidtUiDrafts()[4]!);
    const save = async (change: (current: typeof draft) => typeof draft) => { setDraft(change); return true; };
    return <AidtEntityCardDirectory draft={draft} readOnly={false} saveDraft={save}>
      <AidtBrainstormDirectory definition={definition} draft={draft} readOnly={false}
        href={id => `/aidt/p?step=4&entity=${id}`} onOpen={id => opened.push(id)} saveDraft={save} />
    </AidtEntityCardDirectory>;
  }
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "新建卡片" }));
  const creation = within(await screen.findByRole("dialog", { name: "新建头脑风暴" }));
  fireEvent.change(creation.getByRole("textbox", { name: "场次名称" }), { target: { value: "午休场次" } });
  fireEvent.change(creation.getByRole("textbox", { name: "添加标签" }), { target: { value: "校园" } });
  fireEvent.change(creation.getByRole("combobox", { name: "HMW" }), { target: { value: hmw.id } });
  fireEvent.change(creation.getByRole("combobox", { name: "发散方法" }), { target: { value: "reverse" } });
  fireEvent.click(creation.getByRole("button", { name: "开始头脑风暴" }));
  const link = await screen.findByRole("link", { name: "打开「午休场次」对话" });
  expect(link.getAttribute("href")).toBe(`/aidt/p?step=4&entity=${opened[0]}`);
  expect(within(screen.getByRole("group", { name: "筛选卡片标签" })).getByRole("button", { name: "校园" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "编辑 午休场次" }));
  const edit = within(await screen.findByRole("dialog", { name: "编辑头脑风暴" }));
  fireEvent.change(edit.getByRole("textbox", { name: "场次名称" }), { target: { value: "午休第二轮" } });
  fireEvent.click(edit.getByRole("button", { name: "保存名称" }));
  expect((await screen.findByRole("link", { name: "打开「午休第二轮」对话" })).getAttribute("href")).toBe(link.getAttribute("href"));
  fireEvent.click(screen.getByRole("button", { name: "删除 午休第二轮" }));
  const removal = within(await screen.findByRole("dialog", { name: "删除头脑风暴" }));
  fireEvent.click(removal.getByRole("button", { name: "确认删除" }));
  await waitFor(() => expect(screen.queryByRole("link", { name: "打开「午休第二轮」对话" })).toBeNull());
  expect(screen.getByText("已删除场次（1）")).toBeInTheDocument();
});

describe("AIDT idea directory and handoff", () => {
  it("starts empty and opens only a saved, stable entity", () => {
    const empty = emptyAidtUiDrafts()[4]!;
    const draft = createAidtIdea(empty, "idea-1", "对比卡");
    expect(readAidtIdeaDirectory(empty)).toEqual([]);
    expect(readAidtIdeaDirectory(draft)).toEqual([{ id: "idea-1", title: "对比卡", archived: false }]);
    const { rerender } = render(<AidtIdeaDirectory draft={draft} saved={undefined} href={id => `/aidt/p?step=4&entity=${id}`} update={() => {}} readOnly={false} />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<AidtIdeaDirectory draft={draft} saved={draft} href={id => `/aidt/p?step=4&entity=${id}`} update={() => {}} readOnly={false} />);
    expect(screen.getByRole("link", { name: "打开「对比卡」对话" })).toHaveAttribute("href", "/aidt/p?step=4&entity=idea-1");
  });

  it("hands off multiple ideas with the same fixed HMW only after team save", () => {
    const draft = draftFixture();
    expect(readAidtIdeaHandoff(draft, "project-1")).toMatchObject({ hmw, selectedIds: ["menu", "comparison"], sheetIds: ids });
    const props = { projectId: "project-1", draft, readOnly: false, reviewedSheetIds: [], update: () => {} };
    const { rerender } = render(<AidtIdeaHandoff {...props} context={{ matchesServer: false, nextHref: "/aidt/p?step=5" }} />);
    const choices = within(screen.getByRole("group", { name: "带入原型的点子" }));
    expect(choices.getByRole("checkbox", { name: "菜单标签" })).toBeChecked();
    expect(choices.getByRole("checkbox", { name: "对比卡" })).toBeChecked();
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<AidtIdeaHandoff {...props} context={{ matchesServer: true, savedRevision: 9, nextHref: "/aidt/p?step=5" }} />);
    expect(screen.getByRole("link", { name: "带入原型制作" })).toHaveAttribute("href", "/aidt/p?step=5");
  });

  it("rejects duplicate sheets, inaccessible project references and stale persisted confirmation", () => {
    const draft = draftFixture();
    expect(readAidtIdeaHandoff(invalidateAidtIdeaSheets(draft), "project-1")).toBeNull();
    expect(readAidtIdeaHandoff({ ...draft, fields: { ...draft.fields, ideaSheetIds: JSON.stringify(["menu", "menu", "samples"]) } }, "project-1")).toBeNull();
    expect(readAidtIdeaHandoff({ ...draft, fields: { ...draft.fields, "ideaFile:menu": ideaImage("menu", "other") } }, "project-1")).toBeNull();
  });

  it("preserves archived entity and its former handoff in the old version", () => {
    const draft = draftFixture();
    const updated = archiveAidtIdea(draft, "menu");
    expect(updated.ideas).toEqual(draft.ideas);
    expect(readAidtIdeaDirectory(updated)[0]).toMatchObject({ id: "menu", archived: true });
    expect(readAidtIdeaHandoff(updated, "project-1")).toBeNull();
    expect(readAidtIdeaHandoff(draft, "project-1")?.selectedIds).toContain("menu");
  });

  it("renders just the active idea in its entity editor", () => {
    const draft = draftFixture();
    render(<AidtStageOutput projectId="project-1" step={AIDT_STEPS[3]!} draft={draft} ideaEntityId="comparison"
      update={() => {}} readOnly={false} toolHref={tool => tool} />);
    expect(screen.getByRole("textbox", { name: "候选2名称" })).toHaveValue("对比卡");
    expect(screen.queryByRole("textbox", { name: "候选1名称" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "候选2核心说明" }), { target: { value: "修改" } });
    expect(screen.queryByText("带入原型的点子")).toBeNull();
  });
});
