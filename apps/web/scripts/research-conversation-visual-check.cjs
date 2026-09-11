// Browser checks with explicit API fixtures; model behavior is verified by API tests.
const { chromium, expect: baseExpect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path');
const expect = baseExpect.configure({ timeout: 60000 });
async function main() {
 const output = path.resolve('../../docs/evidence/research-dialogue-3408'); fs.mkdirSync(output, {recursive:true});
 const browser = await chromium.launch({channel:'chrome',headless:true});
 try {
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  await context.addInitScript(() => {
   localStorage.setItem('wsx.sessionToken','research-browser-fixture');
   localStorage.setItem('wsx.session',JSON.stringify({version:1,userId:'studio-owner',orgs:['studio-org'],currentOrgId:'studio-org',expiresAt:'2099-01-01T00:00:00.000Z'}));
  });
  const state={sessionId:'conversation-check',version:1,revision:1,currentNode:'brief',availableNodes:['brief'],brief:{topic:'欧洲储能市场',goal:'比较市场进入机会',timeRange:'未来三年',region:'欧洲',focus:'政策与并网'},directions:[],outline:[],tasks:[],sources:[],report:null,completed:false,busy:false,leaseUntil:null,errorCode:null,generatedNodes:[],messages:[],proposal:null,modelCalls:[]};
  const commands=[];
  await context.route('http://localhost:3200/**',async route=>{
   const request=route.request(),url=new URL(request.url()),respond=value=>route.fulfill({status:200,json:value});
   if(url.pathname==='/identity/me') return respond({org:{id:'studio-org',name:'研究验证组织',kind:'enterprise',team:null,avatarUrl:null},orgRole:'lead',projectRole:null,teamId:null,groupId:null,displayName:'研究员',avatarUrl:null});
   if(url.pathname.endsWith('/runtime/commands')) {
    const command=request.postDataJSON(); commands.push(command);
    if(command.expectedVersion!==state.version) throw Error('Unexpected version');
    state.version++;
    if(command.action==='message') {
     const value={...command.draft.value,region:commands.length===1?'德国':'德国、法国'};
     state.messages.push({id:`u${state.version}`,role:'user',node:'brief',text:command.message,createdAt:new Date().toISOString()},{id:`a${state.version}`,role:'assistant',node:'brief',text:`已将研究区域调整为${value.region}，其他范围保留。请查看右侧草稿。`,createdAt:new Date().toISOString()});
     state.proposal={id:`p${state.version}`,version:state.version,action:'save',draft:{node:'brief',value}};
    } else if(command.action==='apply') {
     if(command.proposalId!==state.proposal.id) throw Error('Wrong proposal');
     state.brief=state.proposal.draft.value; state.proposal=null; state.generatedNodes=['brief'];
    } else if(command.action==='confirm') {
     state.currentNode='directions';state.availableNodes=['brief','directions'];state.generatedNodes.push('directions');
     state.directions=[{id:'d1',title:'政策与并网准入',description:'比较德国与法国的储能准入规则及进入路径',enabled:true,order:0}];
    } else throw Error(`Unexpected action ${command.action}`);
    return respond(state);
   }
   if(url.pathname.endsWith('/runtime')) return respond(state);
   return respond({items:[],organizations:[]});
  });
  const page=await context.newPage();page.setDefaultTimeout(60000);
  await page.goto('http://localhost:3189/research?session=conversation-check',{timeout:300000});
  await expect(page.getByLabel('研究对话')).toBeVisible();
  await page.getByLabel('研究对话').fill('先聚焦德国市场，保留其他研究要求');await page.getByLabel('研究对话').press('Enter');
  await expect(page.getByRole('textbox',{name:'研究区域',exact:true})).toHaveValue('德国');
  if(state.brief.region!=='欧洲'||commands.length!==1) throw Error('Preview unexpectedly applied');
  await expect(page.getByRole('button',{name:'确认并继续',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'保存草稿',exact:true})).toBeDisabled();
  await page.screenshot({path:path.join(output,'conversation-draft-desktop.png'),fullPage:true});
  await page.reload();await expect(page.getByRole('textbox',{name:'研究区域',exact:true})).toHaveValue('德国');
  await page.getByLabel('研究对话').fill('再增加法国作为对照');await page.getByLabel('研究对话').press('Enter');
  await expect(page.getByRole('textbox',{name:'研究区域',exact:true})).toHaveValue('德国、法国');
  if(commands[1].draft.value.region!=='德国') throw Error('Follow-up lost pending draft');
  await page.setViewportSize({width:390,height:844});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:path.join(output,'conversation-draft-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'应用建议',exact:true}).click();
  await expect(page.getByRole('button',{name:'确认并继续',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'确认并继续',exact:true}).click();
  await expect(page.getByRole('heading',{name:'研究方向',exact:true})).toBeVisible();
  await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:path.join(output,'conversation-next-step.png'),fullPage:true});
  console.log('PASS: chat → right draft → reload → follow-up context → mobile → apply → next step. API fixtures, 4 expected commands.');
 } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
