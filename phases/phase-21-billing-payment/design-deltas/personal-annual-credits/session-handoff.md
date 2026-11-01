# 年付月度额度集成交接

唯一worktree cn-us-pricing-ui，当前worker/cn-us-annual-credits；不创建第二个worktree/不切共享checkout。实际base develop d886e243（PR6098已合）。四提交从旧base48重放到85fee5c6f，和远端旧b766完整树相同，final-base-range-diff/tree-equality有证据。当前准备仅docs的新提交与exactSHA复核后推送，远端旧头仍b766，更新时仅对自有分支精确lease。

同树provider60、PG45、types/lint7、scope2验证有效，未重复冒称新SHA重新跑过；最终hook及CI单独核对。创建单issue6091 PR，Closes #6091、target develop；修红到绿，按用户本次定价既有授权正常入队，无admin bypass。只在实际mergedAt/mergeCommit成立后处理下一项。

P4远端63bd75abd仍从原父b766a58ccbf9b14dcccaf6e1a47c086f3b5ea2db剥离到本项将来的实际merge develop，不要错用新P3头作旧父。P5远端52e2f95bc仍从原父b4ddf725f79b2607a186ff82782ed10b520272a8剥离；其恢复增量已人工签核、独立ACCEPT，contracts1254/provider166/UI107/PGHTTP39/旧PG42/parity12/browser17均验，另类型11/受影响25/push25通过，完整证据在P5。

Team设计草案476566c4d/issue6099在独立分支待两点初审修订和人工签核；个人修复签核不覆盖Team。此处不修改feature_list、不假passing，不执行生产reset/部署/激活。当前无本任务自有Next/Chromium/Docker服务，所有fixture栈清理完成；共享stash/其他会话资源不动。
