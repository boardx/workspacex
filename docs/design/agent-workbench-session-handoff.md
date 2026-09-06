# 工作台升级继续执行记录

本任务仍在实施，未完成最终验收。范围与进度以 [升级计划](agent-workbench-upgrade-plan-2026-09-06.md)、[peer 边界](agent-workbench-peer-boundary-2026-09-07.md) 为准。

- 独立 worktree：`.worktrees/codex-agent-workbench`；分支 `codex/agent-workbench-upgrade`；issue #2867；唯一草稿 [PR #2890](https://github.com/boardx/workspacex/pull/2890)。不得重复建 PR。
- 远端实现快照 `2e968fcba`；首轮 CI 红项已定位，最新本地生产提交 `b0b776692`（反馈归属），核心流程测试迁移 `e7e16bcd8`。最新修复尚待推送复验；没有修改 feature passing 或人类签核。
- 本地验收具体 SHA 与通过/未通过边界见 [接线契约](agent-workbench-integration-contract-v1.md)。最新正常 pre-push 全部通过，日志 `/private/tmp/wsx-2867-push-final.log`。
- 浏览器日志 `/private/tmp/wsx-2867-restore-e2e11.log`；前一批工具截图已保存在 `/private/tmp/wsx-2867-browser-b1d46b1bd`。测试生成的原有基线截图已恢复。
- 真实模型尚未运行：自动审批明确拒绝向 DashScope 外发，已请求用户授权，尚未收到答复。不得绕过或间接启动。用户授权后才可使用根协调准备的 `/private/tmp/wsx-2867-real-model.py`；它只复用既有基础设施并清理自己的宿主进程。
- 真实 Skill 加载事实与子任务取消 adapter 由 peer 实现；本分支只提供 journal、统一控制与展示。缺 adapter 返回 unavailable，不宣称已停止。联合验收仍待 peer 代码与证据。
- 后续动作：处理 PR CI 与评审；获授权后跑真实模型；接入 peer 提供的事实/取消原语后联合验收。按用户要求每半小时更新同一 Mermaid，节点标真实 commit，不提前标绿。
- 本会话未新建 Docker 栈。共享 `workspacex-kernel` 不属于本会话，必须保留；原始 checkout 的已有修改未触碰。当前 worktree 用于正在进行的 CI 修复与联合验收，不能移除。

- 04:20 后继续：主分支合入 `69d3f574a`，215 项完整迁移强制重放通过（`/private/tmp/wsx-2867-migration-replay-main.log`）；录音修复 `59425199f`、反馈修复 `b0b776692` 已提交。根正在运行回环 core-loop，独立数据库 `wsx_workbench_2867_core_1`，API 32169 / Web 47169，日志 `/private/tmp/wsx-2867-core-loop-local.log`；结束后核实结果及进程释放。

- 04:40 更新：核心完整依赖链在 `fa444df27` 测试 + `b0b776692` 生产构建下 14/14 通过（`/private/tmp/wsx-2867-core-loop-local3.log`）。四组全栈首轮 9/12 通过，反馈管理列表403导致1失败2未运行；`37687f5e2` 已修为线程可见roster，5反馈+2timeline+tsc/lint通过。当前重新构建运行四组全栈，日志 `/private/tmp/wsx-2867-fullstack-local2.log`，数据库 `wsx_workbench_2867_fullstack_2`，端口保持32169/47169。Mermaid `5270a0a0f`，下一次最迟05:08更新。

- 04:52 更新：`37687f5e2`全新生产构建后的四组全栈12/12通过，日志 `/private/tmp/wsx-2867-fullstack-local2.log`；本轮宿主服务全部退出（32169/47169及四个provider端口均无监听）。最新CI `56fe68aca` 的TC5强杀恢复竞态修复为`e86b61e8a`：默认async checkpoint先由独立图状态读确认再kill，本地独立库 `wsx_workbench_2867_checkpoint_1` 连续三次3/3通过。最终日志 `/private/tmp/wsx-2867-checkpoint-test4.log`；未修改生产durability或工具幂等保证。

- 05:07 更新：独立审查补修录音post-start失败清理与过期回调（`2711782e3`），17/17行为测试、tsc/lint通过；新生产构建的core录音用例通过，跨渠道录音在独立新库复验通过（`/private/tmp/wsx-2867-recording-final-isolated.log`）。首次同时运行两项目录音用例共享seed线程造成409，保留失败日志，不计作产品修复。当前远端HEAD `31a0862d7`、CI运行中；所有本轮宿主端口已释放，共享Docker栈不动。
- Peer已提交事实更新：`045f48ae5`含实际Skill fact/authority/子取消adapter；协议一致，但联合分支须保留`446b03557`与`d78a0790d`两处共享实现修复。已向用户请求peer整合后SHA及native已有环境入口。详见集成契约；不复制标准能力大提交。
