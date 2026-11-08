import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
// Deterministic HTTP fixtures validate UI states/layout only, not backend import authority.
const output = resolve(process.cwd(), "../../evidence/official-role-6436/browser");
const roles = [
  ["D001", "高管与战略伙伴", "executive", "dh-01-executive-strategy-partner"],
  ["D002", "研究与知识分析师", "research", "dh-02-research-knowledge-analyst"],
  ["D003", "产品经理", "product", "dh-03-product-manager"],
  ["D005", "销售代表", "sales", "dh-05-sales-representative"],
  ["D006", "客户成功专员", "customer_success", "dh-06-customer-success-specialist"],
  ["D007", "项目与运营经理", "operations", "dh-07-project-operations-manager"],
  ["D011", "设计思维专家", "design", "dh-11-design-thinking-expert"],
].map(([roleRef,name,roleCategory,key]) => ({roleRef,name,roleCategory,roleLabel:name,avatar:{kind:"illustration",key,alt:name},tags:[],workflowAllowlist:[]}));
test("official cards keep inline metadata and truthful activation feedback on desktop and mobile", async ({page}) => {
  mkdirSync(output, {recursive:true});
  await page.addInitScript(() => {
    localStorage.setItem("wsx.session",JSON.stringify({version:1,userId:"visual-admin",orgs:["org-visual"],currentOrgId:"org-visual",expiresAt:"2099-01-01T00:00:00Z"}));
    localStorage.setItem("wsx.sessionToken","visual-fixture"); document.cookie="workspacex-locale=zh-CN; Path=/";
  });
  let imported=false, attempts=0;
  let release!: () => void;
  const firstAttempt = new Promise<void>(resolve => {release=resolve;});
  await page.route("http://localhost:3200/**",async route => {
    const path=new URL(route.request().url()).pathname; let body:unknown=[]; let status=200;
    if(path==="/identity/me") body={displayName:"Visual admin",avatarUrl:null,org:{id:"org-visual",name:"示例组织",kind:"organization",status:"active",modelPolicy:"any"},orgRole:"admin",teamId:null,projectRole:null,groupId:null};
    else if(path==="/platform/access") body={platformOperator:false,platformAdmin:false,platformSuperuser:false};
    else if(path==="/agents/official-role-pack/offer") body={packId:"official-digitalhuman-roles",packVersion:"1.7.0",canEnable:true,pending:imported?[]:roles,requiredSkillPacks:[],upgrades:[]};
    else if(path==="/agents/directory") body={items:imported?roles.map(r=>({agentId:r.roleRef,versionId:r.roleRef+"-v1",name:r.name,initials:r.name!.slice(0,1),roleLabel:r.name,avatar:r.avatar,roleCategory:r.roleCategory,tags:[],catalogSource:"official",workflows:[],readiness:"ready"})):[]};
    else if(path==="/admin/entity-display-updates/offer") body={metadataVersion:"2.0.0",available:false,installedCount:imported?7:0};
    else if(path==="/admin/agents/starter-pack-imports") {
      attempts++;
      if(attempts===1){await firstAttempt;status=422;body={reasonCode:"UNRESOLVED_WORKFLOW_REF"};}
      else {imported=true;body={};}
    } else if(path==="/admin/entity-display-updates") body={metadataVersion:"2.0.0",updatedEntities:7,skippedEntities:0,replayed:false,appliedAt:"2026-11-08T16:00:00.000Z"};
    else if(path.endsWith("/unread-count"))body={unreadCount:0};
    else if(path.endsWith("/count"))body={count:0};
    await route.fulfill({status,headers:{"content-type":"application/json","access-control-allow-origin":"http://localhost:3199","access-control-allow-credentials":"true","access-control-allow-methods":"GET,POST,OPTIONS","access-control-allow-headers":"content-type,authorization"},body:JSON.stringify(body)});
  });
  await page.setViewportSize({width:1440,height:1000}); await page.goto("/org-admin/agent");
  await page.getByRole("button",{name:"官方角色",exact:true}).click();
  await expect(page.getByTestId("official-role-status-D003")).toHaveText("待启用");
  const card=page.getByTestId("official-role-card-D003");
  const heading=await card.getByRole("heading").boundingBox(), category=await card.getByText("产品",{exact:true}).boundingBox(), avatar=await card.locator('[data-avatar-key]').boundingBox(), badge=await page.getByTestId("official-role-status-D003").boundingBox();
  expect(category!.x).toBeGreaterThan(avatar!.x+avatar!.width); expect(category!.y).toBeGreaterThan(heading!.y); expect(badge!.y).toBeLessThan(category!.y);
  await page.screenshot({path:resolve(output,"pending-desktop.png"),fullPage:true});
  await page.getByRole("button",{name:"启用官方数字人",exact:true}).click();
  await expect(page.getByTestId("official-role-status-D003")).toHaveText("启用中…");
  release(); await expect(page.getByTestId("official-role-status-D003")).toHaveText("启用失败");
  await page.screenshot({path:resolve(output,"failed-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:resolve(output,"failed-mobile.png"),fullPage:true});
  await page.getByRole("button",{name:"启用官方数字人",exact:true}).click();
  await expect(page.getByTestId("agent-card-D003")).toBeVisible();
  await expect(page.getByTestId("agent-card-D003").getByText("已启用",{exact:true})).toBeVisible();
  await page.screenshot({path:resolve(output,"enabled-mobile.png"),fullPage:true});
  expect(attempts).toBe(2);
});
