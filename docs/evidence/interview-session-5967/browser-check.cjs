const { chromium, expect: baseExpect } = require('../../../apps/web/node_modules/@playwright/test');
const expect = baseExpect.configure({timeout:30000});
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process');
const out=__dirname,base='http://localhost:35967';
const raw=fs.readFileSync('apps/web/e2e/digital-interview-research-quality.spec.ts','utf8');
const view=Function('return '+raw.slice(raw.indexOf('const view = ')+13,raw.indexOf('\n\nconst source')))();
const steps=['intake','analysis','experts','outline','runs','report'];
const texts={intake:'# 研究需求\n\n请研究采购中的实际困难。',analysis:'# 分析\n\n## 研究目标\n验证采购决策。',experts:'# 专家\n\n## [采购角色](#expert-purchase)\n\n专业角色：采购经理\n\n## [技术角色](#expert-tech)\n\n专业角色：技术负责人',outline:'# 问题\n\n## [采购角色](#expert-purchase)\n\n1. 最近一次采购发生什么？\n\n## [技术角色](#expert-tech)\n\n1. 谁复核安全风险？',runs:'# 模拟访谈摘要\n\n## [采购角色](#expert-purchase)\n\n### 问题一：最近一次采购发生什么？\n\n采购回答保留了完整记录。\n\n### 关键观点\n\n- [采购审批经过两级](#question-q1)\n\n## [技术角色](#expert-tech)\n\n### 问题一：谁复核安全风险？\n\n技术回答记录了安全评审。',report:'# 研究报告\n\n结论仍需真人证据复核。'};
function fixture(complete=true){return {interviewId:view.interviewId,revisionId:'revision-e2e',version:9,documents:steps.map(step=>({documentId:'doc-'+step,step,version:1,markdown:texts[step],contentHash:crypto.createHash('sha256').update(texts[step]).digest('hex'),evidenceMode:'simulated',references:[]})),states:steps.map(step=>({documentId:'doc-'+step,status:complete?'confirmed':'draft',failure:null})),execution:{status:'completed',tasks:[{expertId:'purchase',status:'completed',errorCode:null},{expertId:'tech',status:'completed',errorCode:null}]},review:null};}
(async()=>{
 const browser=await chromium.launch(); const page=await browser.newPage();
 const results={boundary:'Real local Next.js and Chromium; HTTP/session fixtures, no real DB/model/authentication',checks:[],postRequests:[]};
 let current=fixture(false),gate=null,fail=false;const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('wsx.sessionToken','e2e-token');localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'user-e2e',orgs:['org-e2e'],currentOrgId:'org-e2e',expiresAt:'2099-01-01T00:00:00.000Z'}));});
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  if(req.resourceType()==='document'||u.pathname.startsWith('/_next/')||u.pathname.startsWith('/itv/'))return route.continue();
  const json=(body,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(req.method()==='POST')results.postRequests.push(u.pathname);
  if(u.pathname.includes('/identity/me'))return json({org:{id:'org-e2e',name:'E2E',kind:'organization',team:null,modelPolicy:'any'},orgRole:'lead',teamId:null,projectRole:null,groupId:null,displayName:'UI fixture',avatarUrl:null});
  if(u.pathname.endsWith('/markdown')){if(gate)await gate;return fail?json({reasonCode:'DEPENDENCY_UNAVAILABLE'},503):json(current);}
  if(u.pathname.endsWith('/itv-quality-e2e')){if(gate)await gate;return json({...view,version:current.version,status:'running',currentStep:'runs'});}
  if(['xhr','fetch'].includes(req.resourceType()))return json({items:[]});return route.continue();
 });
 try {
  page.setDefaultNavigationTimeout(180000);
  await page.setViewportSize({width:1280,height:900});
  let release;gate=new Promise(r=>release=r);
  await page.goto(base+'/itv/'+view.interviewId+'/experts');
  await expect(page.getByText('已选择专家 0',{exact:true})).toHaveCount(0);
  release();gate=null;
  await expect(page.getByRole('heading',{name:'已选择专家 2',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(out,'experts-loaded.png'),fullPage:true});
  results.checks.push('Cold experts never render unknown selection as zero');
  gate=new Promise(r=>release=r);
  await page.evaluate(()=>{window.__emptyFrames=[];window.__watch=new MutationObserver(()=>{const s=document.body.innerText;if(s.includes('已选择专家 0')||s.includes('暂无已登记访谈任务。')||s.includes('已保存回答 0/0')||s.includes('正在恢复访谈草稿'))window.__emptyFrames.push(s.slice(0,500));});window.__watch.observe(document.body,{subtree:true,childList:true,characterData:true});});
  await page.getByTestId('itv-workbench-step-runs').click();
  await expect(page).toHaveURL(/\/runs$/);await expect(page.getByRole('button',{name:'采购角色 已完成',exact:true})).toBeVisible();
  await page.screenshot({path:path.join(out,'runs-during-delayed-refresh.png'),fullPage:true});
  await page.getByTestId('itv-workbench-step-experts').click();await expect(page).toHaveURL(/\/experts$/);
  await expect(page.getByRole('heading',{name:'已选择专家 2',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>window.__emptyFrames)).toEqual([]);
  release();gate=null;results.checks.push('Actual route transitions retain loaded identity, selected experts and completed answers while HTTP is delayed');
  current={...current,version:10,documents:current.documents.map(d=>d.step==='experts'?{...d,version:2,markdown:'# 专家\n\n## [远端采购角色](#expert-purchase)\n\n专业角色：采购经理'}:d)};
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('heading',{name:'已选择专家 1',exact:true})).toBeVisible();results.checks.push('Remote canonical change is applied on focus without navigation');
  await page.waitForLoadState('networkidle');
  fail=true;await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await expect(page.getByText('最新访谈数据同步失败，已显示的内容保留。')).toBeVisible();
  await expect(page.getByRole('heading',{name:'已选择专家 1',exact:true})).toBeVisible();
  fail=false;await page.getByRole('button',{name:'重试同步',exact:true}).click();
  await expect(page.getByText('最新访谈数据同步失败，已显示的内容保留。')).toHaveCount(0);results.checks.push('Offline refresh retains content and exposes retry');
  await page.getByTestId('itv-workbench-step-intake').click();
  const input=page.getByRole('textbox',{name:'研究需求 Markdown'});await expect(input).toHaveValue(texts.intake);await input.fill('我的本地未保存需求');
  current={...current,version:11,documents:current.documents.map(d=>d.step==='intake'?{...d,version:2,markdown:'另一端保存的需求'}:d)};
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByRole('button',{name:'放弃本地修改，采用最新版本'})).toBeVisible();await expect(input).toHaveValue('我的本地未保存需求');
  await page.getByRole('button',{name:'放弃本地修改，采用最新版本'}).click();await expect(input).toHaveValue('另一端保存的需求');
  await page.screenshot({path:path.join(out,'remote-draft-resolved.png'),fullPage:true});results.checks.push('Dirty draft survives remote edit until explicit resolution');
  expect(results.postRequests).toEqual([]);expect(errors).toEqual([]);results.checks.push('Navigation and revalidation issue no initialization, execution or model POST');
  await page.setViewportSize({width:375,height:812});await page.getByTestId('itv-workbench-step-experts').click();await expect(page.getByRole('heading',{name:'已选择专家 1',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:path.join(out,'mobile-experts.png'),fullPage:true});results.checks.push('375px experts route retains shared selection without horizontal overflow');
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({...results,errors},null,2));console.log(JSON.stringify(results,null,2));
 } catch(error){await page.screenshot({path:path.join(out,'browser-failure.png'),fullPage:true});throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
