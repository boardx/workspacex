# 本地发布验证证据（2026-09-11）

此记录是本地 Linux/arm64 Docker 验证，不能替代最终整合提交、Linux/amd64 ECS、镜像仓库发布或云端业务验收。

## 已执行

- cloud-deploy：49 项测试通过；typecheck/lint 通过。
- 两档真实 Docker Compose 配置解析通过；并实际启动禁网 Node fixture 确认 raw 环境密码中的 `$` 和 `${...}` 均保持字面含义；无效 pull policy 反例被拒绝。
- 五个真实 Docker Node fixture 的运行镜像/容器状态校验通过；停止容器后校验拒绝；全部 fixture 已清理。
- API 镜像源码修复提交 `2fd7b465dbaf9a6885807d2c427514229a0d2146` 构建通过。检查实际镜像：`sha256:62af3a526a9d3e508dca005cb5a3f52655d53e13dc9ef299856dcc8eb3dd2e8c`，平台 `linux/arm64`，OCI revision label 与上述提交一致。
- API 镜像实际运行 `verify-api-runtime.mjs`：非 root 用户、禁网、只读根文件系统、512MiB 内存。真实 CSV 转 Markdown，以及独立 pdf-lib 生成 PDF 再由 Anydoc 提取文字均通过。

## 发现并修复

最初 API 构建缺少 `apps/skill-sandbox` workspace 源依赖，并混入未复制的测试 harness，容器内 tsc 确实失败。后续补齐运行依赖并为镜像使用只覆盖应用源代码的 release tsconfig；仓库常规完整 typecheck 保留。可选 canvas native 安装失败，已通过上述真实 CSV/PDF 路径确认这两条能力不依赖它；不能据此推断所有图形功能通过。

首次 Web 与 API 并行编译时，主机 swap 达 19,056MiB，编译明显抖动。已终止本任务 Web 构建，改为有界 Node 堆和错峰编译；没有修改用户 Docker 配置或停止其他容器。依赖层加入 BuildKit pnpm 缓存，并将 revision label 移到昂贵构建层之后。

## 仍待验证

Web 修复后镜像构建和实际页面响应正在验证；Agent 官方生产镜像依赖许可选择；Sandbox 需针对最终源码 SHA 重建。最终整合提交必须重新构建目标 ECS 架构镜像、推送得到仓库 digest、预热并验运行体。完整服务栈、实际 OSS、生产数据库及 300 秒 provision 业务验收尚未由本记录证明。
