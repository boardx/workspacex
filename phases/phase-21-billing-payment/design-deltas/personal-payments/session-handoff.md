# 个人支付在建交接

唯一worktree `/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui`，当前worker/cn-us-personal-payments；不要新建第二个worktree或切换共享checkout。恢复增量源码bdddf4ff61863cd472b0540cf64595822eb45122与最终文档52e2f95bc447cc4471ccaabedb824ec56b6298ed均已独立ACCEPT并正常推送；正在补迁移范围验证及交接纠错，完整P5仍待前置实际集成后的最终复核。

用户已明确采用personal-order-outcomes-v1并授权回填/继续，签核已记录；原缺绑定P2已闭合。GET终态nil、POST原key恢复、正常待支付真绑定、客户端先GET且不重新支付、Draft真实expiry均有验证。contracts1254/provider166/UI107/PGHTTP39/旧PG42/local parity12、类型lint11及受影响25任务通过；完整browser17通过且nil到账恢复截图已目视。证据personal-payments/evidence/order-outcomes；首次红及fixture类型失败保留。商户是独立签名fixture，不是在线实付。当前无本任务自有Next/Chromium/Docker栈/编译器在跑，wrapper清理已结束。

下一步按实际队列集成：
1. 当前P5检查点精确复核后正常push（不含未完成整feature PR）。
2. 充值PR6098已在2026-11-01T21:24:25Z正常merge develop，commit d886e24310ae50e8f7c6a74bbceb87c052514025，6090已关闭；fetch后旧source48与当前develop源码树diff为空。P3远端b766a58cc从**48e04b39c668b15cd16bdba4e4f6967a9df5dd87**剥离到实际origin/develop；源码等价仍核对range-diff，复验/最终SHA独立review，单issue6091 PR正常集成。
3. P3实际merge后，P4远端63bd75abd从**b766a58ccbf9b14dcccaf6e1a47c086f3b5ea2db**剥离到实际develop；同样复核/单issue6092 PR。P4原实现重放为0cf4，补scope+证据5dc/63bd。
4. P4实际merge后，P5仍从原父**b4ddf725f79b2607a186ff82782ed10b520272a8**剥离，不能错用新P4头当旧父。当前已准确追加继承P3/P4及P5四项SQL到tests/fixtures/cn-application-recovery/migration-scope.ts，保留unknown/missing/duplicate拒绝；重基若冲突，保持实际前置列表加P5四项，不恢复旧列表。再跑最终基础init/检查、整#6093独立范围review和单issue PR，CI真绿后正常merge。

个人正式UI开关默认off、计费epoch未激活；不得执行生产reset/支付/部署。全旧订单/订阅/余额/流水/消费脏数据最终清空，外部旧续费/可支付单、旧应用及在途AI/usage replay先处理，实际事务epoch屏障和最终排他重置仍后续任务；不凭当前只读模式检查宣称可安全生产cutover。用户本次定价正常集成develop授权持续，不需重问；不使用admin bypass。

Team/Enterprise设计Draft PR #6101已发布，分支worker/cn-us-team-billing-design，head096892902；独立草案复审1944d13无新增P1/P2，原报价期限及T06问题已闭环。此前“所有列表行可加额度”观察错误：已采用pricing-enterprise-preview.tsx按钮实际受team.enterprise条件限制，仅Enterprise，整数1至1,000,000且必填原因；草案已按该事实修正。签核pending，api.md不代替packages/contracts可执行第③件，须补schema/原型消费反例及正式复核后再请求人确认，不能自动扩展个人签核。

保留共享stash，不pop/drop别人条目。我们的23e17f6e7ead2c0610953a7f195042310a46f102为旧UI运行时备份，不是最新源码；最新已在本分支commits。其他旧backup8ac/c2b/db67等已被后续commits覆盖，不要反向覆盖。progress.md保留历史，旧pending/旧SHA文字不是当前事实；使用GitHub mergedAt/mergeCommit/当前checks确认实际状态。

当前年付PR6100 source5310已正常入队，候选98de549检查进行中、未实际merge；不得把历史P3待开PR描述当实时事实。
