/** Controlled HTTP fixtures exercise real organization admin screens; no production-data claim. */
import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test('workflow details and member Credit controls remain responsive and preserve write boundaries',async({page,baseURL})=>{
 test.setTimeout(120_000);
 expect(new URL(baseURL!).hostname).toBe('localhost');
 let writes=0,limit=1000;
 await page.addInitScript(()=>{
  localStorage.setItem('wsx.sessionToken','org-controls-browser-session');
  localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'admin',orgs:['controls-org'],currentOrgId:'controls-org',expiresAt:'2099-01-01T00:00:00Z'}));
 });
 await page.route(`${baseURL}/**`,async route=>{
  const request=route.request(),path=new URL(request.url()).pathname.replace(/^\/api(?=\/)/,'');
  if(['POST','PATCH','PUT','DELETE'].includes(request.method()))writes++;
  if(path==='/identity/me')return route.fulfill({json:{org:{id:'controls-org',name:'Controls organization',kind:'organization',team:null,modelPolicy:'any',avatarUrl:null},orgRole:'admin',teamId:null,projectRole:null,groupId:null,displayName:'Administrator',avatarUrl:null}});
  if(path==='/workflow-capability-grants')return route.fulfill({json:{workflows:[{workflowId:'W029',workflowKey:'problem-to-prd',title:'Problem-to-PRD',capabilities:[{capabilityCategory:'artifact.write',requiredCap:'write',stageIds:['persist']}]}],grants:[{capabilityCategory:'artifact.write',configured:false,authorized:true,sideEffectCap:'read',updatedAt:null,updatedBy:null}],audit:[{eventId:'audit-1',capabilityCategory:'artifact.write',action:'revoked',fromCap:'write',toCap:'read',actorId:'admin',at:'2026-11-01T10:00:00Z'}]}});
  if(path==='/organizations/controls-org/credit-quotas')return route.fulfill({json:{enterprise:true,defaultMonthlyLimit:1000,month:'2026-11',members:[{userId:'alice',displayName:'Alice',email:'alice@example.test',monthlyLimit:limit,overridden:limit!==1000,usedCredits:12.34,heldCredits:3.21},{userId:'bob',displayName:'Bob',email:'bob@example.test',monthlyLimit:1000,overridden:false,usedCredits:1000,heldCredits:0}]}});
  if(path==='/organizations/controls-org/credit-quotas/alice'&&request.method()==='PATCH'){expect(request.postDataJSON()).toEqual({monthlyLimit:1500});limit=1500;return route.fulfill({json:{monthlyLimit:limit}});}
  if(path==='/organizations/controls-org/members')return route.fulfill({json:{members:[{userId:'admin',displayName:'Administrator',email:'admin@example.test',orgRole:'admin',teamId:null,joinedAt:'2026-01-01T00:00:00Z',status:'active'}]}});
  if(['fetch','xhr'].includes(request.resourceType()))return route.fulfill({status:503,json:{error:'dependency_unavailable'}});
  return route.continue();
 });
 mkdirSync('/tmp/org-admin-controls-redesign-6419',{recursive:true});
 await page.goto('/org-admin/workflow-grants');
 const row=page.getByTestId('workflow-grant-row-artifact.write');await expect(row).toBeVisible();
 for(const width of [375,768,1280]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/org-admin-controls-redesign-6419/workflow-${width}.png`,fullPage:true});
  await row.getByRole('button',{name:'详情'}).click();
  const drawer=page.getByRole('dialog');await expect(drawer).toContainText('问题定义到 PRD');await expect(drawer).toContainText('Administrator');
  const bounds=await drawer.boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(width+1);
  await page.screenshot({path:`/tmp/org-admin-controls-redesign-6419/workflow-drawer-${width}.png`,fullPage:true});
  await page.keyboard.press('Escape');await expect(drawer).toHaveCount(0);expect(writes).toBe(0);
 }
 await page.goto('/admin/members');await expect(page.getByTestId('member-credit-usage-alice')).toBeVisible();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`/tmp/org-admin-controls-redesign-6419/quota-${width}.png`,fullPage:true});}
 await page.getByLabel('搜索成员姓名或邮箱').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/org-admin-controls-redesign-6419/quota-table-1280.png',fullPage:true});
 await page.getByLabel('搜索成员姓名或邮箱').fill('unknown');await expect(page.getByText('没有匹配记录')).toBeVisible();
 await page.getByLabel('搜索成员姓名或邮箱').fill('alice@example');await expect(page.getByTestId('member-credit-usage-alice')).toBeVisible();await expect(page.getByTestId('member-credit-usage-bob')).toHaveCount(0);
 await page.setViewportSize({width:375,height:900});
 expect(writes).toBe(0);await page.getByTestId('member-credit-adjust-alice').click();await expect(page.getByTestId('member-credit-save')).toBeInViewport();await page.screenshot({path:'/tmp/org-admin-controls-redesign-6419/quota-adjust-375.png',fullPage:true});await page.getByTestId('member-credit-limit').fill('1500');await page.getByTestId('member-credit-save').click();await expect(page.getByTestId('member-credit-quota-modal')).toHaveCount(0);await expect(page.getByTestId('member-credit-usage-alice')).toContainText('1,500');expect(writes).toBe(1);
});
