import { setShellLocale } from "./shell-locale";
import { expect, test, type Response } from "@playwright/test";
import { knowledgeGraph as C } from "@repo/contracts/chat-knowledge-graph";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
const paths = [C.getPersonalKnowledge.path, C.getBrainOverview.path, C.getOrgKnowledge.path];
function responseFor(path: string) { return (response: Response) => new URL(response.url()).pathname === `/__fullstack_api${path}` && response.request().method() === "GET"; }

test("brain shell and session/shared views retain real empty API state across locale and reload", async ({ page }, info) => {
 await info.attach("verification-boundary", {body:Buffer.from("Dedicated consultant, real API/PG empty personal and conversation reads plus organization memory. Does not prove nonempty conversation extraction, mutations, models, or localization of personal/About me/consolidation views."),contentType:"text/plain"});
 const reads: string[]=[]; page.on("request", r=>{if(r.method()==="GET"&&paths.some(path=>new URL(r.url()).pathname===`/__fullstack_api${path}`)) reads.push(new URL(r.url()).pathname);});
 await page.setViewportSize({width:1280,height:1000}); await page.goto("/login");
 await page.getByTestId("login-email").fill(F.brainEmail); await page.getByTestId("login-password").fill(F.brainPassword); await page.getByTestId("login-submit").click(); await expect(page).toHaveURL(/\/home$/);
 const [personalResponse,overviewResponse]=await Promise.all([page.waitForResponse(responseFor(C.getPersonalKnowledge.path)),page.waitForResponse(responseFor(C.getBrainOverview.path)),page.goto("/brain")]);
 expect(personalResponse.status()).toBe(200); expect(overviewResponse.status()).toBe(200);
 const personal=C.getPersonalKnowledge.out.parse(await personalResponse.json()); const overview=C.getBrainOverview.out.parse(await overviewResponse.json());
 expect(personal.claims).toHaveLength(0); expect(personal.scope).toEqual({kind:"personal",id:F.brainUserId}); expect(overview.threads).toHaveLength(0);
 await setShellLocale(page, "en");
 await expect(page.getByRole("heading",{name:"Brain",exact:true})).toBeVisible(); await page.getByTestId("brain-tab-sessions").click();
 await expect(page.getByTestId("brain-sessions")).toContainText("No conversation memories yet");
 const count=reads.length; await setShellLocale(page, "zh-CN"); await expect(page.getByTestId("brain-tab-sessions")).toHaveAttribute("data-state","active"); await setShellLocale(page, "en"); expect(reads).toHaveLength(count);
 await page.getByTestId("brain-tab-shared").click();
 const [orgResponse]=await Promise.all([page.waitForResponse(responseFor(C.getOrgKnowledge.path)),page.getByRole("button",{name:"View organization memory"}).click()]);
 expect(orgResponse.status()).toBe(200); const org=C.getOrgKnowledge.out.parse(await orgResponse.json());
 for(const claim of org.claims) await expect(page.getByTestId("brain-org-content")).toContainText(claim.statement);
 const orgCount=reads.length; await setShellLocale(page, "zh-CN"); await setShellLocale(page, "en"); expect(reads).toHaveLength(orgCount);
 for(const width of [1280,375]) {
  await page.setViewportSize({width,height:1000});
  for(const element of [page.getByTestId("brain-tabs"),page.getByTestId("brain-tab-personal"),page.getByTestId("brain-tab-sessions"),page.getByTestId("brain-tab-shared"),page.getByRole("button",{name:"View organization memory"})]) {
   const box=await element.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x+box!.width).toBeLessThanOrEqual(width); await expect(element).toBeInViewport({ratio:1});
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`brain-shared-${width}-en.png`)});
 }
 await page.setViewportSize({width:1280,height:1000});
 const [reloaded]=await Promise.all([page.waitForResponse(responseFor(C.getBrainOverview.path)),page.reload()]); expect(C.getBrainOverview.out.parse(await reloaded.json())).toEqual(overview);
 await expect(page.getByRole("heading",{name:"Brain",exact:true})).toBeVisible(); await page.getByTestId("brain-tab-sessions").click(); await expect(page.getByTestId("brain-sessions")).toContainText("No conversation memories yet");
});
