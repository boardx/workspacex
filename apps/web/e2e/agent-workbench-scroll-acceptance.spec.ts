import { expect, test } from "@playwright/test";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";

test("S8: ten rounds and one hundred tool activities retain the reading position", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const messages = page.getByTestId("copilotkit-v2-messages");
  const toolIdentities = new Set<string>();
  for (let round = 0; round < 10; round += 1) {
    await page.getByTestId("copilotkit-v2-input").fill(CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger);
    await expect(page.getByTestId("copilotkit-v2-send")).toBeEnabled();
    const responsePromise = page.waitForResponse(response => response.request().method() === "POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(response.url()));
    await page.getByTestId("copilotkit-v2-send").click();
    const response = await responsePromise;
    expect(response.status()).toBe(200);
    let ended = false;
    const finished = response.finished().then(() => { ended = true; });
    const panel = page.getByTestId("run-trace-panel").nth(round);
    await expect(panel.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
    await panel.getByTestId("run-trace-toggle").click();
    await expect(panel.getByTestId("run-trace-entry").first()).toBeVisible();
    expect(ended, "activity must be visible before the response finishes").toBe(false);
    if (round > 0) {
      // Real wheel input disarms following; geometry is read, never fabricated.
      await messages.hover();
      await page.mouse.wheel(0, -100_000);
      await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
      const anchor = page.getByTestId("run-trace-panel").first();
      const top = (await anchor.boundingBox())!.y;
      const count = await panel.getByTestId("run-trace-entry").count();
      await expect.poll(() => panel.getByTestId("run-trace-entry").count()).toBeGreaterThan(count);
      expect(Math.abs((await anchor.boundingBox())!.y - top), "streaming must not move the reading anchor").toBeLessThan(3);
      // Toggle the visible anchor with a real user click, without scrolling it.
      await anchor.getByTestId("run-trace-toggle").click();
      expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
      await anchor.getByTestId("run-trace-toggle").click();
      expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
      await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toBeVisible();
      await page.getByTestId("copilotkit-v2-scroll-to-bottom").click();
      await expect.poll(() => messages.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(60);
    }
    await finished;
    const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(events.some(event => event.type === "RUN_ERROR")).toBe(false);
    const journal = events.filter(event => event.type === "CUSTOM" && event.name === "execution_event").map(event => event.value);
    const completed = journal.filter(event => event.kind === "tool_end" && event.ok !== false);
    expect(new Set(completed.map(event => event.toolCallId)).size).toBe(10);
    for (const event of completed) toolIdentities.add(`${event.runId}:${event.toolCallId}`);
    await expect(panel.locator('[data-testid="run-trace-entry"][data-kind="tool"]')).toHaveCount(10);
    expect(journal.some(event => event.kind === "status" && event.status === "succeeded")).toBe(true);
    await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0);
  }
  expect(toolIdentities.size).toBe(100);
  await expect(page.locator('[data-testid="run-trace-entry"][data-kind="tool"]')).toHaveCount(100);
});
