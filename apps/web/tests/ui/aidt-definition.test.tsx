import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it } from "vitest";
import { AidtDefinitionChatArtifact, AidtDefinitionDirectory, AidtDefinitionEditor, AidtDefinitionOutput } from "@/features/aidt/components/aidt-definition";
import { addAidtDefinitionEntity, addAidtDefinitionSurprise, chooseAidtDefinitionHmw, confirmedAidtDefinitionSurprises, readAidtDefinition, readAidtDefinitionEvidenceRevision, readAidtDefinitionSelection, saveAidtDefinitionHmw, saveAidtDefinitionPersona, saveAidtDefinitionSurprise } from "@/features/aidt/lib/aidt-definition";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtRoundMissingOutput } from "@/features/aidt/lib/aidt-round-completion";
import { allAidtDefinitionEntitiesConfirmed, latestAidtDefinitionCandidate } from "@/features/aidt/lib/aidt-definition-chat";
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


it("preserves independent surprise records and requires review of dependent artifacts after one changes", () => {
  const primary: AidtUiStageDraft = { ...blank(), fields: { surpriseStatus: "found", surpriseConfirmed: "true", surprisingFinding: "看懂口味后仍选择熟悉款" } };
  expect(addAidtDefinitionSurprise(noSurprise(), "inapplicable")).toEqual(noSurprise());
  const newRecord = (id: string, observation: string) => ({ id, observation, priorBelief: "原先以为只看价格", interpretation: "单次观察", unknowns: "待补访", cardIds: ["u1"], confirmed: true, archived: false });
  let draft = addAidtDefinitionSurprise(addAidtDefinitionSurprise(primary, "s1"), "s2");
  expect(readAidtDefinition(draft.fields).surprises).toHaveLength(2);
  draft = saveAidtDefinitionSurprise(draft, newRecord("s1", "先比口味"), 2);
  draft = saveAidtDefinitionSurprise(draft, newRecord("s2", "还会看配料"), 2);
  draft = saveAidtDefinitionPersona(draft, { ...persona("p1"), surpriseIds: ["s1", "s2"] }, 2);
  draft = saveAidtDefinitionPersona(draft, { ...persona("p2"), surpriseIds: ["s1"] }, 2);
  draft = saveAidtDefinitionHmw(draft, { ...hmw("h1"), surpriseIds: ["s2"] }, 2);
  draft = chooseAidtDefinitionHmw(draft, "h1", ids);
  expect(confirmedAidtDefinitionSurprises(draft.fields).map(record => record.id)).toEqual(["primary-surprise", "s1", "s2"]);
  expect(readAidtDefinitionSelection(draft.fields)?.id).toBe("h1");
  const changed = saveAidtDefinitionSurprise(draft, { ...newRecord("s2", "还会看配料"), archived: true }, 2);
  expect(confirmedAidtDefinitionSurprises(changed.fields).map(record => record.id)).toEqual(["primary-surprise", "s1"]);
  expect(readAidtDefinition(changed.fields).personas.map(persona => persona.confirmed)).toEqual([false, true]);
  expect(readAidtDefinitionSelection(changed.fields)).toBeNull();
  expect(readAidtDefinitionSelection(draft.fields)?.id).toBe("h1");
});

it("creates a primary surprise card and offers no workspace questions or forms", () => {
  function Directory() {
    const [draft, setDraft] = React.useState(blank);
    return <AidtDefinitionDirectory {...context} draft={draft} update={setDraft} nativeChat entityHref={id => `/aidt/p?step=3&entity=${id}`} />;
  }
  render(<Directory />);
  expect(screen.queryByRole("radio")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "新建意外发现" }));
  expect(screen.getByRole("link", { name: "打开意外发现对话" })).toHaveAttribute("href", "/aidt/p?step=3&entity=primary-surprise");
  expect(screen.getByRole("button", { name: "新建画像" })).toBeDisabled();
});

it("stages scoped Chat output, confirms it explicitly and keeps the inspector read only", () => {
  let durable = addAidtDefinitionEntity(noSurprise(), "persona", "p1");
  function Workspace() {
    const [draft, setDraft] = React.useState(durable);
    const [saved, setSaved] = React.useState(durable);
    return <>
      <AidtDefinitionChatArtifact {...context} entityId="p1" draft={draft} savedDraft={saved}
        update={setDraft} requestSave={() => setDraft(value => { durable = value; setSaved(value); return value; })}
        loading={false} running={false}
        messages={[
          { id: "human", role: "user", content: "这位学生午休会先比较口味。" },
          { id: "reply", role: "assistant", content: "\n```aidt-definition\n" + JSON.stringify({ kind: "persona", name: "午休点单", situation: "食堂", behavior: "比较口味", need: "口味标签", cardIds: ["u1", "u2", "foreign"] }) + "\n```" },
        ]} />
      <AidtDefinitionOutput {...context} entityId="p1" draft={draft} update={setDraft} />
    </>;
  }
  render(<Workspace />);
  const output = screen.getByRole("region", { name: "当前产物" });
  expect(output).toHaveTextContent("口味标签");
  expect(within(output).queryByRole("textbox")).toBeNull();
  expect(output).not.toHaveTextContent("U02");
  expect(readAidtDefinition(durable.fields).personas[0]?.confirmed).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认当前产物" }));
  expect(readAidtDefinition(durable.fields).personas[0]).toMatchObject({ id: "p1", confirmed: true, cardIds: ["u1"] });
});

