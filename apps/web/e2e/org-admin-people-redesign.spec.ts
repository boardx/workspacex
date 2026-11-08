/** Real pages with controlled HTTP fixtures; this does not claim live backend evidence. */
import {expect as baseExpect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
const expect=baseExpect.configure({timeout:30000});
test.use({actionTimeout:30000});
test('people pages: responsive layouts, member pagination/search, invite filters/empty, profile save',async({page,baseURL})=>{
 test.setTimeout(180000);
 page.on("pageerror", error => console.log("PEOPLE PAGE ERROR", error.message));
 expect.configure({timeout:30000});
 expect(new URL(baseURL!).hostname).toBe('localhost');
 let emptyInvites=false,saves=0;
 let profile={orgId:'people-org',name:'People fixture organization',description:'Real page HTTP fixture',avatarUrl:null};
 await page.addInitScript(()=>{
  localStorage.setItem('wsx.sessionToken','people-fixture-token');
  localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'people-user',orgs:['people-org'],currentOrgId:'people-org',expiresAt:'2099-01-01T00:00:00Z'}));
 });
 await page.route(`${baseURL}/**`,async route=>{
  const req=route.request(),path=new URL(req.url()).pathname.replace(/^\/api(?=\/)/,'');
  if(path==='/identity/me')return route.fulfill({json:{org:{id:'people-org',name:profile.name,kind:'organization',team:null,modelPolicy:'any',avatarUrl:null},orgRole:'admin',teamId:null,projectRole:null,groupId:null,displayName:'Fixture administrator',avatarUrl:null}});
  if(path==='/organizations/people-org/members')return route.fulfill({json:{members:Array.from({length:11},(_,i)=>({userId:`member-${i}`,displayName:`Person ${i}`,email:`person${i}@example.test`,orgRole:i===0?'admin':'consultant',teamId:null,joinedAt:'2026-01-03T00:00:00Z',status:'active'}))}});
  if(path==='/organizations/people-org/invites')return route.fulfill({json:{invites:emptyInvites?[]:[{inviteId:'invite-pending',email:'pending@example.test',orgRole:'consultant',teamId:null,status:'pending',invitedBy:'people-user',expiresAt:'2099-01-03T00:00:00Z',createdAt:'2026-01-01T00:00:00Z'},{inviteId:'invite-used',email:'used@example.test',orgRole:'consultant',teamId:null,status:'used',invitedBy:'people-user',expiresAt:'2099-01-03T00:00:00Z',createdAt:'2026-01-01T00:00:00Z'}]}});
  if(path==='/organizations/people-org'){
   const body=req.postDataJSON()??{};
   if(body.name){saves++;profile={...profile,name:body.name,description:body.description??profile.description};}
   return route.fulfill({json:profile});
  }
  if(path.includes('invite-links'))return route.fulfill({json:{links:[]}});
  if(new URL(req.url()).pathname.startsWith('/api/') && ['fetch','xhr'].includes(req.resourceType()))return route.fulfill({status:404,json:{error:'fixture_unavailable'}});
  return route.continue();
 });
 mkdirSync('test-results/org-admin-redesign-6419',{recursive:true});
 async function responsive(name:string){for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/org-admin-redesign-6419/${name}-${width}.png`,fullPage:true});}}
 await page.goto('/org-admin/members');await expect(page.getByTestId('org-admin-member-member-0')).toBeVisible();await responsive('members');
 await page.getByRole('button',{name:'下一页',exact:true}).click();await expect(page.getByTestId('org-admin-member-member-10')).toBeVisible();
 await page.getByPlaceholder('搜索姓名或邮箱').fill('person0@');await expect(page.getByTestId('org-admin-member-member-0')).toBeVisible();
 await page.getByPlaceholder('搜索姓名或邮箱').fill('no-match');await expect(page.getByText('没有匹配的记录')).toBeVisible();
 await page.goto('/org-admin/invites',{waitUntil:'domcontentloaded'}).catch(async()=>{await page.goto('/org-admin/invites',{waitUntil:'domcontentloaded'});});await expect(page.getByTestId('org-admin-invite-invite-pending')).toBeVisible();await responsive('invites');
 await page.getByLabel('状态',{exact:true}).selectOption('used');await expect(page.getByTestId('org-admin-invite-invite-used')).toBeVisible();await expect(page.getByTestId('org-admin-invite-invite-pending')).toHaveCount(0);
 emptyInvites=true;await page.reload();await expect(page.getByTestId('org-admin-invite-invite-used')).toHaveCount(0);
 await page.goto('/org-admin/profile',{waitUntil:'domcontentloaded'}).catch(async()=>{await page.goto('/org-admin/profile',{waitUntil:'domcontentloaded'});});await expect(page.getByTestId('org-admin-name-input')).toHaveValue(profile.name);await responsive('profile');
 await page.getByTestId('org-admin-name-input').fill('Updated fixture organization');await page.getByTestId('org-admin-profile-save').click();await expect.poll(()=>saves).toBe(1);await expect(page.getByTestId('org-admin-profile-save')).toBeDisabled();
});
