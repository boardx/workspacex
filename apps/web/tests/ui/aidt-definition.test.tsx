import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { AidtDefinitionDirectory, AidtDefinitionEditor } from "@/features/aidt/components/aidt-definition";
import { addAidtDefinitionEntity, chooseAidtDefinitionHmw, readAidtDefinition, readAidtDefinitionSelection, saveAidtDefinitionHmw, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtRoundMissingOutput } from "@/features/aidt/lib/aidt-round-completion";
import { StageContent } from "@repo/contracts/aidt-stages";

const card = { id: "u1", participantCode: "U01", headline: "难以比较口味", headlineKind: "student-summary" as const, context: "午休点单", quote: "口味看不出差别", sourceRef: "校对转写 01:42", photoRef: "" };
const unconfirmed = { ...card, id: "u2", participantCode: "U02" };
const context = { availableCards: [card, unconfirmed], availableCardsRevision: 2, discoveryCardFields: { "interviewConfirmed:u1": "true" }, readOnly: false };
const blank = () => emptyAidtUiDrafts()[3]!;
const noSurprise = (): AidtUiStageDraft => ({ ...blank(), fields: { surpriseStatus: "none", surpriseConfirmed: "true" } });
const ids = new Set(["u1"]);
const persona = (id: string) => ({ id, name: id, situation: "食堂午休点单", behavior: "先比较口味", need: "清晰区分差异", limits: "目前只有单个访谈证据", cardIds: ["u1"], confirmed: true, archived: false });
const hmw = (id: string) => ({ id, text: `我们如何改善 ${id} 的选择体验？`, rationale: "学生进一步核对", cardIds: ["u1"], personaIds: ["p1", "p2"], confirmed: true, archived: false });

it("requires the surprise decision before creating a persona and links to an independent entity route", () => {
  function Directory() {
    const [draft, setDraft] = React.useState(blank);
    return <AidtDefinitionDirectory {...context} draft={draft} update={setDraft} entityHref={id => `/aidt/group?step=3&entity=${id}`} />;
  }
  render(<Directory />);
  const add = screen.getByRole("button", { name: "新建画像" });
  expect(add).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: "暂无意外发现" }));
  expect(add).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "确认暂无意外发现" }));
  expect(add).toBeEnabled();
  fireEvent.click(add);
  expect(screen.getByRole("link", { name: "未命名画像" })).toHaveAttribute("href", expect.stringMatching(/\?step=3&entity=[a-f0-9-]+$/));
  expect(screen.getByRole("button", { name: "新建 HMW" })).toBeDisabled();
});

it("only exposes confirmed discovery cards and edits the requested persona, preserving the other entity", () => {
  let snapshot = saveAidtDefinitionPersona(addAidtDefinitionEntity(noSurprise(), "persona", "p1"), persona("p2"), 2);
  function Editor() {
    const [draft, setDraft] = React.useState(snapshot);
    return <AidtDefinitionEditor {...context} draft={draft} entityId="p1" update={mutate => setDraft(old => { snapshot = mutate(old); return snapshot; })} />;
  }
  render(<Editor />);
  expect(screen.queryByRole("checkbox", { name: /U02/ })).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole("textbox", { name: "画像名称" }), { target: { value: "赶课点单的学生" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /U01/ }));
  expect(readAidtDefinition(snapshot.fields).personas).toEqual([expect.objectContaining({ id: "p1", name: "赶课点单的学生", cardIds: ["u1"], confirmed: false }), persona("p2")]);
});

it("shares multiple explicit links at one immutable stage revision and invalidates HMW when a linked persona changes", () => {
  const withPersonas = [persona("p1"), persona("p2")].reduce((draft, item) => saveAidtDefinitionPersona(draft, item, 2), noSurprise());
  const withHmws = [hmw("h1"), hmw("h2")].reduce((draft, item) => saveAidtDefinitionHmw(draft, item, 2), withPersonas);
  const first = chooseAidtDefinitionHmw(withHmws, "h1", ids);
  const second = chooseAidtDefinitionHmw(first, "h2", ids);
  const persisted = StageContent.parse({ schemaVersion: 1, draft: second }).draft;
  expect(readAidtDefinitionSelection(first.fields)).toEqual({ id: "h1", text: hmw("h1").text });
  expect(readAidtDefinitionSelection(persisted.fields)).toEqual({ id: "h2", text: hmw("h2").text });
  expect(persisted.fields.definitionEvidenceRevision).toBe("2");
  expect(aidtRoundMissingOutput(3, persisted)).toBeNull();
  const updated = saveAidtDefinitionPersona(second, { ...persona("p1"), confirmed: false, behavior: "先读价签" }, 2);
  expect(readAidtDefinitionSelection(updated.fields)).toBeNull();
  expect(readAidtDefinition(updated.fields).hmws.every(item => !item.confirmed)).toBe(true);
  expect(aidtRoundMissingOutput(3, updated)).toMatch(/选定HMW/);
});
