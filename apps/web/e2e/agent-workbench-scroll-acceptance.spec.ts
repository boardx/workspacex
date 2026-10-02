import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { CHAT_READ_E2E } from "./chat-read-fixture";
import { openFreshThread } from "./chat-task-workbench-fixture";
import { selectWorkbenchAgent } from "./support/workbench-run-evidence";
import { timelineScrollBrowserFixture } from "./support/timeline-scroll-browser-fixture";

// Adjacent same-name tools are grouped in the approved UI. Count their actual
// member nodes as well as standalone tool rows, never just the group header.
const TOOL_ACTIVITY = '[data-testid="run-trace-entry"][data-kind="tool"], [data-testid="run-trace-entry"][data-kind="tool-group"] [data-testid="run-trace-group-member"]';

test("S8: ten rounds and one hundred tool activities retain the reading position", async ({ page }) => {
  test.setTimeout(600_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await openFreshThread(page);
  await selectWorkbenchAgent(page, CHAT_READ_E2E.deepAgentId);
  const messages = page.getByTestId("copilotkit-v2-messages");
  const toolIdentities = new Set<string>();
  for (let round = 0; round < 10; round += 1) {
    // #5023: handshake at the actual first tool event, not a timing assumption
    // that Chromium will render before the fixture's six-second stream ends.
    const gateId = randomUUID();
    const userText = `${CHAT_READ_E2E.deepAgentScrollAcceptanceTrigger}:F2:${gateId}`;
    const fixtureOrigin = `http://127.0.0.1:${process.env.WORKSPACEX_DEEP_AGENT_PROVIDER_PORT}`;
    const armed = await page.request.post(`${fixtureOrigin}/__test/f2/arm`, { data: { gateId, userText, pauseAtHalfStep: 1 } });
    expect(armed.status()).toBe(200);
    const release = async () => {
      const released = await page.request.post(`${fixtureOrigin}/__test/f2/release`, { data: { gateId } });
      expect(released.status()).toBe(200);
    };
    await page.getByTestId("copilotkit-v2-input").fill(userText);
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
      const count = await panel.locator(TOOL_ACTIVITY).count();
      await release();
      await expect.poll(() => panel.locator(TOOL_ACTIVITY).count()).toBeGreaterThan(count);
      expect(Math.abs((await anchor.boundingBox())!.y - top), "streaming must not move the reading anchor").toBeLessThan(3);
      // Toggle the visible anchor with a real user click, without scrolling it.
      await anchor.getByTestId("run-trace-toggle").click();
      expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
      await anchor.getByTestId("run-trace-toggle").click();
      expect(Math.abs((await anchor.boundingBox())!.y - top)).toBeLessThan(3);
      await expect(page.getByTestId("copilotkit-v2-scroll-to-bottom")).toBeVisible();
      await page.getByTestId("copilotkit-v2-scroll-to-bottom").click();
      await expect.poll(() => messages.evaluate(el => el.scrollHeight - el.clientHeight - el.scrollTop)).toBeLessThan(60);
    } else {
      await release();
    }
    await finished;
    const events = (await response.text()).split(/\r?\n/).filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)));
    expect(events.some(event => event.type === "RUN_ERROR")).toBe(false);
    const journal = events.filter(event => event.type === "CUSTOM" && event.name === "execution_event").map(event => event.value);
    const completed = journal.filter(event => event.kind === "tool_end" && event.ok !== false);
    expect(new Set(completed.map(event => event.toolCallId)).size).toBe(10);
    for (const event of completed) toolIdentities.add(`${event.runId}:${event.toolCallId}`);
    await expect(panel.locator(TOOL_ACTIVITY)).toHaveCount(10);
    // Grouping deliberately reduces height. Use the real disclosure controls
    // so the next round has genuinely overflowing content to scroll through.
    const groups = panel.locator('[data-kind="tool-group"] details');
    for (let index = 0; index < await groups.count(); index += 1) {
      const group = groups.nth(index);
      if (!await group.evaluate(el => (el as HTMLDetailsElement).open)) {
        await group.locator("summary").click();
      }
      await expect(group.getByTestId("run-trace-group-member").first()).toBeVisible();
    }
    expect(journal.some(event => event.kind === "status" && event.status === "succeeded")).toBe(true);
    await expect(page.getByTestId("copilotkit-v2-running-indicator")).toHaveCount(0);
  }
  expect(toolIdentities.size).toBe(100);
  await expect(page.locator(TOOL_ACTIVITY)).toHaveCount(100);
});


// #5023: 55px overflow is below the real 80px tolerance. A user can still
// scroll upward; streaming must preserve that explicit intent until returning.
test("small-overflow upward intent survives streamed layout changes", async ({ page }) => {
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: await timelineScrollBrowserFixture() });
  const messages = page.locator("#messages");
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(55);
  await messages.hover();
  await page.mouse.wheel(0, -100_000);
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
  await expect(page.locator("#following")).toHaveText("false");
  const anchorTop = (await page.locator("#anchor").boundingBox())!.y;
  for (let delta = 0; delta < 3; delta += 1) {
    await page.locator("#grow").click();
    await expect.poll(() => messages.evaluate(el => el.scrollHeight)).toBe(256 + delta);
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(await messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
    expect(Math.abs((await page.locator("#anchor").boundingBox())!.y - anchorTop)).toBeLessThan(3);
  }
  // A real pointer click releases the directional latch, but must not itself
  // restore following before any actual downward scroll.
  await messages.click({ position: { x: 20, y: 100 } });
  await expect(page.locator("#following")).toHaveText("false");
  expect(await messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
  await messages.hover();
  await page.mouse.wheel(0, 100_000);
  await expect(page.locator("#following")).toHaveText("true");
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(58);
  await page.locator("#grow").click();
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(59);
  await messages.focus();
  await page.keyboard.press("Home");
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
  await expect(page.locator("#following")).toHaveText("false");
  await page.locator("#grow").click();
  await expect.poll(() => messages.evaluate(el => el.scrollHeight)).toBe(260);
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(await messages.evaluate(el => el.scrollTop)).toBeLessThan(5);
  await page.locator("#jump").click();
  await expect(page.locator("#following")).toHaveText("true");
  await expect.poll(() => messages.evaluate(el => el.scrollTop)).toBe(60);
});
