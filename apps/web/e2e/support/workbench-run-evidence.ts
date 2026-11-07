import { expect, type Page } from "@playwright/test";
/** Observe the actual AGUI journal identity, then verify the same persisted run.
 * Fullstack lanes prefix API rewrites; chat-read uses the empty prefix explicitly. */
export async function submitWorkbenchRun(page: Page, apiPrefix: "" | "/__fullstack_api" = "/__fullstack_api"): Promise<{runId:string;resultMessageId:string}> {
  const responsePromise=page.waitForResponse(response=>response.request().method()==="POST" && /\/api\/copilotkit\/agent\/[^/]+\/run(?:\?|$)/.test(response.url()));
  await page.getByTestId("copilotkit-v2-send").click();
  const response=await responsePromise;
  expect(response.status()).toBe(200);
  const events=(await response.text()).split(/\r?\n/).filter(line=>line.startsWith("data: ")).map(line=>JSON.parse(line.slice(6)));
  expect(events.some(event=>event.type==="RUN_ERROR")).toBe(false);
  expect(events.at(-1)?.type).toBe("RUN_FINISHED");
  const runId=events.find(event=>event.type==="CUSTOM" && event.name==="execution_event")?.value?.runId;
  expect(runId).toEqual(expect.any(String));
  const token=await page.evaluate(()=>localStorage.getItem("wsx.sessionToken"));
  const run=await page.request.get(`${apiPrefix}/agent-runs/${runId}`,{headers:{Authorization:`Bearer ${token}`}});
  expect(run.ok(), `Run lookup failed: HTTP ${run.status()} at ${run.url()}`).toBe(true);
  const result=await run.json();
  expect(result.status).toBe("succeeded");
  expect(result.resultMessageId).toEqual(expect.any(String));
  return {runId,resultMessageId:result.resultMessageId};
}
export async function selectWorkbenchAgent(page:Page,agentId:string):Promise<void>{
  const picker = page.getByTestId("chat-task-workbench-capability-picker");
  const popover = page.getByTestId("chat-task-workbench-capability-popover");
  const card = page.getByTestId("chat-task-workbench-capability-card")
    .and(page.locator(`[data-agent-id=${JSON.stringify(agentId)}]`));
  await picker.click();
  await expect(card).toBeEnabled();
  const sheet = await popover.getAttribute("data-layout") === "sheet";
  // Directory/official-role responses can insert rows between pointer positioning
  // and pointerup. Keyboard activation follows the actual option, not old pixels.
  await page.mouse.move(0, 0);
  await card.press("Enter");
  if (sheet) {
    await page.getByTestId("chat-task-workbench-capability-detail-choose").click();
  }
  await expect(popover).not.toBeVisible();
  await expect(picker).toHaveAttribute("data-auto-match", "false");
  // A closed menu alone also describes an outside click. Reopen and verify the
  // exact id; another selected agent must not satisfy this precondition.
  await picker.click();
  await expect(card).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(popover).not.toBeVisible();
}
