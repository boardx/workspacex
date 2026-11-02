/** Real browser + real Kernel/PG/Redis; no route interception or supplier charges. */
import {expect,test} from "@playwright/test";
import {mkdirSync} from "node:fs";
import {enterpriseAcceptance as fixture} from "../../api/scripts/lib/enterprise-acceptance-fixture";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";
import {tsImport} from "tsx/esm/api";
import {operations as C} from "@repo/contracts/billing-team";
import {platformOrganizations as P} from "@repo/contracts";
test("platform operator upgrades an unpaid organization and grants audited credits through the actual management screen",async({page})=>{
 await page.goto("/login");await page.getByTestId("login-email").fill(fixture.operatorEmail);await page.getByTestId("login-password").fill(fixture.password);await page.getByTestId("login-submit").click();await expect(page).toHaveURL(/\/home$/);
 await page.goto("/platform-admin/organizations");await page.getByLabel("搜索组织名称").fill(fixture.target);await page.getByRole("button",{name:"搜索",exact:true}).click();
 await page.getByRole("row").filter({hasText:fixture.target}).getByRole("button",{name:"详情与套餐"}).click();
 const upgradeResponse=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/enterprise-upgrades"));await page.getByRole("button",{name:"手动升级 Enterprise",exact:true}).click();const upgrade=await upgradeResponse;expect(upgrade.status()).toBe(201);expect(C.createEnterpriseUpgrade.out.parse(await upgrade.json()).status).toBe("succeeded");
 await expect(page.getByLabel("添加额度",{exact:true})).toBeVisible();await page.getByLabel("添加额度",{exact:true}).fill("42");await page.getByLabel("添加原因").fill("Browser acceptance approved allowance");
 const grantResponse=page.waitForResponse(r=>r.request().method()==="POST"&&r.url().includes("/credit-grants"));await page.getByRole("button",{name:"添加额度",exact:true}).click();const grant=await grantResponse;expect(grant.status()).toBe(201);const receipt=C.grantEnterpriseCredits.out.parse(await grant.json());expect(receipt.balance).toBe(42);
 await expect(page.getByRole("status")).toContainText(receipt.auditRef);await expect(page.getByRole("status")).toContainText("已添加 42");
 mkdirSync("test-results/enterprise-management-6108",{recursive:true});await page.screenshot({path:"test-results/enterprise-management-6108/enterprise-grant-confirmed.png",fullPage:true});
 await page.reload();await page.getByLabel("搜索组织名称").fill(fixture.target);await page.getByRole("button",{name:"搜索",exact:true}).click();
 const detailResponse=page.waitForResponse(r=>r.request().method()==="GET"&&new URL(r.url()).pathname.endsWith(`/platform/organizations/${fixture.target}`));await page.getByRole("row").filter({hasText:fixture.target}).getByRole("button",{name:"详情与套餐"}).click();const detail=await detailResponse;expect(detail.status()).toBe(200);expect(P.operations.getOrganization.out.parse(await detail.json()).organization.billingSummary?.wallet.balance).toBe(42);await expect(page.getByLabel("添加额度",{exact:true})).toBeVisible();
 const {asOwner}=await tsImport(pathToFileURL(resolve(__dirname,"../../api/tests/support/db.ts")).href,{parentURL:pathToFileURL(__filename).href,tsconfig:resolve(__dirname,"../../api/tsconfig.json")}) as {asOwner<T>(fn:(c:{query(sql:string,params:unknown[]):Promise<{rows:Record<string,unknown>[]}>})=>Promise<T>):Promise<T>};
 await asOwner(async c=>{const wallet=(await c.query("SELECT balance::text,total_granted::text FROM credit_wallets WHERE owner_type='team' AND owner_id=$1",[fixture.target] )).rows[0]!;expect(Number(wallet.balance)).toBe(42);expect(Number(wallet.total_granted)).toBe(42);expect((await c.query("SELECT count(*)::int AS n FROM enterprise_credit_grants WHERE org_id=$1 AND audit_ref=$2",[fixture.target,receipt.auditRef])).rows[0]!.n).toBe(1);});
});
