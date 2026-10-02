# 用户研究修复交接

## 当前已验证

#5057、#5068、#5081 实现及回归通过；代码独立ACCEPT绑定694d4f6c0。真实浏览器需求创建、失败任务重试保留来源、排除来源、章节原位编辑及新ID替换/删除/重排、计数无需刷新均有动态证据。证据在37aed898f提交；`git ls-tree HEAD`已核实acceptance.md及27-report-terminal.json非空。

## 本轮改动

唯一汇总PR https://github.com/boardx/workspacex/pull/5087，Closes #5057/#5068/#5081；Refs #5056。完整验收#5056不关闭，PR未合并。研究代码未降低source/evidence/quality门。

## 仍损坏或未验证

真实报告是有限草稿（2章+综合），completed=false/report=null；不是完整验收通过。IAB本次Word未取得文件；PDF原生打印后CDP超时，工具禁止控制Codex原生窗口，导出复验blocked。此前#5056旧代码有导出证据但不能替代本次。完整本地web/API套件有记录的83462a基线/环境失败；verify:quick默认并发load83后仅中断本会话wrapper，退出143。最新CI仍需动态classifyChecks判定。

全部本会话运行栈已释放（5b5185a5314085df58d1、ed2a9655de27fb0583b6、f836faf1da37aad8a8bc）；研究API/web及DB端口检查均关闭。临时venv symlink移除。主共享checkout旧验收未跟踪证据归其他共享工作，不reset、不删除。

## 下一步最佳动作

1. `gh pr view 5087 --json headRefOid,statusCheckRollup,reviews,isDraft`，确认最新SHA，调用`.harness/scripts/lib/pr-queue.ts`的`classifyChecks`；有红分诊修复，不把pending/skipped叫绿。
2. 对最终head进行独立证据审核；由主会话验收修复范围。
3. 要补导出复验，用新的隔离fullstack环境与IAB，走真实UI；若原生保存/打印控制仍受工具限制，保持blocked并交人类操作。不要用手工构造report、浏览器内部写状态或替代文件伪造动态导出。
4. 未获人类明确合并授权，不merge，不关闭#5056。原始服务日志与凭据不提交；如无需本checkout继续审核，用Codex archive_worktree回收唯一managed worktree。
