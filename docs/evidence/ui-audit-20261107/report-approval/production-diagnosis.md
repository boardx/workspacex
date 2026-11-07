中国站只读诊断（2026-11-07，真实浏览器 ECS Workbench 操作，无生产写入）：

- 本次审计的7个报告导出 job 对应 canonical run 均 failed，error_code=MODEL_CALL_FAILED、failure_reason=tool_call_unresolved。其中一条job仍running，不能将其计为生成中成功。
- 研究PDF run 71150844-ce6e-42ae-b727-d0a6240997e5 的事件：3次read_file成功、write_file成功、首次execute start后仅合成的失败结束事件。合成文本不是实际sandbox错误。
- 通过远端checkpoint只读事务按parent_run_id/model_request_accounting.run_id精确关联：4个研究父run的remote run均status=error、errorClass=ToolAuthorityError。访谈3个父run此查询未返回记录，不能外推其远端细节。
- 4个研究run的tool_permission_grants检查：execute对应本run或forever grant均false。尚需确认permission_request_id及实际authority reason。
- Docker日志按时间有4条model-call失败，现有structuredErrorLog丢失run关联字段；未把通用日志或旧ConnectError当作当前根因。

未打印凭证、完整request或报告正文。未放宽authority、Skill provenance、execute、publish或实际文件验收。下一步打通既有审批暂停/恢复路径并验证真实文件产出；目前未声称导出修复完成。
