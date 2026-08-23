# 补充证据：真 Postgres 下的 pytest 全量跑通

评分会话内追加采集（2026-08-23，与主证据包同一 SHA 6f84375c）：
主证据包（deepagent-evidence-20260823T100944Z）采集时服务未设 DEEP_AGENT_CHECKPOINT_DB
（langgraph dev 平台内存态），因此 D4 Postgres 路径在那次采集里完全没跑到。

本补充：本地起一个临时 postgres:16.14-alpine3.22 容器（本机已有镜像，未新拉），
设 DEEP_AGENT_TEST_POSTGRES_URL / GUIDED_RESEARCH_TEST_POSTGRES_URL 指向它，
跑 apps/deep-agent-service 全量 pytest（不是新写的凑数脚本——三条测试早已在
main 的 tests/test_deep_agent_postgres_recovery.py 和
tests/test_guided_research_postgres_recovery.py 里，此前从未在有 Postgres 的
环境里真正执行过，只会因为 env 缺失 pytest.fail）。

结果：42 passed（此前 3 个因缺 Postgres 而 fail）。
- test_interrupt_survives_process_restart_and_resumes：HITL 中断态跨进程存活于
  Postgres，进程 B 用全新构建的图 approve 恢复，工具真实执行恰好一次。
- test_time_travel_rollback_and_fork：get_state_history 枚举历史 checkpoint，
  按 checkpoint_id 读回历史状态，从历史节点 invoke 产生真分支执行
  （checkpoint-rows.txt 里 thread da-pg-time-travel 下能看到同一个
  parent_checkpoint_id 分出两条子链，即分支的直接数据库证据）。
- test_same_thread_resumes_after_process_restart（guided research）：同线程
  跨进程重启续跑。

checkpoint-rows.txt 是从这个临时容器导出的 checkpoints 表快照——满足 rubric
物理证据闭环第 2 类「Checkpointer 数据库快照」。容器测试结束后已销毁，不是
常驻基础设施，不代表生产环境默认开启 Postgres（生产/自托管仍需显式设
DEEP_AGENT_CHECKPOINT_DB 才启用，见 harness.py build_checkpointer()）。
