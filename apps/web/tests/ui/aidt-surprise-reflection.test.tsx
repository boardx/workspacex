import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AidtSurpriseReflection } from "@/features/aidt/components/aidt-surprise-reflection";
import { formatAidtSurpriseMarkdown, isAidtSurpriseConfirmed, parseAidtSurpriseReflection, readAidtSurpriseSourceRevision } from "@/features/aidt/lib/aidt-surprise-reflection";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const card: AidtDiscoveryCardDraft = { id: "card-a", participantCode: "A", headline: "选择前先问同伴", headlineKind: "student-summary", context: "学生记录的一次购买过程", quote: "", sourceRef: "本组转写记录 t1 · 01:15", photoRef: "" };
const base = (fields: Record<string, string> = {}): AidtUiStageDraft => ({ fields: { unrelated: "其它阶段字段保留", ...fields }, ideas: [{ id: "idea", title: "旧点子", description: "保留" }], selectedIdeaId: "idea", discoveryCards: [] });
function View({ initial = base(), cards = [], cardsRevision = 3, changed = () => {}, readOnly = false }: { initial?: AidtUiStageDraft; cards?: readonly AidtDiscoveryCardDraft[]; cardsRevision?: number; changed?: (next: AidtUiStageDraft) => void; readOnly?: boolean }) {
  const [draft, setDraft] = React.useState(initial);
  return <><AidtSurpriseReflection draft={draft} onChange={(next) => { changed(next); setDraft(next); }} availableCards={cards} availableCardsRevision={cardsRevision} readOnly={readOnly} /><output data-testid="surprise-draft">{JSON.stringify(draft)}</output></>;
}
function snapshot(): AidtUiStageDraft { return JSON.parse(screen.getByTestId("surprise-draft").textContent ?? "null") as AidtUiStageDraft; }
function chooseFound() { fireEvent.click(screen.getByRole("radio", { name: "有意外发现" })); }
function fillFinding() { fireEvent.change(screen.getByLabelText("原先我们怎么想"), { target: { value: "原先以为大家只比较口味。" } }); fireEvent.change(screen.getByLabelText("实际看到或听到了什么"), { target: { value: "在这次访谈中，她先问了同伴。" } }); }
const confirm = () => screen.getByTestId("aidt-surprise-confirm");
describe("student-authored surprise reflection", () => {
  it("starts blank and waits for students without supplying a surprise or auto-confirming", () => {
    const changed = vi.fn(); render(<View changed={changed} />);
    expect(screen.getByRole("radio", { name: "有意外发现" })).not.toBeChecked(); expect(screen.getByRole("radio", { name: "暂无意外发现" })).not.toBeChecked();
    expect(confirm()).toBeDisabled(); expect(screen.queryByRole("textbox")).toBeNull(); expect(changed).not.toHaveBeenCalled();
  });
  it("allows an explicit none response to be confirmed without inventing materials or changing other draft data", () => {
    const initial = base(), changed = vi.fn(); render(<View initial={initial} changed={changed} />);
    fireEvent.click(screen.getByRole("radio", { name: "暂无意外发现" })); expect(confirm()).toBeEnabled(); fireEvent.click(confirm());
    expect(snapshot().fields).toMatchObject({ surpriseStatus: "none", surpriseConfirmed: "true", unrelated: initial.fields.unrelated });
    expect(snapshot().ideas).toEqual(initial.ideas); expect(snapshot().selectedIdeaId).toBe("idea"); expect(snapshot().fields.surprisingFinding).toBeUndefined();
    expect(screen.queryByRole("textbox")).toBeNull(); expect(screen.getByTestId("aidt-surprise-status")).toHaveTextContent("共享保存状态以上方回执为准");
  });
  it("keeps a nonempty finding pending without a card or original-material locator, without scoring or forcing new interviews", () => {
    render(<View />); chooseFound(); fillFinding(); expect(confirm()).toBeDisabled();
    expect(screen.getByTestId("aidt-surprise-status")).toHaveTextContent("不评分，也不自动要求补访"); expect(snapshot().fields.surpriseConfirmed).toBe("");
  });
  it("links an actual available discovery card without treating its draft as verified evidence", () => {
    render(<View cards={[card]} />); chooseFound(); fillFinding(); fireEvent.click(screen.getByRole("checkbox", { name: /A · 选择前先问同伴/ }));
    expect(snapshot().fields.surpriseCardIds).toBe('["card-a"]'); expect(confirm()).toBeEnabled(); fireEvent.click(confirm());
    expect(snapshot().fields.surpriseConfirmed).toBe("true"); expect(screen.getByText(/卡片可能仍是未保存草稿/)).toBeVisible();
    expect(screen.queryByText("证据已核验")).toBeNull(); expect(snapshot().fields.surpriseInterpretation).toBeUndefined();
  });
  it("accepts a student-entered original-material locator even when there are no discovery cards", () => {
    render(<View />); chooseFound(); fillFinding(); fireEvent.change(screen.getByLabelText("意外发现的原始材料与定位"), { target: { value: "本组访谈录音 A / 01:15–01:30" } });
    expect(confirm()).toBeEnabled(); fireEvent.click(confirm()); expect(snapshot().fields.surpriseConfirmed).toBe("true");
    expect(snapshot().fields.surprisingFinding).toBe("在这次访谈中，她先问了同伴。");
  });
  it.each(["原先我们怎么想", "实际看到或听到了什么", "意外发现的原始材料与定位", "我们对意外发现的理解"])("clears student confirmation when %s changes", (label) => {
    render(<View initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseSourceDetails: "访谈A 01:15", surpriseConfirmed: "true" })} />);
    expect(confirm()).toHaveTextContent("本组已确认"); fireEvent.change(screen.getByLabelText(label), { target: { value: "本组修改后的记录" } }); expect(snapshot().fields.surpriseConfirmed).toBe("");
  });
  it("clears confirmation on reference edits and status changes while preserving the student's earlier text", () => {
    render(<View cards={[card]} initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '["card-a"]', surpriseSourceRevision: "3", surpriseConfirmed: "true" })} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /A · 选择前先问同伴/ })); expect(snapshot().fields.surpriseConfirmed).toBe(""); expect(confirm()).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "暂无意外发现" })); expect(confirm()).toBeEnabled(); fireEvent.click(confirm());
    fireEvent.click(screen.getByRole("radio", { name: "有意外发现" })); expect(snapshot().fields.surpriseConfirmed).toBe(""); expect(screen.getByLabelText("实际看到或听到了什么")).toHaveValue("学生观察");
  });
  it("does not accept stale/cross-scope or malformed card references as evidence and offers explicit repair", () => {
    render(<View cards={[card]} initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '["other-project-card"]', surpriseSourceDetails: "本组录音01:15", surpriseConfirmed: "true" })} />);
    expect(confirm()).toBeDisabled(); expect(screen.queryByText("本组已确认这份记录")).toBeNull(); expect(screen.getByText(/原有卡片引用无法读取或已不在当前材料中/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "清理失效的卡片引用" })); expect(snapshot().fields.surpriseCardIds).toBe("[]"); expect(snapshot().fields.surpriseConfirmed).toBe(""); expect(confirm()).toBeEnabled();
  });
  it("keeps invalid JSON pending until students repair it rather than silently accepting it", () => {
    render(<View initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '{broken', surpriseSourceDetails: "本组录音01:15" })} />);
    expect(confirm()).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "清理失效的卡片引用" })); expect(snapshot().fields.surpriseCardIds).toBe("[]"); expect(confirm()).toBeEnabled();
  });
  it("does not use an otherwise empty participant card to bypass missing material", () => {
    const empty = { ...card, headline: "", context: "", sourceRef: "" }; render(<View cards={[empty]} />); chooseFound(); fillFinding();
    expect(screen.getByRole("checkbox")).toBeDisabled(); expect(confirm()).toBeDisabled();
  });
  it("pins the actual saved card revision on confirmation and requires a new explicit check when it changes", () => {
    const initial = base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '["card-a"]', surpriseSourceRevision: "3", surpriseConfirmed: "true" });
    const view = render(<View cards={[card]} cardsRevision={3} initial={initial} />); expect(confirm()).toHaveTextContent("本组已确认");
    view.rerender(<View cards={[card]} cardsRevision={4} initial={initial} />); expect(screen.getByTestId("aidt-surprise-source-changed")).toHaveTextContent("引用历史第2步 V3，当前已读取 V4");
    expect(confirm()).toBeEnabled(); expect(confirm()).not.toHaveTextContent("本组已确认"); expect(snapshot().fields.surpriseSourceRevision).toBe("3"); expect(snapshot().fields.surprisingFinding).toBe("学生观察");
    fireEvent.click(confirm()); expect(snapshot().fields.surpriseSourceRevision).toBe("4"); expect(snapshot().fields.surpriseConfirmed).toBe("true"); expect(screen.queryByTestId("aidt-surprise-source-changed")).toBeNull();
  });
  it("cannot confirm a card-only record without an actual saved card revision, even with a restored true flag", () => {
    const changed = vi.fn(); render(<View cards={[card]} cardsRevision={0} changed={changed} initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '["card-a"]', surpriseSourceRevision: "3", surpriseConfirmed: "true" })} />);
    expect(confirm()).toBeDisabled(); expect(confirm()).not.toHaveTextContent("本组已确认"); expect(screen.getByText(/尚未读取已保存的人物发现卡版本/)).toBeVisible(); expect(changed).not.toHaveBeenCalled(); expect(snapshot().fields.surpriseSourceRevision).toBe("3");
  });
  it("stamps a missing legacy source revision only after the student explicitly reconfirms", () => {
    render(<View cards={[card]} cardsRevision={5} initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseCardIds: '["card-a"]', surpriseConfirmed: "true" })} />);
    expect(confirm()).toBeEnabled(); expect(confirm()).not.toHaveTextContent("本组已确认"); fireEvent.click(confirm()); expect(snapshot().fields.surpriseSourceRevision).toBe("5");
  });
  it("respects read-only even when a change event is dispatched programmatically", () => {
    const changed = vi.fn(); render(<View readOnly cards={[card]} changed={changed} initial={base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "学生观察", surpriseSourceDetails: "访谈记录" })} />);
    for (const input of screen.getAllByRole("textbox")) expect(input).toBeDisabled(); expect(confirm()).toBeDisabled();
    fireEvent.change(screen.getByLabelText("原先我们怎么想"), { target: { value: "不应写入" } }); fireEvent.click(confirm()); expect(changed).not.toHaveBeenCalled(); expect(snapshot().fields.priorBelief).toBe("原先判断");
  });
});

