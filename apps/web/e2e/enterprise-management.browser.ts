/** Real browser/Kernel/PG/Redis, plus one test-runtime post-commit transport fault. */
import {expect,test} from "@playwright/test";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {tsImport} from "tsx/esm/api";
import {enterpriseAcceptance as fixture} from "../../api/scripts/lib/enterprise-acceptance-fixture";
import {operations as C,type EnterpriseCreditGrantRequest} from "@repo/contracts/billing-team";
import {platformOrganizations as P} from "@repo/contracts";
type DatabaseFixture={asOwner<T>(fn:(c:{query(sql:string,params:unknown[]):Promise<{rows:Record<string,unknown>[]}>})=>Promise<T>):Promise<T>};
async function actualWallet(){
 const {asOwner}=await tsImport(pathToFileURL(resolve(__dirname,"../../api/tests/support/db.ts")).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,"../../api/tsconfig.json")}) as DatabaseFixture;
 return asOwner(async c=>{
  const wallet=(await c.query("SELECT wallet_id,balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[fixture.target])).rows[0]!;
  const audit=(await c.query("SELECT actor_id,audit_ref FROM enterprise_credit_grants WHERE org_id=$1",[fixture.target])).rows;
  const ledger=(await c.query("SELECT count(*)::int AS n FROM credit_transactions WHERE wallet_id=$1 AND type='grant'",[wallet.wallet_id])).rows[0]!;
  return {balance:Number(wallet.balance),totalGranted:Number(wallet.total_granted),ledgerCount:ledger.n,audits:audit};
 });
}
test("actual Enterprise management recovers a committed grant after lost response and reload without issuing a second grant",async({page})=>{
 const sent:EnterpriseCreditGrantRequest[]=[];
 const grantPath=C.grantEnterpriseCredits.path.replace(":orgId",fixture.target);
 page.on("request",request=>{if(request.method()==="POST"&&new URL(request.url()).pathname.endsWith(grantPath))sent.push(C.grantEnterpriseCredits.in.parse(request.postDataJSON()));});
 await page.goto("/login");
 await page.getByTestId("login-email").fill(fixture.operatorEmail);
 await page.getByTestId("login-password").fill(fixture.password);
 await page.getByTestId("login-submit").click();await expect(page).toHaveURL(/\/home$/);
 await page.goto("/platform-admin/organizations");
 await page.getByLabel("搜索组织名称").fill(fixture.target);await page.getByRole("button",{name:"搜索",exact:true}).click();
 await page.getByRole("row").filter({hasText:fixture.target}).getByRole("button",{name:"详情与套餐"}).click();
 const upgradeResponse=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/enterprise-upgrades"));
 await page.getByRole("button",{name:"手动升级 Enterprise",exact:true}).click();await page.getByRole("button",{name:"确认升级",exact:true}).click();
 const upgrade=await upgradeResponse;expect(upgrade.status()).toBe(201);expect(C.createEnterpriseUpgrade.out.parse(await upgrade.json()).status).toBe("succeeded");
 await expect(page.getByLabel("添加额度",{exact:true})).toBeVisible();await page.getByLabel("添加额度",{exact:true}).fill("42");await page.getByLabel("添加原因").fill("Browser acceptance approved allowance");
 await page.getByRole("button",{name:"添加额度",exact:true}).click();await page.getByRole("button",{name:"确认添加",exact:true}).click();
 const panel=page.getByRole("region",{name:"Enterprise 管理"});
 await expect(panel.getByRole("status")).toContainText("操作未确认完成");expect(sent).toHaveLength(1);
 const committed=await actualWallet();expect(committed).toMatchObject({balance:42,totalGranted:42,ledgerCount:1,audits:[{actor_id:fixture.operator}]});
 mkdirSync("test-results/enterprise-management-6108",{recursive:true});await page.screenshot({path:"test-results/enterprise-management-6108/enterprise-response-lost.png",fullPage:true});
 await page.reload();await page.getByLabel("搜索组织名称").fill(fixture.target);await page.getByRole("button",{name:"搜索",exact:true}).click();
 const detailResponse=page.waitForResponse(r=>r.request().method()==="GET"&&new URL(r.url()).pathname.endsWith(P.operations.getOrganization.path.replace(":orgId",fixture.target)));
 await page.getByRole("row").filter({hasText:fixture.target}).getByRole("button",{name:"详情与套餐"}).click();
 const detail=await detailResponse;expect(detail.status()).toBe(200);expect(P.operations.getOrganization.out.parse(await detail.json()).organization.billingSummary?.wallet.balance).toBe(42);
 await expect(panel.getByRole("status")).toContainText("已恢复尚未确认的原请求");await expect(page.getByLabel("添加额度",{exact:true})).toBeDisabled();expect(sent).toHaveLength(1);
 const retryResponse=page.waitForResponse(r=>r.request().method()==="POST"&&new URL(r.url()).pathname.endsWith(grantPath));
 await page.getByRole("button",{name:"重试原请求",exact:true}).click();const retry=await retryResponse;expect(retry.status()).toBe(201);
 const receipt=C.grantEnterpriseCredits.out.parse(await retry.json());expect(receipt.balance).toBe(42);expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
 await expect(panel.getByRole("status")).toContainText(receipt.auditRef);await expect(page.getByTestId("enterprise-credit-balance")).toContainText("42 credit");
 expect(await actualWallet()).toEqual(committed);
 await page.screenshot({path:"test-results/enterprise-management-6108/enterprise-grant-recovered.png",fullPage:true});
 writeFileSync("test-results/enterprise-management-6108/browser-success.json",JSON.stringify({isolationId:process.env.WORKSPACEX_ISOLATION_ID,passed:true}));
});
