# Team / Enterprise 设计在建交接

唯一worktree /Users/shenyangjun/boardx/workspacex/.worktrees/cn-us-pricing-ui，当前worker/cn-us-team-billing-design。最新base develop685fcd33（fetch后观察），原476草案重放e21d7d66d，当前仅文档修订待commit/独立复审。不要新建第二个worktree/切共享checkout，不动其他会话6097代码。

design-coherence-review.md记录首次审查缺陷及修订；重点复核quote用途有效期、Team可售前T06、首次付款期间容量并发、T11永久充值与许可分离、Enterprise专属整数手动授予/原因及固定升级原因（符合已采用UI）。先前“所有列表行可手动加额度”观察错误；真实组件team.enterprise才有按钮，最新材料已纠正。后续回P5重基时也须修其52e2旧交接里的该句，避免静态痕迹被当产品裁决。

所有新执行口径仍待人确认，唯一签核状态在design-signoff.md为pending。个人恢复修订已经单独获人采纳，不覆盖Team；不要重复索要个人修复或本次正常develop集成授权。当前设计不写API代码/SQL，不跑未存在的验证、不假passing。

CI跟进：年付PR6100 head5310、base最初d886，develop后来实际前进685；源分支已按classifyChecks判定READY，独立ACCEPT后正常入队；最新队列候选98de549bbe77c459362ed42fc9455c5589dd1f1e为AWAITING_CHECKS，尚未实际merge。继续读实时状态，不凭此记录断言已合；禁止admin bypass。P3实际merge后P4从旧b766剥离；P4实际merge后P5从旧b4dd剥离。远端P4=63bd、P5=52e2，P5还需准确追加自己的SQL到恢复fixture reviewedSuffix及最终整feature检查/PR。

本工作树当前无自有Next/Chromium/Docker栈；P5测试栈均已清理。用户只授权本次定价正常集成develop，没有生产部署/reset/epoch激活。共享stash和其他会话资源不动。

正式API第③件尚未完成：api.md只是草案。先在同一draft PR补齐packages/contracts schema、原型消费和反例，再正式复核及一次人工签核；当前不请求材料未完备的确认。
