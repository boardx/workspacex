/**
 * E4 —— 零出网指示是**实测信号**，不是写死的标签。四条反证：
 *   ① 账本全 0 ⇒「本次启动出网 0 次」，点开说「没有任何连接离开过这台电脑」；
 *   ② 同一个组件、账本里有一条意外出网 ⇒ 变成「发现意外出网」并列出目的地
 *      （这一条让①不可能由一个写死的标签满足）；
 *   ③ 读不到 ⇒「读不到出网记录」，**绝不**兜成 0；
 *   ④ 重读：账本变了，界面跟着变（一次性读取的数字只是痕迹）。
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it } from "vitest";
import { EGRESS_LEDGER_STATE_LABEL } from "@repo/contracts/deployment";
import { EgressLedgerIndicator } from "@/components/shell/egress-ledger-indicator";
import type { GetEgressLedgerOut } from "@/lib/live-identity";

const ledger = (counts: Partial<GetEgressLedgerOut["counts"]>, recent: GetEgressLedgerOut["recent"] = []): GetEgressLedgerOut => ({
  edition: "local",
  since: "2026-09-24T00:00:00.000Z",
  counts: { onRequest: 0, refused: 0, export: 0, unexpected: 0, ...counts },
  recent,
});

it("shows zero egress only when the ledger says zero", async () => {
  render(<EgressLedgerIndicator load={async () => ledger({})} />);
  await waitFor(() => expect(screen.getByTestId("egress-ledger").dataset.state).toBe("zero"));
  expect(screen.getByTestId("egress-ledger-label").textContent).toBe(EGRESS_LEDGER_STATE_LABEL.zero);
  fireEvent.click(screen.getByTestId("egress-ledger"));
  expect(screen.getByTestId("egress-ledger-empty")).toBeTruthy();
});

it("turns into an incident when the ledger holds an unexpected connection", async () => {
  const load = async () => ledger(
    { onRequest: 2, unexpected: 1 },
    [{ kind: "unexpected", target: "203.0.113.9:443", at: "2026-09-24T00:01:00.000Z" }],
  );
  render(<EgressLedgerIndicator load={load} />);
  await waitFor(() => expect(screen.getByTestId("egress-ledger").dataset.state).toBe("unexpected"));
  expect(screen.getByTestId("egress-ledger-label").textContent).toBe(EGRESS_LEDGER_STATE_LABEL.unexpected);
  expect(screen.getByTestId("egress-ledger-counts").textContent).toContain("意外 1");
  fireEvent.click(screen.getByTestId("egress-ledger"));
  expect(screen.getByTestId("egress-ledger-recent").textContent).toContain("203.0.113.9:443");
});

it("never renders a failed read as zero", async () => {
  render(<EgressLedgerIndicator load={() => Promise.reject(new Error("404"))} />);
  await waitFor(() => expect(screen.getByTestId("egress-ledger").dataset.state).toBe("error"));
  expect(screen.getByTestId("egress-ledger").textContent).toBe("读不到出网记录");
  expect(screen.getByTestId("egress-ledger").textContent).not.toContain("0 次");
});

it("re-reads the ledger, so the number is live rather than a snapshot", async () => {
  let refused = 0;
  render(<EgressLedgerIndicator load={async () => ledger({ refused })} pollMs={20} />);
  await waitFor(() => expect(screen.getByTestId("egress-ledger").dataset.state).toBe("zero"));
  await act(async () => { refused = 1; });
  await waitFor(() => expect(screen.getByTestId("egress-ledger").dataset.state).toBe("blocked"));
});
