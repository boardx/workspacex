/** Read-only dialog checks use normal UI; no API seed or simulated service rejection. */
import { ProbeFailure } from './devapp-aidt-auth-readonly.mjs';
import { beginV2Case, v2CaseHash } from './devapp-aidt-v2-cases.mjs';
const fail=code=>{throw new ProbeFailure(code);};
// These are real creatable kinds. Labels are product accessibile names, not alternate test-only controls.
export const V2_CREATE_CANCEL_KINDS=Object.freeze([
  {kind:'problem',stage:1,hostTestId:'aidt-problem-directory',dialog:'新建问题',field:'问题名称'},
  {kind:'interview',stage:2,hostRegion:'访谈工作区',dialog:'新建访谈',field:'受访者姓名或化名'},
  {kind:'observation',stage:2,hostRegion:'访谈工作区',dialog:'新建观察',field:'观察对象或情境名称',choose:'观察'},
  {kind:'surprise',stage:3,hostTestId:'aidt-definition-directory',dialog:'新建意外发现',field:'卡片名称',choose:'新建意外发现',alternative:{choose:'新建补充发现',dialog:'新建补充发现'}},
  {kind:'persona',stage:3,hostTestId:'aidt-definition-directory',dialog:'新建画像',field:'卡片名称',choose:'新建画像'},
  {kind:'hmw',stage:3,hostTestId:'aidt-definition-directory',dialog:'新建HMW',field:'卡片名称',choose:'新建 HMW'},
  {kind:'brainstorm',stage:4,hostRegion:'头脑风暴',dialog:'新建头脑风暴',field:'场次名称'},
  {kind:'idea',stage:4,hostRegion:'点子列表',dialog:'新建点子',field:'点子名称'},
  {kind:'prototype',stage:5,hostRegion:'原型列表',dialog:'新建原型',field:'原型名称'},
  {kind:'test',stage:6,hostTestId:'aidt-test-group-directory',dialog:'新建测试卡片',field:'测试名称'},
]);
/** One actual variant; caller aggregates all ten before CRUD-02 can pass. */
export async function inspectV2CreateCancellation({ui,config,ctx}) {
  const facts=[];await ctx.action(()=>ui.go(config.stage));const before=await ui.stage(config.stage);
  const host=config.hostRegion?ui.page.getByRole('region',{name:config.hostRegion,exact:true}):ui.page.getByTestId(config.hostTestId);
  await ui.expect(host).toBeVisible();const trigger=host.getByTestId('aidt-new-entity-card');await ui.expect(trigger).toHaveCount(1);if(!await trigger.isEnabled())return {kind:config.kind,status:'BLOCKED',code:'V2_CREATE_KIND_UPSTREAM_NOT_READY'};
  for(const mode of ['cancel','escape','close','leave']){
    await ctx.action(()=>ui.click(trigger));
    let dialogName=config.dialog;
    if(config.choose){let choice=ui.page.getByRole(config.stage===2?'radio':'button',{name:config.choose,exact:true});
      if(await choice.count()===0&&config.alternative){choice=ui.page.getByRole('button',{name:config.alternative.choose,exact:true});dialogName=config.alternative.dialog;}
      if(await choice.count()!==1||!await choice.isEnabled()){await ctx.action(()=>ui.page.keyboard.press('Escape'));await ui.unchanged(config.stage,before);return {kind:config.kind,status:'BLOCKED',code:'V2_CREATE_KIND_LEGAL_SOURCE_UNAVAILABLE'};}
      await ui.expect(choice).toBeVisible();await ctx.action(()=>config.stage===2?choice.check():choice.click());}
    const dialog=ui.page.getByRole('dialog',{name:dialogName,exact:true});await ui.expect(dialog).toBeVisible();
    await ctx.action(()=>ui.fill(config.field,'仅本轮合成取消检查，不应保存',dialog));
    if(mode==='cancel')await ctx.action(()=>ui.click(ui.btn('取消',dialog)));
    if(mode==='escape')await ctx.action(()=>ui.page.keyboard.press('Escape'));
    if(mode==='close'){
      const close=dialog.getByRole('button',{name:/^(Close|关闭)$/});
      if(await close.count()===0){facts.push({mode,supported:false,reason:'产品此弹窗不提供X关闭控件'});await ctx.action(()=>ui.click(ui.btn('取消',dialog)));}
      else{await ui.expect(close).toHaveCount(1);await ctx.action(()=>ui.click(close));facts.push({mode,supported:true});}
    }
    if(mode==='leave')await ctx.action(()=>ui.go(config.stage===6?5:6));
    await ui.expect(dialog).not.toBeVisible();await ui.unchanged(config.stage,before);
    if(mode!=='close')facts.push({mode,supported:true});
    if(mode==='cancel'||mode==='escape')await ui.expect(trigger).toBeFocused();
    await ctx.action(()=>ui.go(config.stage));await ctx.action(()=>ui.page.reload({waitUntil:'domcontentloaded'}));await ui.expect(host).toBeVisible();await ui.unchanged(config.stage,before);
  }
  return {kind:config.kind,status:'EXECUTED',stage:config.stage,revision:before?.revision??0,contentSha256:v2CaseHash(before?.content??null),facts,persistedCreation:false};
}
export async function runV2CreateCancellationCase({ui,ledger,runtimeScope,plan,capture}) {
  const ctx=await beginV2Case({caseId:'CRUD-02',stageId:6,ui,ledger,runtimeScope,plan,capture});
  try{
    const variants=[];for(const config of V2_CREATE_CANCEL_KINDS)variants.push(await inspectV2CreateCancellation({ui,config,ctx}));
    const blocked=variants.filter(row=>row.status==='BLOCKED');
    if(blocked.length){await ui.go(6);return {...await ctx.finish({refresh:async()=>{await ui.page.reload({waitUntil:'domcontentloaded'});await ui.expect(ui.page.getByTestId('aidt-project-workspace')).toBeVisible();},partialCode:'V2_CREATE_CANCEL_VARIANTS_NOT_EXECUTABLE'}),variants};}
    ctx.record('all-supported-create-kinds',variants.length===10,{kinds:variants.map(row=>row.kind)});
    for(const [id,mode]of [['cancel-button','cancel'],['escape-cancel','escape'],['directory-leave-cancel','leave']])ctx.record(id,variants.every(row=>row.facts.some(fact=>fact.mode===mode&&fact.supported)),variants);
    ctx.record('supported-close-control',variants.every(row=>row.facts.some(fact=>fact.mode==='close'&&typeof fact.supported==='boolean')),variants.map(row=>({kind:row.kind,close:row.facts.find(f=>f.mode==='close')})));
    ctx.record('no-persisted-creation',variants.every(row=>row.persistedCreation===false),variants);
    await ui.go(6);return {...await ctx.finish({refresh:async()=>{await ui.page.reload({waitUntil:'domcontentloaded'});await ui.expect(ui.page.getByTestId('aidt-project-workspace')).toBeVisible();}}),variants};
  }catch(error){return ctx.failed(error);}
}
