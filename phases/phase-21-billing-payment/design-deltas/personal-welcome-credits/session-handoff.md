# 新用户赠送交接

唯一worktree `/Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui`，当前worker/cn-us-welcome-credits；不新建树、不切共享checkout。source2706a5be56406c6eb864721d00f1a136f31b9289已获独立静态ACCEPT，actual develop base98de549bbe77c459362ed42fc9455c5589dd1f1e。P3 PR6100真实merge、6091已关闭。P4旧远端63bd从旧父b766剥离，3提交range-diff=、45路径源码等价。最终文档提交后复审SHA，强推只对本分支、lease必须精确旧63bd75abd29109a6ca7750060dd9687c2fd864f4；正常prepush，不bypass。

已刷新新基线测试：Node22.23.2普通init快速路径、provider61、真实PG/注册HTTP58（6files）、迁移scope2全部通过，peak7/cleanup1s/总41s。邮件worker关闭，仅outbox。证据actual-base-*。旧137失败+串行7+push25记录保留，根因未定；不伪称首次全绿。未跑本P4完整full init；P5本机22.14 ESM加载环境问题已用已装22.23.2目标证明修复，后续CLI显式PATH=/Users/shenyangjun/.nvm/versions/node/v22.23.2/bin:$PATH。

下一步：最终精确SHA独立复核/正常push后，单PR目标develop、Closes #6092；读取canonical classifyChecks及真实checks，修红与review，按既有授权正常入队，跟进actual merge。不能用分支存在代替集成，也不手动改feature_list passing。

本项实际merge后：P5远端66c0673887e203ee5dd056c47a6ce5234ade0eb4仍从**原父b4ddf725f79b2607a186ff82782ed10b520272a8**剥离到actual develop，不用P4的新头作为旧父。其reviewedSuffix已带继承P3/P4三项+P5四项，重基冲突保留实际base然后追加P5，不回退。P5已签个人nilbinding修订、StripefragmentP1及QR P2闭环，最终全范围审查/实际依赖完整基础验证/PR6093仍待。

新用户赠送资格只取账号创建事实和accounting generation，不从登录/读取/组织加入补发；默认epoch不激活。welcome读取组件是内部组件，公开读取沿用可信owner校验。生产全旧计费清理及epoch激活另做，未获本任务生产部署权限。用户已授权本次定价逐PR正常集成develop，不重问。

当前自有测试进程/Next/Chromium/compose均清理；共享stash和其他发布/邮件会话资源不动。Team独立Draft6101仍pending、正式schema第③件未完成，不把个人确认扩展过去。
