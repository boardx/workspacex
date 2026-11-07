# #5837 — 原生PDF执行中断与进度误报

## 用户问题与线上只读事实

2026-10-19 21:14:22北京时间新任务 `abffd67c-9190-4549-ae34-704d4652ac85`，source `grs_ac3f846590224ec7ab5bd1320fa80d7e` v3；本次报告hash与#5832相同，但错误不同。

通过已有actor浏览器同源GET（token仅留浏览器，未输出）：

- `/api/report-files/abffd67c-9190-4549-ae34-704d4652ac85` 返回failed / GENERATION_FAILED。
- `/api/agent-runs/e0b7e5d6-09af-4613-9c38-b4f9bee05164` 返回failed / RUN_INTERRUPTED，安全恢复说明“执行服务报告任务未完成，请核对已产生的结果”。
- 同run execution-events：13:15:21Z生成PDF execute成功，13:15:31Z渲染9页成功；13:15:37Z读取page1.png工具成功但结果摘要null；13:16:23Z write_todos成功；13:19:04Z终态failed。未发生wx_artifact_publish。不能把未发布中间文件当作可下载产物。
- actor transcript读取403，遵守拒绝，没有尝试扩大权限。

该中文恢复说明同时覆盖remote_error和remote_timeout；没有远端ledger安全error类别前不得断言超时、模型不支持图片或部署重启。部署run39255458594/job118076288123与任务时间重叠，只是待核线索。根协调会话正在精确只读取证。

## 已修复的独立前端问题

一次已知running/queued任务GET发生网络TypeError或HTTP5xx，原catch显示红色生成/下载错误，与任务终态混淆。现在显示中性role=status进度暂不可读提示，保留原job identity，下一点击只GET同任务、不重新POST。真实failed、401/403等拒绝、文件下载或校验错误仍保留错误路径。既有150次轮询上限到达后同样是中性未完成提示，不声称后端失败。

## 验证

- `./init.sh` exit0。
- 初始定向RED：旧实现13通过/新增网络错误反证1失败；错误断言确实检测到旧红色alert。
- 轮询上限role反证RED：14通过/1失败。
- 最终 `pnpm --filter web exec vitest run tests/ui/report-file-actions.test.tsx tests/ui/research-report-file-source.test.tsx tests/report-files-rewrite.test.ts`：3文件/23通过。
- 覆盖网络/503后同job恢复并下载，确认failed后仍错误，403不被转中性提示，既有取消/卸载/StrictMode保护和研究wrapper首击回归。
- `pnpm --filter web typecheck` exit0；定向eslint exit0；`git diff --check` exit0。

此证据不代表本次远端执行中断已修复，不代表新原生PDF或线上下载已通过。没有新模型调用、无线上任务写入、无发布或部署。线上根因诊断待安全远端错误类别。
