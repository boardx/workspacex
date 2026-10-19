# #5837 — 控制回调连接恢复

## 线上证据与归因边界

用户报告研究PDF失败，且明确指出用户访谈使用内置Skill成功。两者源码共用ReportFileActions/ReportFileService/ChatReportFileRuntime与pdf-create，只在canonical source读取上有差别；本修复不创建新PDF生成实现。

2026-10-19新PDF任务abffd67c-9190-4549-ae34-704d4652ac85，原生run e0b7e5d6-09af-4613-9c38-b4f9bee05164。actor只读GET显示GENERATION_FAILED/RUN_INTERRUPTED；PDF生成和9页渲染成功，未wx_artifact_publish。根协调精确只读探针39260774949/39261002576匹配同run：remoteRun06cdca3d-1b45-49ce-800b-efd3acb28376，远端error类别ConnectError，终态时间13:16:55.199192Z；当前deep-agent容器13:09:45Z启动、restartCount0。不是已证runtime重启或旧INVALID_FILE。

部署job118076288123公开receipt：API service restart13:16:49.777Z，service active13:16:50.007Z，首次trustworthy13:17:05.973Z。约16.2秒窗口与远端错误重叠。run_control同步/异步边界poll在两次连接建立失败后只间隔0.1s便裸抛ConnectError；这是一条能复现同类失败的路径。缺少线上异常栈/目标URI，因此不能100%认定本次错误一定来自此callback。

## 实现范围

只重试已有run控制回调的连接建立失败（ConnectError/ConnectTimeout），同一org/ACK IDs，不重复模型、工具或发布。单源20秒连接恢复窗口对照16.2秒实证间隔；每次请求timeout clamp到min(5s,剩余)，固定0.5s间隔。持续失败仍fail-closed。ReadTimeout、WriteError、HTTP拒绝/服务器响应和非法body不自动重试；pause/cancel响应维持checkpoint语义。

异步生产路径另外通过asyncio.timeout限制整个poll为20秒，任务取消不被吞掉。同步路径界定连接失败与重试等待窗口；连接成功后的响应继续遵守httpx各阶段timeout，不宣称同步慢响应绝对wall20秒。同步/异步均拒绝deadline后到达的成功响应，不允许迟到200继续派发模型/工具。未改全run预算、权限/租约判断、发布或全文校验门。

## 本地证据

- 旧实现双ConnectError同步/异步RED2：在第三次恢复前抛异常。
- 新实现受控双拒绝后恢复，原ACK IDs完整相同。
- 迟到200同步/异步反证额外RED2→GREEN，过期成功响应抛ReadTimeout、不继续执行。
- 永久ConnectError/ConnectTimeout同步/异步虚拟时钟：恢复窗口20秒，单次timeout不超过剩余窗口；持续异常仍抛出，不冒充成功。
- 异步等待期间任务cancel立即终止，无后续请求。
- 实际LangGraph+InMemorySaver的同步/异步×正常/pause/cancel六条链路：断连后继续/暂停/取消，已完成工具恰好一次，checkpoint恢复不重放工具。
- 非法body不重试；原ReadTimeout/WriteError、401/403/503拒绝反证保留。
- `apps/deep-agent-service/.venv/bin/python -m pytest apps/deep-agent-service/tests/test_run_control.py apps/deep-agent-service/tests/test_run_control_reconnect.py apps/deep-agent-service/tests/test_harness.py apps/deep-agent-service/tests/test_self_hosted_runtime.py apps/deep-agent-service/tests/golden/test_tc7_interjection_replan.py -q`：146通过（两条既有依赖弃用告警）。
- 同会话main65bea baseline init退出0；diff-check退出0。

没有真实模型调用，没有线上旧任务/附件修改，没有部署。本证据不代表线上PDF下载已通过，也不保证超过20秒停机仍能成功。
