const {chromium,expect}=require('@playwright/test');
const fs=require('fs');
const api=process.env.SURVEY_API_URL,base=process.env.SURVEY_WEB_URL;
for(const url of [api,base])if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Use isolated local services');
(async()=>{
 const r=await fetch(api+'/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'dev-mode-consultant@workspacex.test',password:'DevMode-Consultant-Preset-2026!'})});
 if(!r.ok)throw Error('login '+r.status);const s=await r.json();const browser=await chromium.launch();
 try{
 const context=await browser.newContext({viewport:{width:1440,height:1050}});await context.addInitScript(s=>{localStorage.setItem('wsx.sessionToken',s.sessionToken);localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:s.userId,orgs:s.orgs,currentOrgId:s.orgs[0],expiresAt:s.expiresAt}));},s);
 const page=await context.newPage();page.setDefaultTimeout(60000);page.on('dialog',d=>d.accept());
 await page.goto(base+'/studio/survey');await page.getByRole('button',{name:'从模板创建',exact:true}).click();
 let region=page.getByRole('region',{name:'内置模板'});await expect(region.getByRole('article')).toHaveCount(6);
 const out=process.env.SURVEY_EVIDENCE_DIR||'/tmp/survey-builtins-evidence';fs.mkdirSync(out,{recursive:true});await page.screenshot({path:out+'/question-builtins.png',fullPage:true});
 const card=region.getByRole('article').filter({has:page.getByRole('heading',{name:'组织画像',exact:true})});await card.getByRole('link',{name:'查看并编辑'}).click();
 await expect(page.getByLabel('模板名称',{exact:true})).toHaveValue('组织画像');await expect(page.getByText('有未保存修改',{exact:true})).toHaveCount(0);
 await page.getByLabel('模板名称',{exact:true}).fill('组织画像个人副本');await page.getByRole('button',{name:'保存为我的模板',exact:true}).click();await page.waitForURL(/question-templates\/[a-f0-9-]+$/);await page.reload();await expect(page.getByLabel('模板名称',{exact:true})).toHaveValue('组织画像个人副本');
 await page.getByRole('button',{name:'返回模板列表',exact:true}).click();region=page.getByRole('region',{name:'内置模板'});await expect(region.getByRole('heading',{name:'组织画像',exact:true})).toBeVisible();
 await region.getByRole('article').filter({has:page.getByRole('heading',{name:'组织画像',exact:true})}).getByRole('button',{name:'使用并创建问卷'}).click();await page.waitForURL(/survey\/[a-f0-9-]+/);
 await page.getByRole('button',{name:'3. 发布回收',exact:true}).click();await page.getByRole('button',{name:'发布问卷',exact:true}).click();const url=await page.getByLabel('答题链接',{exact:true}).inputValue();
 const anon=await browser.newContext();const answer=await anon.newPage();await answer.goto(url);for(const value of ['企业高管','专业服务','50人以下'])await answer.getByLabel(value,{exact:true}).check();await answer.getByRole('button',{name:'提交答卷',exact:true}).click();await answer.getByText('提交成功，感谢您的参与。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByRole('button',{name:'5. 分析报告',exact:true}).click();await page.getByRole('button',{name:'生成报告',exact:true}).click();const doc=page.getByTestId('survey-report-document');await doc.waitFor();const text=await doc.innerText();if(/编辑指引|模拟|62份|待分析问题/.test(text))throw Error('non-report material leaked');await expect(doc).toContainText('企业高管');await page.screenshot({path:out+'/builtin-real-report.png',fullPage:true});
 await page.getByTestId('survey-section-nav').getByRole('link',{name:'报告模板',exact:true}).click();await expect(page.getByRole('region',{name:'内置模板'}).getByRole('article')).toHaveCount(4);await page.screenshot({path:out+'/report-builtins.png',fullPage:true});
 console.log('PASS: original six question and four report presets visible; builtin edit/save personal copy/reload/source isolation; real survey publish/anonymous response/report with no simulated data or editor instructions.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
