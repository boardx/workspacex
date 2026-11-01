# 设计在建交接

当前任务为Issue #6099设计材料，唯一worktree `/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui`，当前worker/cn-us-team-billing-design，基线origin/develop6a1a。不要新建第二个worktree或切换共享checkout。

下一步：独立检查usecases/api/domain/coverage的一致性，修正具体问题，文档门禁通过后提交精确SHA、独立复核、正常创建材料PR。人工签核状态只在design-signoff.md为pending；不把已有UI确认扩展成新API确认。材料PR与运行时实现分开，后续用例验证命令仍未存在／执行。

继续跟进充值PR6098新候选d886e243；实际合入后P3从base48剥离onto实际develop，P3实际合入后P4从b766剥离；P4实际合入后P5从原b4dd剥离。远端保存P3 b766、P4 63bd、P5 1b674。P4首次prepush24/25 Web137，后相同类型检查串行7/7、正常完整推送25/25；相关完整证据在P4分支。不得把首轮当绿或凭swap推断确定根因。

P5正常UI增量独立ACCEPT不代表整个个人featureACCEPT：原缺绑定终态P2仍open，材料位于P5 `personal-order-outcomes-v1/design-signoff.md`，待人确认，不重复请求同一授权或代签。用户对本次定价正常集成develop的授权持续有效，无admin bypass，无生产部署/reset/epoch激活授权。已有独立reviewer `/root/pricing_ui_review` 可复用做只读一致性／exactSHA review。

当前没有本任务自有Docker/Next/Chromium服务；后续如启动必须独占并释放。共享stash与其他会话资源不动。阶段旧feature_list不手改、不假passing；设计候选只写implementation-slices.md。