it("keeps all active entities in the Stage 3 completion calculation", () => {
  let draft = [persona("p1"), persona("p2")].reduce((state, value) => saveAidtDefinitionPersona(state, value, 2), noSurprise());
  draft = chooseAidtDefinitionHmw(saveAidtDefinitionHmw(draft, hmw("h1"), 2), "h1", ids);
  expect(allAidtDefinitionEntitiesConfirmed(draft)).toBe(true);
  const inProgress = addAidtDefinitionEntity(draft, "persona", "p3");
  expect(allAidtDefinitionEntitiesConfirmed(inProgress)).toBe(false);
  const archived = readAidtDefinition(inProgress.fields).personas.find(value => value.id === "p3")!;
  expect(allAidtDefinitionEntitiesConfirmed(saveAidtDefinitionPersona(inProgress, { ...archived, archived: true }, 2))).toBe(true);
});

it("requires a student turn and accepts 暂无 only from the student", () => {
  const falseClaim = { id: "reply", role: "assistant", content: "```aidt-definition\n{\"kind\":\"surprise\",\"status\":\"none\"}\n```" };
  expect(latestAidtDefinitionCandidate([falseClaim], "surprise", true)).toBeNull();
  const unrelated = { id: "request", role: "user", content: "你好" };
  expect(latestAidtDefinitionCandidate([unrelated, falseClaim], "surprise", true)).toBeNull();
  const candidate = latestAidtDefinitionCandidate([{ ...unrelated, content: "暂无意外发现" }], "surprise", true);
  expect(candidate?.proposal).toEqual({ kind: "surprise", status: "none" });
});

it("selects multiple confirmed interview discoveries as frozen evidence when creating a Persona or HMW", () => {
  const interviewId = "73e90275-e848-480f-8962-8d39d3b88b43";
  const first = { ...card, id: interviewId };
  const secondId = "b40ef781-10f0-4e0c-b4ce-b09d88efe6a9";
  const second = { ...card, id: secondId, participantCode: "U03", headline: "先看排队长度" };
  const orphaned = { ...card, id: "orphan", participantCode: "已丢失访谈", headline: "已丢失访谈的旧记录" };
  const source = { ...context, availableCards: [first, unconfirmed, second, orphaned], discoveryCardFields: {
    [`interviewConfirmed:${interviewId}`]: "true", [`interviewConfirmed:${secondId}`]: "true", "interviewConfirmed:orphan": "true",
    [`interviewRecord:${secondId}`]: JSON.stringify({ version: 1, id: secondId, code: "U03",
      topic: "", topicRevision: null, goal: "", original: "", adopted: "", guideConfirmed: false, consent: null }),
    [`interviewRecord:${interviewId}`]: JSON.stringify({ version: 1, id: interviewId, code: "U01", displayName: "阿岚",
      topic: "", topicRevision: null, goal: "", original: "", adopted: "", guideConfirmed: false, consent: null }),
  } };
  let result = saveAidtDefinitionPersona(noSurprise(), { ...persona("p1"), cardIds: [interviewId] }, 2);
  function Directory() {
    const [draft, setDraft] = React.useState(result);
    return <AidtDefinitionDirectory {...source} draft={draft} update={mutate => setDraft(old => { result = mutate(old); return result; })}
      nativeChat entityHref={id => `/aidt/p?step=3&entity=${id}`} />;
  }
  render(<Directory />);
  for (const [openLabel, createLabel] of [["新建画像", "创建画像"], ["新建 HMW", "创建HMW"]] as const) {
    fireEvent.click(screen.getByRole("button", { name: openLabel }));
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.queryByText("U02")).not.toBeInTheDocument();
    expect(dialog.queryByText(orphaned.headline)).not.toBeInTheDocument();
    fireEvent.click(dialog.getByRole("checkbox", { name: "U01 · 阿岚 · 难以比较口味" }));
    fireEvent.click(dialog.getByRole("checkbox", { name: "U03 · 先看排队长度" }));
    fireEvent.click(dialog.getByRole("button", { name: createLabel }));
  }
  const definition = readAidtDefinition(result.fields);
  expect(definition.personas.at(-1)?.cardIds).toEqual([interviewId, secondId]);
  expect(definition.hmws[0]?.cardIds).toEqual([interviewId, secondId]);
  expect(readAidtDefinitionEvidenceRevision(result.fields)).toBe(2);
});
