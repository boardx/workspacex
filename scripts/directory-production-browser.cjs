'use strict';
const fs=require('node:fs'),path=require('node:path');
const arg=k=>process.argv[process.argv.indexOf(k)+1];
const check=(v,code)=>{if(!v)throw Error(code)};
async function run(){
 const c=JSON.parse(fs.readFileSync(arg('--config'),'utf8')),out=arg('--output'),mode=arg('--mode');
 check(['baseline','candidate'].includes(mode),'MODE');check(c.origin==='https://app.boardx.com.cn','ORIGIN');
 fs.mkdirSync(out,{recursive:false,mode:0o700});
 const d=JSON.parse(fs.readFileSync(c.deploymentConfig,'utf8'));
 const email=d.provision.adminEmail,password=fs.readFileSync(c.passwordFile,'utf8');
 check(typeof email==='string'&&email.includes('@')&&password.length>0&&!/[\r\n\0]/.test(password),'CREDENTIAL_REF');
 const {chromium}=require(c.playwrightModule),browser=await chromium.launch({headless:true,executablePath:c.browserExecutable,args:['--no-sandbox']});
 let blockedWrites=0;
 try{
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(30000);
  await context.route('**/*',route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin!==c.origin){if(['GET','HEAD','OPTIONS'].includes(r.method()))return route.continue();blockedWrites++;return route.abort();}
   if(['GET','HEAD','OPTIONS'].includes(r.method())||r.method()==='POST'&&u.pathname==='/api/auth/login')return route.continue();
   blockedWrites++;return route.abort();
  });
  await page.goto(c.origin+'/login',{waitUntil:'domcontentloaded'});
  await page.getByTestId('login-email').fill(email);await page.getByTestId('login-password').fill(password);await page.getByTestId('login-submit').click();
  await page.waitForURL(u=>u.origin===c.origin&&u.pathname!=='/login',{timeout:45000});
  await page.goto(c.origin+'/agent',{waitUntil:'domcontentloaded'});
  const checks={login:true,directory:true};
  if(mode==='baseline'){
   check(await page.locator('main').count()>0,'BASELINE_SURFACE');await page.screenshot({path:path.join(out,'baseline-directory.png'),fullPage:true});
   return {passed:true,mode,checks,screenshots:1,blockedWrites};
  }
  const {expect}=require(c.playwrightTestModule);
  const cards=page.locator('[data-testid^="agent-card-"]').filter({has:page.getByTestId('agent-card-start-chat')});
  await expect(cards.first()).toBeVisible({timeout:45000});
  for(const [name,width,height,columns] of [['desktop',1440,1000,3],['tablet',768,1024,2],['mobile',390,844,1]]){
   await page.setViewportSize({width,height});
   await expect.poll(()=>cards.first().evaluate(el=>getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length)).toBe(columns);
   check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'HORIZONTAL_OVERFLOW');
   check((await page.getByTestId('agent-directory-search').boundingBox()).height>=36,'SEARCH_HEIGHT');
   for(const img of await cards.locator('img').all())await expect.poll(()=>img.evaluate(el=>el.complete&&el.naturalWidth>0)).toBe(true);
   await page.screenshot({path:path.join(out,'organization-'+name+'.png'),fullPage:true});
  }
  checks.layout=true;checks.portraits=true;
  const search=page.getByTestId('agent-directory-search');await search.fill('no-such-directory-role-5752');await expect(page.getByTestId('agent-directory-empty')).toBeVisible();
  await page.screenshot({path:path.join(out,'filtered-empty-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'清除筛选',exact:true}).click();await expect(cards.first()).toBeVisible();checks.filterEmptyRecovery=true;
  await page.getByRole('button',{name:'官方角色',exact:true}).click();
  await expect(page.getByTestId('agent-directory-official')).toBeVisible();await page.screenshot({path:path.join(out,'official-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'本组织',exact:true}).click();await expect(cards.first()).toBeVisible();checks.tabs=true;
  const roleName=await cards.first().getByTestId('agent-card-detail-link').innerText();
  await cards.first().getByTestId('agent-card-task-examples').getByRole('button').first().click();await expect(page).toHaveURL(/\/chat\?.*prefill=/);
  const prompt=new URL(page.url()).searchParams.get('prefill');await expect(page.locator('textarea').first()).toHaveValue(prompt);
  await expect(page.getByTestId('session-briefing-loading')).toHaveCount(0,{timeout:15000});
  await expect(page.getByTestId('chat-task-workbench-capability-picker')).toHaveAttribute('data-auto-match','false');
  await expect(page.getByTestId('chat-task-workbench-capability-picker-name')).toHaveText(roleName);
  await page.screenshot({path:path.join(out,'prefilled-draft-mobile.png'),fullPage:true});checks.unsentPrefill=true;
  await context.close();return {passed:true,mode,checks,screenshots:6,blockedWrites,businessWritesPerformed:false};
 }finally{await browser.close();}
}
run().then(v=>process.stdout.write(JSON.stringify(v)+'\n')).catch(()=>{process.stdout.write(JSON.stringify({passed:false,mode:arg('--mode'),code:'DIRECTORY_BROWSER_FAILED'})+'\n');process.exitCode=1});
