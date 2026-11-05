import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ClaimActionDialog, type ClaimDialogKind } from "@/components/chat/knowledge/claim-action-dialog";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { KgClaim, KgHumanAction, KgObject } from "@repo/contracts/chat-knowledge-graph";

const scope = { kind: "chat_session" as const, id: "raw-thread" };
const raw = "原始记忆 {count} const value = '{locale}';";
const draft = "用户编辑 {name} 保留原文";
const objects: KgObject[] = ["one", "two"].map(id => ({ id, scope, kind: "person", name: `组织人名 ${id} {name}`, aliases: [], createdBy: "model", claimCount: 1 }));
const claim: KgClaim = { id: "claim-one", scope, kind: "fact", statement: raw, status: "proposed", triState: "pending", confidence: 0.8, createdBy: "model", reviewedBy: null, supersedesClaimId: null, derivedFromClaimId: null, aboutObjectIds: ["one"], supportingCount: 1, contradictingCount: 0, createdAt: "2026-11-04T00:00:00Z" };
const claims = [claim, { ...claim, id: "claim-two", statement: "另一条原始记忆 {raw}" }];
let switchLocale: () => void = () => {};
function Driver() {
  const { setLocale } = useI18n();
  React.useEffect(() => { switchLocale = () => setLocale("zh-CN"); return () => { switchLocale = () => {}; }; }, [setLocale]);
  return null;
}
afterEach(cleanup);

const cases: { kind: ClaimDialogKind; title: string; prepare: (dialog: HTMLElement) => HTMLElement | null; action: KgHumanAction }[] = [
  { kind: "revise", title: "Rewrite this memory", prepare: d => { const input = within(d).getByTestId("kg-revise-input-claim-one"); fireEvent.change(input, { target: { value: draft } }); return input; }, action: { type: "reviseClaim", claimId: claim.id, statement: draft } },
  { kind: "revoke", title: "Forget this memory?", prepare: d => { expect(d).toHaveTextContent(raw); return null; }, action: { type: "revokeClaim", claimId: claim.id } },
  { kind: "contest", title: "Which memory conflicts?", prepare: d => { const radio = within(d).getByTestId("kg-contest-target-claim-one-claim-two"); fireEvent.click(radio); return radio; }, action: { type: "markContested", claimIds: [claim.id, "claim-two"] } },
  { kind: "merge", title: "Merge people and things", prepare: d => { const radio = within(d).getByTestId("kg-merge-other-claim-one-two"); fireEvent.click(radio); return radio; }, action: { type: "mergeObjects", keepObjectId: "one", mergeObjectId: "two" } },
  { kind: "split", title: "Split a person or thing", prepare: d => { const input = within(d).getByTestId("kg-split-name-claim-one"); fireEvent.change(input, { target: { value: draft } }); return input; }, action: { type: "splitObject", objectId: "one", newName: draft, moveClaimIds: [claim.id] } },
  { kind: "rename", title: "Rename", prepare: d => { const input = within(d).getByTestId("kg-rename-input-claim-one"); fireEvent.change(input, { target: { value: draft } }); return input; }, action: { type: "renameObject", objectId: "one", name: draft } },
];

it.each(cases)("localizes $kind without resetting entered data, selected IDs or submitting on locale", async ({ kind, title, prepare, action }) => {
  const apply = vi.fn(async (_action: KgHumanAction) => false);
  const close = vi.fn();
  render(<I18nProvider initialLocale="en"><Driver /><ClaimActionDialog kind={kind} claim={claim} claims={claims} objects={objects} onApply={apply} onClose={close} /></I18nProvider>);
  const dialog = screen.getByRole("dialog", { name: title });
  const control = prepare(dialog);
  expect(apply).not.toHaveBeenCalled();
  act(() => switchLocale());
  expect(screen.getByRole("dialog")).toBe(dialog);
  if (control) {
    expect(dialog.contains(control)).toBe(true);
    if (control instanceof HTMLInputElement && control.type === "radio") expect(control).toBeChecked();
    else expect(control).toHaveValue(draft);
  }
  expect(apply).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByTestId(kind === "revoke" ? "kg-delete-confirm-btn-claim-one" : `kg-${kind}-submit-claim-one`));
  await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  expect(apply).toHaveBeenCalledWith(action);
  expect(close).not.toHaveBeenCalled(); expect(screen.getByRole("dialog")).toBe(dialog);
  fireEvent.click(within(dialog).getByTestId(`kg-${kind === "revoke" ? "delete" : kind}-cancel-claim-one`));
  expect(close).toHaveBeenCalledTimes(1); expect(apply).toHaveBeenCalledTimes(1);
});
