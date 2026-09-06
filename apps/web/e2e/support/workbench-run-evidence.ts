import { expect, type Page } from "@playwright/test";
/** Observe the actual AGUI journal identity, then verify the same persisted run. */
export async function submitWorkbenchRun(page: Page): Promise<{runId:string;resultMessageId:string}> {
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
  const run=await page.request.get(`/__fullstack_api/agent-runs/${runId}`,{headers:{Authorization:`Bearer ${token}`}});
  expect(run.ok()).toBe(true);
  const result=await run.json();
  expect(result.status).toBe("succeeded");
  expect(result.resultMessageId).toEqual(expect.any(String));
  return {runId,resultMessageId:result.resultMessageId};
}
export async function selectWorkbenchAgent(page:Page,agentId:string):Promise<void>{
  await page.getByTestId("chat-task-workbench-capability-picker").click();
  await page.locator(`[data-testid="chat-task-workbench-capability-card"][data-agent-id="${agentId}"]`).click();
}
