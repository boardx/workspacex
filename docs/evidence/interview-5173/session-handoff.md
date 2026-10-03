# 会话交接

仅跟进 #5173/#5174/#5175/#5177/#5178 对应 PR；不要恢复此前已完成的九 PR 任务。

报告链路新增 POST canonical report/generate-stream NDJSON；事件契约统一在 packages/contracts/src/interview-markdown.ts。前端单请求会话跨步骤延续，按登录 token、访谈与源修订隔离；终态不重放旧快照，读取和生成结果不允许版本回退。专家确认直接生成并确认问题，目标 runs 只在已确认问题且尚无 execution 时自动 start。

下一步按最终 head 的 checks 和独立 review 核对，不从旧 SHA 的静态记录推断完成。所有 PR 使用依赖分支限制单项 diff；合并上游后重新核对 base 和 CI。保留原始报告候选的失败版本，不把 streaming preview 当作已保存/已通过质量门的结论。

自有测试栈由测试 worker 负责释放，已完成的两轮容器/卷均查空；最后一轮浏览器栈结束后仍需精确查空。未创建新 worktree、监控循环或调用外部模型。主 checkout 的其他会话文件不属于本轮改动，不清理它们。
