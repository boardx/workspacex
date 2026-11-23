import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { imageEvidenceConnectionConfig } from "./support/board-durable-images-storage";
import { selectWorkbenchAgent, submitWorkbenchRun } from "./support/workbench-run-evidence";

test("chat generates and settles follow-up suggestions only once for a completed reply", async ({ page }) => {
  test.setTimeout(150_000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(CHAT_READ_E2E.email);
  await page.getByTestId("login-password").fill(CHAT_READ_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/, { timeout: 60_000 });
  await page.goto("/chat");
  await selectWorkbenchAgent(page, CHAT_READ_E2E.agentId);
  const marker = `CREDIT_AUDIT_03_${randomUUID()}`;
  await page.getByTestId("copilotkit-v2-input").fill(marker);

  const startedAt = new Date();
  const response = page.waitForResponse((res) =>
    res.request().method() === "POST" && res.url().endsWith("/followup-suggestions"),
  );
  await submitWorkbenchRun(page, "");
  expect((await response).ok()).toBe(true);
  await expect(page.getByTestId("copilotkit-v2-suggestion-1")).toHaveText("这和之前讨论的内容是什么关系？");
  await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker);

  const { Client } = createRequire(resolve(__dirname, "../../api/package.json"))("pg");
  const db = new Client(await imageEvidenceConnectionConfig());
  await db.connect();
  try {
    await db.query("BEGIN READ ONLY");
    await db.query("SELECT set_config('app.current_org',$1,true)", [CHAT_READ_E2E.orgId]);
    const ledger = async () => (await db.query(`
      SELECT r.state, r.debited_hundredths::text AS debit, r.usage_facts->>'tokens' AS tokens,
        r.usage_facts->>'source' AS source, w.owner_id,
        (SELECT count(*)::int FROM credit_transactions t
         WHERE t.wallet_id=r.wallet_id AND t.source_type='model_request' AND t.source_id=r.request_id) AS charges
      FROM credit_consumption_requests r JOIN credit_wallets w USING (wallet_id)
      WHERE r.org_id=$1 AND r.user_id=$2 AND r.run_id IS NULL AND r.start_facts->>'callPurpose'='auxiliary'
        AND r.created_at >= $3 AND r.usage_facts->>'tokens'='11'
    `, [CHAT_READ_E2E.orgId, CHAT_READ_E2E.userId, startedAt])).rows;
    await expect.poll(ledger, { timeout: 30_000 }).toEqual([{
      state: "settled",
      debit: "2",
      tokens: "11",
      source: "reported",
      owner_id: CHAT_READ_E2E.userId,
      charges: 1,
    }]);

    const followUpDispatches: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith("/followup-suggestions")) {
        followUpDispatches.push(request.url());
      }
    });
    await page.reload();
    await expect(page.getByTestId("copilotkit-v2-messages")).toContainText(marker);
    await expect(page.getByTestId("copilotkit-v2-suggestion-1")).toHaveCount(0);
    expect(followUpDispatches).toEqual([]);
    expect(await ledger()).toHaveLength(1);
  } finally {
    await db.end();
  }
});
