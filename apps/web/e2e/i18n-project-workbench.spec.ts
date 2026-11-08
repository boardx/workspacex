import { setShellLocale } from "./shell-locale";
import { expect, test, type Page } from "@playwright/test";
import { project as C } from "@repo/contracts";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
import { boardLogin } from "./board-acceptance-support";
import { captureBoardLogin } from "./support/board-login-capture.mjs";
import { parseCreatedProject } from "./project-create-contract";
const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");
async function login(page: Page, email: string, enteredText: string, userId: string) {
  await page.goto("/login");await page.getByTestId("language-switcher").selectOption("en");
  const result=await captureBoardLogin(page,()=>boardLogin(page,email,enteredText));
  expect(result.posts,"PROJECT_WORKBENCH_SINGLE_LOGIN").toBe(1);expect(result.status).toBe(200);
  expect(result.body!==null&&typeof result.body==="object"&&"userId" in result.body&&result.body.userId===userId,"PROJECT_WORKBENCH_REAL_ACTOR").toBe(true);
}
async function pictures(page: Page, name: string) {
  for(const width of [375,1280]){
    await page.setViewportSize({width,height:900});
    for(const id of ["project-title","project-back-to-list","project-tabs"]){const box=await page.getByTestId(id).boundingBox();expect(box,id).not.toBeNull();expect(box!.x,id).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width,id).toBeLessThanOrEqual(width+1);}
    const role=page.getByTestId("project-role-switcher");if(await role.count()){const box=await role.boundingBox();expect(box!.x+box!.width).toBeLessThanOrEqual(width+1);const description=await page.getByTestId("project-scope-description").boundingBox();if(width===375){const note=await page.getByTestId("project-role-scope-note").boundingBox();expect(description!.width,"mobile role explanation uses a readable full row").toBeGreaterThanOrEqual(note!.width*0.8);}}
    await page.screenshot({path:`test-results/project-workbench-${name}-${width}-en.png`,fullPage:true});
  }
}
test("general project keeps raw title and tab links through locale and real navigation",async({page})=>{
 await login(page,F.leadEmail,F.leadPassword,F.leadUserId);await page.goto("/projects");await page.getByTestId("projects-new").click();
 const name=`原文工作台 {name} ${F.orgId.slice(-16)}`;await page.getByTestId("project-new-name").fill(name);
 const [response]=await Promise.all([page.waitForResponse(r=>pathOf(r.url())==="/projects"&&r.request().method()==="POST"),page.getByTestId("project-new-create").click()]);expect(response.status()).toBe(201);
 const created=parseCreatedProject(await response.json());expect(C.operations.createProject.in.parse(response.request().postDataJSON())).toEqual({orgId:F.orgId,name,kind:"general",blueprintVersionId:null});await page.waitForURL(new RegExp(`/projects/${created.id}(?:[?]|$)`));
 await expect(page.getByTestId("project-title")).toHaveText(name);await expect(page.getByTestId("project-tab-content")).toHaveText("Content");await expect(page.getByTestId("project-tab-results")).toHaveText("Results");expect(await page.getByTestId("project-role-scope-note").count()).toBe(0);
 let reads=0;page.on("request",request=>{if(pathOf(request.url())===`/projects/${created.id}/overview`)reads++;});
 const node=await page.getByTestId("project-tab-content").elementHandle();const href=await page.getByTestId("project-tab-content").getAttribute("href");
 await setShellLocale(page, "zh-CN");await expect(page.getByTestId("project-tab-content")).toHaveText("内容");await setShellLocale(page, "en");await expect(page.getByTestId("project-tab-content")).toHaveText("Content");expect(reads).toBe(0);expect(await page.getByTestId("project-tab-content").evaluate((current,previous)=>current===previous,node)).toBe(true);await expect(page.getByTestId("project-tab-content")).toHaveAttribute("href",href!);
 await page.getByTestId("project-tab-content").click();await expect(page).toHaveURL(/tab=content/);await expect(page.getByTestId("project-tab-content")).toHaveAttribute("aria-current","page");await expect(page.getByTestId("project-title")).toHaveText(name);
 await pictures(page,"general");const loaded=page.waitForResponse(r=>pathOf(r.url())===`/projects/${created.id}/overview`);await page.reload();const overview=await loaded;expect(overview.status()).toBe(200);expect(C.operations.getProjectOverview.out.parse(await overview.json())).toMatchObject({projectId:created.id,name,kind:"general"});await expect(page.getByTestId("project-tab-content")).toHaveText("Content");
});
test("workshop retains canonical research navigation and facilitator controls",async({page})=>{
 await login(page,F.email,F.password,F.userId);const loaded=page.waitForResponse(r=>pathOf(r.url())===`/projects/${F.projectId}/overview`);await page.goto(`/projects/${F.projectId}`);const overview=await loaded;expect(overview.status()).toBe(200);expect(C.operations.getProjectOverview.out.parse(await overview.json()).kind).toBe("workshop");
 await expect(page.getByTestId("project-title")).toHaveText(F.projectName);await expect(page.getByTestId("project-role-badge")).toHaveText("Facilitator view");await expect(page.getByTestId("project-scope-stage-control")).toHaveText("Session controls");await page.getByTestId("project-tab-research").click();await expect(page).toHaveURL(/tab=research/);await expect(page.getByTestId("project-subnav-survey")).toHaveText("Surveys");
 const href=await page.getByTestId("project-subnav-survey").getAttribute("href");let reads=0;page.on("request",r=>{if(pathOf(r.url())===`/projects/${F.projectId}/overview`)reads++;});await setShellLocale(page, "zh-CN");await expect(page.getByTestId("project-tab-research")).toHaveText("研究洞察");await setShellLocale(page, "en");await expect(page.getByTestId("project-tab-research")).toHaveText("Research insights");expect(reads).toBe(0);await expect(page.getByTestId("project-subnav-survey")).toHaveAttribute("href",href!);
 await page.getByTestId("project-subnav-survey").click();await expect(page).toHaveURL(/sub=survey/);await pictures(page,"workshop");
});
test("nonmember keeps actual 403 and translates invitation guidance without rereading",async({page})=>{
 await login(page,F.memberEmail,F.memberPassword,F.memberUserId);const denied=page.waitForResponse(r=>pathOf(r.url())===`/projects/${F.projectId}/overview`);await page.goto(`/projects/${F.projectId}`);const response=await denied;expect(response.status()).toBe(403);expect((await response.json()).reasonCode).toBe("NO_PROJECT_ROLE");await expect(page.getByTestId("project-access-denied")).toHaveAttribute("data-reason","NO_PROJECT_ROLE");await expect(page.getByTestId("project-access-denied")).toContainText("You are not in this project yet");
 let reads=0;page.on("request",r=>{if(pathOf(r.url())===`/projects/${F.projectId}/overview`)reads++;});await setShellLocale(page, "zh-CN");await expect(page.getByTestId("project-access-denied")).toContainText("你还不在这个项目里");await setShellLocale(page, "en");await expect(page.getByTestId("project-access-denied")).toContainText("You are not in this project yet");expect(reads).toBe(0);await expect(page.getByTestId("project-title")).toHaveText("Invitation required");expect(await page.getByTestId("project-header-meta").count()).toBe(0);expect(await page.getByTestId("project-general-overview").count()).toBe(0);
 await page.getByTestId("project-access-denied-back").click();await expect(page).toHaveURL(/\/projects$/);
});
