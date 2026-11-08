import { setShellLocale } from "./shell-locale";
import { expect, test, type Response } from "@playwright/test";
import { knowledgeGraph as C } from "@repo/contracts/chat-knowledge-graph";
import { ABOUT_ME_E2E as F } from "./about-me-fixture";
const prefix = "/__fullstack_api";
const readPaths = [C.getPersonalKnowledge.path, C.getBrainOverview.path, C.getSessionBriefing.path];
const responseFor = (path: string) => (r: Response) => new URL(r.url()).pathname === `${prefix}${path}` && r.request().method() === "GET";

test("About me retains a raw editing draft across languages and persists one real revision with goal links", async ({ page }, info) => {
  await info.attach("verification-boundary", { body: Buffer.from("Dedicated consultant/private org with persisted personal/source preconditions. Real HTTP/PG revision and reload, not model extraction, forgetting, sharing or consolidation proof. Other brain sections remain untranslated in this slice."), contentType: "text/plain" });
  let revisePath: string | null = null;
  const reads: string[]=[]; const posts: string[]=[];
  page.on("request", r=>{const path=new URL(r.url()).pathname;if(r.method()==="GET"&&readPaths.some(p=>path===`${prefix}${p}`)) reads.push(path);if(r.method()==="POST"&&path===revisePath) posts.push(r.postData()??"");});
  await page.setViewportSize({width:1280,height:1000}); await page.goto("/login");
  await page.getByTestId("login-email").fill(F.email); await page.getByTestId("login-password").fill(F.password); await page.getByTestId("login-submit").click(); await expect(page).toHaveURL(/\/home$/);
  const [initial,overviewResponse,briefingResponse]=await Promise.all([page.waitForResponse(responseFor(C.getPersonalKnowledge.path)),page.waitForResponse(responseFor(C.getBrainOverview.path)),page.waitForResponse(responseFor(C.getSessionBriefing.path)),page.goto("/brain")]);
  expect(initial.status()).toBe(200); expect(overviewResponse.status()).toBe(200); expect(briefingResponse.status()).toBe(200);
  const before=C.getPersonalKnowledge.out.parse(await initial.json()); const overview=C.getBrainOverview.out.parse(await overviewResponse.json());
  const initialGoal=before.claims.find(c=>c.kind==="goal"&&c.statement===F.goalText); const initialTodo=before.claims.find(c=>c.kind==="todo"&&c.statement===F.todoText);
  expect(initialGoal).toBeDefined(); expect(initialTodo).toBeDefined(); const goalId=initialGoal!.id; const todoId=initialTodo!.id;
  revisePath=`${prefix}/knowledge-graph/personal/claims/${encodeURIComponent(goalId)}/revise`;
  expect(before.scope).toEqual({kind:"personal",id:F.userId}); expect(before.claims).toHaveLength(2); expect(before.claims.find(c=>c.id===goalId)?.statement).toBe(F.goalText);
  expect(overview.personalOrigins.find(o=>o.personalClaimId===goalId)?.threadTitle).toBe(F.threadTitle);
  const panel=page.getByTestId("about-me"); await setShellLocale(page, "en");
  await expect(panel.getByRole("heading",{name:"About me",exact:true})).toBeVisible();
  const goal=panel.locator(`[data-testid="about-me-item"][data-claim-id="${goalId}"]`);
  await expect(goal).toContainText(F.goalText); await expect(panel.getByTestId("about-me-goal-select")).toContainText(F.goalText);
  await expect(goal.getByTestId("brain-origin-link").first()).toHaveAttribute("href",`/chat/${encodeURIComponent(F.threadId)}?memory=${encodeURIComponent(F.sourceGoalId)}`);
  await goal.getByTestId("about-me-edit").first().click(); const input=panel.getByTestId("about-me-edit-input"); const draft="原文修改 {draft}"; await input.fill(draft); const original=await input.elementHandle();
  const readCount=reads.length; await setShellLocale(page, "zh-CN"); await setShellLocale(page, "en");
  await expect(input).toHaveValue(draft); expect(await input.evaluate((node,old)=>node===old,original)).toBe(true); expect(reads).toHaveLength(readCount); expect(posts).toHaveLength(0);
  await input.focus(); await expect(input).toBeFocused();
  const [revision,freshResponse]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===revisePath&&r.request().method()==="POST"),page.waitForResponse(responseFor(C.getPersonalKnowledge.path)),panel.getByTestId("about-me-edit-save").click()]);
  expect(revision.status()).toBe(200); expect(revision.request().postDataJSON()).toEqual({statement:draft}); const changed=C.revisePersonalClaim.out.parse(await revision.json()); expect(changed.claimId).not.toBe(goalId);
  const fresh=C.getPersonalKnowledge.out.parse(await freshResponse.json()); expect(fresh.claims.find(c=>c.id===changed.claimId)?.statement).toBe(draft); expect(fresh.claims.some(c=>c.id===goalId)).toBe(false); expect(fresh.claims.find(c=>c.id===todoId)?.statement).toBe(F.todoText);
  expect(fresh.edges.some(e=>e.relation==="serves_goal"&&e.src.id===todoId&&e.dst.id===changed.claimId)).toBe(true);
  await expect(panel.locator(`[data-claim-id="${changed.claimId}"]`).first()).toContainText(draft); await expect(panel.getByTestId("about-me-goal-select")).toContainText(draft); expect(posts).toHaveLength(1);
  for(const width of [1280,375]) {
    await page.setViewportSize({width,height:1000});
    for(const control of await panel.locator('button,a,input').all()) { await control.scrollIntoViewIfNeeded(); const box=await control.boundingBox();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(width);await expect(control).toBeInViewport({ratio:1}); }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`about-me-${width}-en.png`),fullPage:true});
  }
  await page.setViewportSize({width:1280,height:1000});const [reloaded]=await Promise.all([page.waitForResponse(responseFor(C.getPersonalKnowledge.path)),page.reload()]); const persisted=C.getPersonalKnowledge.out.parse(await reloaded.json());expect(persisted.claims.find(c=>c.id===changed.claimId)?.statement).toBe(draft);expect(persisted.edges.some(e=>e.relation==="serves_goal"&&e.dst.id===changed.claimId)).toBe(true);await expect(panel.getByRole("heading",{name:"About me",exact:true})).toBeVisible();expect(posts).toHaveLength(1);
});
