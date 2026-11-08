/** Real organization UI with controlled HTTP fixtures; does not prove production data or RLS. */
import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
test('overview reads actual window data, preserves navigation and fits three widths',async({page,baseURL})=>{
 test.setTimeout(120_000);
 expect(new URL(baseURL!).hostname).toBe('localhost');
 const windows:string[]=[];
 await page.addInitScript(()=>{
  localStorage.setItem('wsx.sessionToken','org-ui-test');
  localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'u1',orgs:['org-ui'],currentOrgId:'org-ui',expiresAt:'2099-01-01T00:00:00Z'}));
 });
 await page.route(`${baseURL}/**`,async route=>{
  const request=route.request(),url=new URL(request.url()),path=url.pathname.replace(/^\/api(?=\/)/,'');
  if(path==='/identity/me')return route.fulfill({json:{org:{id:'org-ui',name:'设计验证组织',kind:'organization',team:null,modelPolicy:'any',avatarUrl:null},orgRole:'admin',teamId:null,projectRole:null,groupId:null,displayName:'管理员',avatarUrl:null}});
  if(path==='/organizations/org-ui/members')return route.fulfill({json:{members:Array.from({length:5},(_,i)=>({userId:`u${i+1}`,displayName:`成员${i+1}`,email:`member${i+1}@example.test`,orgRole:i===0?'admin':'consultant',teamId:null,joinedAt:'2026-01-01T00:00:00Z',status:'active'}))}});
  if(path==='/organizations/org-ui/usage'){
   const window=url.searchParams.get('window')??'month';windows.push(window);const total=window==='today'?1200:48000;
   return route.fulfill({json:{window,totalTokens:total,callCount:12,failedCallCount:0,activeMemberCount:2,models:[],rows:[],distribution:[{modelId:'model-a',tokens:total*.75,share:.75},{modelId:'model-b',tokens:total*.25,share:.25}]}});
  }
  if(path==='/organizations/org-ui/limit-events')return route.fulfill({json:{events:[]}});
  if(path==='/provenance')return route.fulfill({json:{events:[{id:'activity-ui',type:'project-created',actorId:'u2',at:'2026-11-08T10:00:00Z',orgId:'org-ui',target:{kind:'organization',id:'org-ui'},detail:{}}],nextCursor:null}});
  if(['fetch','xhr'].includes(request.resourceType()))return route.fulfill({status:404,json:{}});
  return route.continue();
 });
 await page.goto('/admin');
 await expect(page.getByTestId('admin-overview-metric-tokens')).toContainText('48,000');
 await expect(page.getByTestId('admin-overview-model-usage')).toContainText('model-a');
 await expect(page.getByTestId('admin-overview-metric-members')).toContainText('2');
 await page.getByTestId('admin-overview-model-usage').getByRole('button',{name:'今天',exact:true}).click();
 await expect(page.getByTestId('admin-overview-metric-tokens')).toContainText('1,200');
 expect(windows).toContain('today');
 mkdirSync('/tmp/org-admin-overview-redesign-6419',{recursive:true});
 for(const width of [1280,768,375]){
  await page.setViewportSize({width,height:1000});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:`/tmp/org-admin-overview-redesign-6419/overview-${width}.png`,fullPage:true});
 }
});