describe("canonical surprise parser and report projection", () => {
  it("emits only none for a none response, never the preserved found fields or reference IDs", () => {
    const draft = base({ surpriseStatus: "none", surpriseConfirmed: "true", priorBelief: "OLD_BELIEF", surprisingFinding: "OLD_FINDING", surpriseInterpretation: "OLD_INTERPRETATION", surpriseSourceDetails: "OLD_LOCATOR", surpriseCardIds: '["OLD_CARD"]' });
    expect(isAidtSurpriseConfirmed(draft)).toBe(true);
    const lines = formatAidtSurpriseMarkdown(draft); expect(lines).toHaveLength(1); expect(lines[0]).toContain("暂无"); expect(lines.join("\n")).not.toMatch(/OLD_/);
  });
  it("does not turn raw true into confirmation when a found record lacks an actual reference", () => {
    const draft = base({ surpriseStatus: "found", priorBelief: "学生原先判断", surprisingFinding: "学生记录", surpriseConfirmed: "true" });
    expect(isAidtSurpriseConfirmed(draft, [card])).toBe(false); expect(isAidtSurpriseConfirmed(draft)).toBe(false);
    expect(formatAidtSurpriseMarkdown(draft).join("\n")).toContain("记录待补充");
  });
  it("keeps card-only confirmation unresolved unless the caller supplies the available card context", () => {
    const draft = base({ surpriseStatus: "found", priorBelief: "学生原先判断", surprisingFinding: "学生记录", surpriseCardIds: '["card-a"]', surpriseSourceRevision: "3", surpriseConfirmed: "true" });
    expect(isAidtSurpriseConfirmed(draft)).toBe(false); expect(parseAidtSurpriseReflection(draft).unresolvedCardIds).toEqual(["card-a"]);
    expect(isAidtSurpriseConfirmed(draft, [card], 3)).toBe(true); expect(isAidtSurpriseConfirmed(draft, [])).toBe(false);
    expect(formatAidtSurpriseMarkdown(draft).join("\n")).toContain("本次未取得人物发现卡上下文");
    expect(formatAidtSurpriseMarkdown(draft, [card], 3).join("\n")).toContain("学生已确认这份记录；不代表证据已核验");
  });
  it("allows a standalone original-material locator and separates student explanation from observed text", () => {
    const draft = base({ surpriseStatus: "found", priorBelief: "学生原先判断", surprisingFinding: "她先询问同伴", surpriseSourceDetails: "本组访谈A 01:15", surpriseInterpretation: "学生推测仍待验证", surpriseConfirmed: "true" });
    expect(isAidtSurpriseConfirmed(draft)).toBe(true);
    const markdown = formatAidtSurpriseMarkdown(draft).join("\n"); expect(markdown).toContain("实际看到或听到的内容：她先询问同伴"); expect(markdown).toContain("学生解释（不是原话）：学生推测仍待验证");
  });
  it("rejects malformed or missing references even when a raw confirmation flag is restored", () => {
    const draft = base({ surpriseStatus: "found", priorBelief: "判断", surprisingFinding: "记录", surpriseSourceDetails: "访谈A", surpriseCardIds: '{broken', surpriseConfirmed: "true" });
    expect(isAidtSurpriseConfirmed(draft, [card])).toBe(false); expect(parseAidtSurpriseReflection(draft).invalidCardIds).toBe(true);
    const missing = base({ ...draft.fields, surpriseCardIds: '["other-group-card"]' });
    expect(isAidtSurpriseConfirmed(missing, [card])).toBe(false); expect(formatAidtSurpriseMarkdown(missing, [card]).join("\n")).toContain("已不在当前材料中");
  });
  it("deduplicates valid reference IDs and keeps a blank status pending", () => {
    const parsed = parseAidtSurpriseReflection(base({ surpriseStatus: "found", surpriseCardIds: '["card-a","card-a"]' }), [card]);
    expect(parsed.cardIds).toEqual(["card-a"]); expect(parsed.confirmed).toBe(false);
    expect(isAidtSurpriseConfirmed(base({ surpriseConfirmed: "true" }))).toBe(false); expect(formatAidtSurpriseMarkdown(base())[0]).toContain("尚未记录");
  });
});

it("reads only valid source revisions and formats historical references as pending without a current saved revision", () => {
  for (const invalid of ["", "0", "03", "-1", "1.5", "9007199254740992"]) expect(readAidtSurpriseSourceRevision(base({ surpriseSourceRevision: invalid }))).toBeNull();
  const draft = base({ surpriseStatus: "found", priorBelief: "原先判断", surprisingFinding: "观察", surpriseCardIds: '["card-a"]', surpriseSourceRevision: "7", surpriseConfirmed: "true" });
  expect(readAidtSurpriseSourceRevision(draft)).toBe(7); expect(isAidtSurpriseConfirmed(draft, [card])).toBe(false); expect(isAidtSurpriseConfirmed(draft, [card], 8)).toBe(false); expect(isAidtSurpriseConfirmed(draft, [card], 7)).toBe(true);
  const unknown = formatAidtSurpriseMarkdown(draft, [card]).join("\n"); expect(unknown).toContain("第2步共享 V7（学生引用）"); expect(unknown).toContain("历史引用待核对");
  expect(formatAidtSurpriseMarkdown(draft, [card], 8).join("\n")).toContain("引用历史第2步 V7，当前已读取 V8");
});
