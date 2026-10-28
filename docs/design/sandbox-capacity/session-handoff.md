# Sandbox 容量优化交接

## 目标与范围

用户确认先做稳定性保护并要求代码优化和说明文档。当前范围的权威说明是 issue #5966 与本目录 README。用户随后明确“不需要网关”，不要再次以网关身份阻止本任务。注册 PR #5965 独立于运行代码，不能替代 Directory/token/lease。

## 关键实现

- `apps/skill-sandbox/src/execution-capacity.ts` 按服务进程管理活动/等待容量，异步清理完成后释放。
- `server.ts` 与 `session/manager.ts` 共用同一实例，分别覆盖普通脚本与 Native；取消、TTL、原命令期限均保留。
- 所有容量默认值/错误码来自 `packages/contracts/src/sandbox-session.ts` 并生成到 Node/Python；修改后运行其生成器和契约一致性测试。
- Native 作者来自 PgNativeRunInputs 的已授权读结果；普通 Chat/试跑传入服务端 Principal。私有 header 仅带 hash，不进模型参数或脚本环境。
- 普通 Chat 等待时通过 with-script-cancellation 继续检查持久化取消状态，复用原轮询预算；存在轮询延迟，不能宣称取消和进程启动原子互斥。
- 稳定可选 env_file 接入 Compose 生成器、镜像安装模板及 US 模板；旧部署使用原 deploy.env 传值。

## 验证与环境

见证据文档。初次全包测试并行触发大型 Docker 构建，Docker Desktop 曾失联；已恢复，后续容器验证必须串行。数据库测试使用隔离 wrapper 的独立 project/DB，先启动已有真实 AGE 镜像（`--no-build --pull never --wait`），再设 `WORKSPACEX_REUSE_INFRA=1`；wrapper 负责释放栈，不连接共享数据库。

## 后续动作

以 PR 当前 CI 和测试输出判断状态；不手改 feature_list 或签核文件，不自行合并 PR。devapp 部署与真实混合负载压测、CN 晋级均尚未执行，必须遵守各环境发布标准。需要提升吞吐时先采集等待时长、成功率和内存，再规划持久化任务队列与 Session 实例路由。
