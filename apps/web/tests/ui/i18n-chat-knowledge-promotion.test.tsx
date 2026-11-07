import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NominationCard } from "@/components/chat/knowledge/nomination-card";
import { PromotionResultList } from "@/components/chat/knowledge/promotion-result-list";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";

const rawLabel = (id: string) => `模型记忆 ${id} {count} const raw = '{locale}';`;
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
afterEach(cleanup);

it("keeps nomination selections and model rationale raw, promoting only explicit canonical IDs", () => {
  const promote = vi.fn(); const dismiss = vi.fn();
  const data = knowledgeGraph.listPromotionNominations.out.parse({ nominations: [
    { claimId: "raw-one", rationale: "模型理由 {name} 保留原文" }, { claimId: "raw-two", rationale: "另一模型理由 {count}" },
  ] });
  render(<I18nProvider initialLocale="en"><Driver /><NominationCard data={data} claimLabel={rawLabel} onPromote={promote} onDismiss={dismiss} /></I18nProvider>);
  expect(screen.getByTestId("kg-nomination-card")).toHaveTextContent("Worth remembering");
  const checkbox = screen.getByRole("checkbox", { name: `Select ${rawLabel("raw-two")}` });
  fireEvent.click(checkbox); expect(checkbox).not.toBeChecked();
  act(() => changeLocale()); expect(screen.getByRole("checkbox", { name: `选择 ${rawLabel("raw-two")}` })).toBe(checkbox); expect(checkbox).not.toBeChecked();
  const first = data.nominations[0]; if (!first) throw new Error("Missing first canonical nomination fixture");
  expect(screen.getByTestId("kg-nomination-raw-one")).toHaveTextContent(first.rationale);
  expect(promote).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("kg-nomination-promote")); expect(promote).toHaveBeenCalledTimes(1); expect(promote).toHaveBeenCalledWith(["raw-one"]);
  fireEvent.click(screen.getByTestId("kg-nomination-dismiss")); expect(dismiss).toHaveBeenCalledTimes(1); expect(promote).toHaveBeenCalledTimes(1);
});

it("renders all canonical outcomes without translating model labels or making a choice on locale", () => {
  const choice = vi.fn();
  const data = knowledgeGraph.promoteToPersonal.out.parse({ results: [
    { claimId: "one", outcome: "promoted", personalClaimId: "personal-one" },
    { claimId: "two", outcome: "merged_into_existing", personalClaimId: "personal-two" },
    { claimId: "three", outcome: "coexisting", personalClaimId: "personal-three" },
    { claimId: "four", outcome: "needs_choice", existingPersonalClaimId: "personal-four" },
    { claimId: "five", outcome: "rejected", code: "KG_EVIDENCE_REVOKED" },
  ] });
  render(<I18nProvider initialLocale="en"><Driver /><PromotionResultList data={data} claimLabel={rawLabel} onChoice={choice} /></I18nProvider>);
  expect(screen.getByTestId("kg-promo-one")).toHaveTextContent("Saved to your long-term memory");
  expect(screen.getByTestId("kg-promo-two")).toHaveTextContent("Merged into an existing memory");
  expect(screen.getByTestId("kg-promo-three")).toHaveTextContent("Kept alongside the existing memory");
  expect(screen.getByTestId("kg-promo-reject-reason-five")).toHaveTextContent("The original source is no longer available");
  const button = screen.getByRole("button", { name: "Keep both" });
  act(() => changeLocale()); expect(screen.getByRole("button", { name: "两条都保留" })).toBe(button); expect(choice).not.toHaveBeenCalled();
  for (const result of data.results) expect(screen.getByTestId(`kg-promo-${result.claimId}`)).toHaveTextContent(rawLabel(result.claimId));
  fireEvent.click(button); expect(choice).toHaveBeenCalledTimes(1); expect(choice).toHaveBeenCalledWith("four", "coexist");
});
