const { chromium } = require('../../../apps/web/node_modules/@playwright/test');
const fs = require('fs');
const path = require('path');
const evidenceRoot = __dirname;
(async () => {
 const browser = await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context = await browser.newContext({viewport:{width:1440,height:1024}});
 await context.addInitScript(() => {
  localStorage.setItem('wsx.sessionToken','home-theme-test');
  localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'test-admin',orgs:['test-org'],currentOrgId:'test-org',expiresAt:'2099-01-01T00:00:00.000Z'}));
 });
 let config={orgId:'test-org',title:'BoardX',tagline:'团队协作空间',bannerHeadline:'让创造更有人性，让协作更有效率',bannerTagline:'在同一个工作面上，和 AI 一起完成一件事。',bannerPreset:'ocean',bannerColor:null,bannerImageUrl:null,themeColors:{primary:'#2F6FED',secondary:'#089FA8',accent:'#C3EEEA',success:'#158567',warning:'#A65B12',error:'#CC334B'},quickActions:['chat','board','projects','brain'].map((key,order)=>({key,order,enabled:true})),recommendedCapabilities:[],recommendedAgents:[],sections:{recentWork:true,currentTasks:true},updatedAt:'2026-10-01T00:00:00.000Z',updatedBy:'test-admin'};
 await context.route('**/organizations/test-org/home-config',async route=> {
  if(route.request().method()==='PUT')config={...config,...route.request().postDataJSON()};
  await route.fulfill({json:config});
 });
 await context.route('**/identity/me?**',route=>route.fulfill({json:{org:{id:'test-org',name:'BoardX',kind:'enterprise',team:null,avatarUrl:null},orgRole:'admin',projectRole:null,teamId:null,groupId:null,displayName:'测试管理员',avatarUrl:null}}));
 await context.route('http://localhost:3200/**',route=> {
  if(new URL(route.request().url()).pathname==='/identity/me')return route.fulfill({json:{org:{id:'test-org',name:'BoardX',kind:'enterprise',team:null,avatarUrl:null},orgRole:'admin',projectRole:null,teamId:null,groupId:null,displayName:'测试管理员',avatarUrl:null}});
  return route.fulfill({json:{items:[],projects:[],threads:[]}});
 });
 // Specific routes override the generic fixture route.
 await context.route('**/organizations/test-org/home-config',async route=>{
  if(route.request().method()==='PUT')config={...config,...route.request().postDataJSON()};
  await route.fulfill({json:config});
 });
 let logoBytes=null;
 await context.route('**/organizations/test-org/avatar?**', async route=> {
  logoBytes=route.request().postDataBuffer();
  await route.fulfill({json:{orgAvatarArtifactId:'logo-1',avatarUrl:'/organizations/test-org/avatar-file/logo-1'}});
 });
 await context.route('**/organizations/test-org', route=>route.fulfill({json:{orgId:'test-org',name:'BoardX',description:null,avatarUrl:logoBytes?'/organizations/test-org/avatar-file/logo-1':null}}));
 await context.route('**/organizations/test-org/avatar-file/logo-1',route=>route.fulfill({body:logoBytes,contentType:'image/png'}));
 const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3000/home');
 await page.getByTestId('home-screen').waitFor({timeout:120000});
 await page.screenshot({path:path.join(evidenceRoot, 'home-desktop.png'),fullPage:true});
 await page.goto('http://localhost:3000/org-admin/home-config');
 await page.getByTestId('home-config-theme').waitFor({timeout:120000});
 const logoData=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=64;c.height=64;const x=c.getContext('2d');x.fillStyle='#1E5AD2';x.fillRect(0,0,48,64);x.fillStyle='#14A08C';x.fillRect(48,0,16,64);return c.toDataURL('image/png').split(',')[1]});
 await page.getByTestId('home-logo-file').setInputFiles({name:'test-logo.png',mimeType:'image/png',buffer:Buffer.from(logoData,'base64')});
 await page.getByText('组织 Logo 已更新；自动生成的主题颜色在保存后生效。',{exact:true}).waitFor();
 if(await page.getByLabel('主色色值',{exact:true}).inputValue()!=='#1E5AD2')throw Error('Logo did not generate primary color');
 await page.getByTestId('home-theme-generate').click();
 await page.getByText('已从 Logo 生成主题颜色，保存后应用到组织首页。',{exact:true}).waitFor();
 await page.getByLabel('主色色值',{exact:true}).fill('#6532A8');
 await page.getByTestId('home-config-save').click();
 await page.getByText('已保存',{exact:true}).waitFor();
 if(config.themeColors.primary!=='#6532A8')throw Error('Theme was not saved');
 await page.screenshot({path:path.join(evidenceRoot, 'settings-desktop.png'),fullPage:true});
 await page.getByRole('tab',{name:'布局',exact:true}).click();
 await page.getByTestId('home-config-open-preview').click();
 await page.getByTestId('home-config-preview-frame').waitFor();
 await page.goto('http://localhost:3000/home');await page.getByTestId('home-screen').waitFor();
 const primary=await page.getByTestId('home-screen').evaluate(el=>el.style.getPropertyValue('--primary'));
 if(!primary)throw Error('Theme CSS missing');
 await page.setViewportSize({width:390,height:844});
 await page.screenshot({path:path.join(evidenceRoot, 'home-mobile.png'),fullPage:true});
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 if(overflow)throw Error('Mobile horizontal overflow');
 fs.writeFileSync(path.join(evidenceRoot, 'browser.json'),JSON.stringify({errors,themeSaved:config.themeColors.primary,primary,mobileOverflow:overflow},null,2));
 if(errors.length)throw Error(errors.join('\n'));
 await browser.close();
 console.log('Homepage/settings desktop and mobile checks passed');
})().catch(e=>{console.error(e);process.exit(1)});
