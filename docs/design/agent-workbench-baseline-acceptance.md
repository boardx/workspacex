# Agent 工作台 S0 基线验收报告

记录日期：2026-09-07。只读核查版本 `6303f8434736993a71ecb80b1f938fdda282baeb`。
本报告补齐 S0 交付材料，不把当前通过追溯为初始基线通过，不代替真实模型、发布或其他节点验收。

## 基线与依赖

实施 worktree：`/Users/shenyanbin/Documents/workspacex/.worktrees/codex-agent-workbench`。
初始基线 `8639579e0`；后续同步 main 的提交 `35b880453`。工作由用户直接授权，issue #2867、PR #2890；一次工作台升级单 PR，不另造一份 feature 状态。

以下 SHA256 对初始基线的 `git show 8639579e0:<path>` 字节和本次核查版本文件分别计算，两者一致：

| 文件 | 初始与当前 SHA256 |
|---|---|
| `pnpm-lock.yaml` | `45bc91a2fd34152a582081ff2affc7e255b2ce34788eb0acd329ab4f556228c6` |
| `apps/deep-agent-service/uv.lock` | `8228166d0ea1f2978bcd782f095f19933a2eacf26d8addae9a3d858c8a0fb527` |

初始调查曾因 hooks 写权限而未完成 init；开工后的计划进度表记录 init 退出 0。当前未找到可独立引用的该次 init 原始日志，因此这里只陈述两次记录的时间顺序，不声称已重新运行或重建原始输出。readiness/dashboard/tick 的初始权限与 gateway 阻塞记录见升级计划 §1.1，不能把当时不可查询解释为队列为空或租约正常。

## 当前入口与实际宿主

以 `apps/web/next.config.mjs` 和路由实现为准，不采用旧文件头注判断路由是否生效。

| 入口 | 当前实现/边界 |
|---|---|
| `/chat`、`/chat/:threadId` | `(v2)/layout.tsx` 持续挂载，`copilotkit-v2-shell-route.tsx` 解析 scope，共用工作台 |
| `/chat?projectId=…`、项目 thread URL | 同一工作台，保留项目可见性与编制；非第二套消息轨道 |
| `/chat/legacy` | Next 临时重定向到 `/chat`；旧文件仍存在不代表生产入口仍走旧屏 |
| `/chat/copilotkit-v2`、`/:threadId` | Next 兼容重定向到正式路径 |
| `/chat/live` | 保留独立 live 页面实现，含线程/预设操作；预设/历史能力仍需单独核对，不能因 legacy 重定向而宣布它已删除 |
| `/chat/preset` | 预设管理/原型入口，非正式运行时间线的替代验收 |
| `/chat/landing`、`/chat/copilotkit-preview` | 专用页面仍有源文件；不计作主工作台通过证据 |

`ChatLiveMessagePanel` 的业务调用仍在 `components/chat/chat-read-screen.tsx`；该旧宿主及保留入口属于 S12 后续核验边界。源文件存在与真实登录访问通过分开记录。

## 保留能力与测试映射

| 能力 | 保留的真实测试入口（仓库相对路径） |
|---|---|
| 多轮、切换、消息身份 | `apps/web/e2e/core-loop.spec.ts`；`apps/web/tests/ui/copilotkit-v2-shell-thread-switch.test.tsx`；`copilotkit-v2-run-restore-on-remount.test.tsx` |
| 附件、视觉诚实降级 | `apps/web/e2e/chat-vision-honest-degrade.spec.ts` |
| ASR/录音/跨渠道 | `apps/web/e2e/core-journey-05-voice-skill-multichannel-context.spec.ts`；`apps/web/tests/ui/chat-recording-panel-active-card.test.tsx` |
| 权限、幂等、版本 | `apps/api/tests/agent-run/workbench-control-http-acceptance.test.ts`；`parent-run-control.test.ts`；`permission-grant-scopes.test.ts` |
| Agent/Skill pins、编制 | `apps/web/e2e/core-loop.spec.ts`；`core-journey-03-skill-lifecycle-chat.spec.ts`；`skill-review-gate.spec.ts` |
| 画布、导出 | `apps/web/tests/ui/canvas-stage-export.test.tsx`；实际保存/重开仍须对应 S10 浏览器验收，单测不替代 |
| 消息评价、反馈 | `apps/web/tests/ui/chat-message-rating.test.tsx`；`apps/web/e2e/feedback-loop-smoke.spec.ts` |
| 项目边界、成果版本 | `apps/api/tests/agent-run/artifact-workbench.test.ts`；项目模式 workbench 回放与审批测试 |

该表说明保留覆盖位置；未给出 exact SHA 动态记录的单元不因列入表格而自动通过。

## 动态结果和失败清单

- 初始基线：没有完整“所有旅程已绿”的原始包；不补造。真实模型 PDF lane 未取得本轮外发授权，不以 loopback 替代。
- 生产 `31a0862d7`＋测试 `a83730fcb`：并发完整链 61 通过、8 失败、1 跳过、8 未运行。trace 的失败前置请求尚未完成，不能归类为 HTTP 500 或证实数据丢失。
- 相同冻结版本单 worker：76 通过、1 失败、1 跳过，原 8 个负载相关失败消失。唯一失败是 journey03 复用前序已挂 Skill 的未开始线程；`a47ef0a55` 修复测试隔离，未削弱零挂载反证。
- `76a44a546`：升级计划 09:45 记录对应 PR 的核心 E2E、四个 API 分片、pytest、完整编译、受影响范围及 fullstack-smoke 通过；实际全栈为 76 通过、1 重试通过、1 跳过，后续刷新定位测试已修 `a59cae435`。这是当前验证，非初始基线。以 PR checks 的对应提交为动态权威。
- `a06e8a365`：S2 专项真实 Nest/PG HTTP 4/4 通过；未知/跨租户、observer、重复取消及真实计划 revision CAS。
- peer 原生 Skill/native 联合链、真实模型、S3 长任务换实例/进程重启/撤权，以及发布后回归均不由以上结果覆盖。

本机历史原始日志：`/private/tmp/wsx-2867-fullstack-complete.log`、`/private/tmp/wsx-2867-fullstack-complete-serial.log`、`/private/tmp/wsx-s2-http.log`。这些是本机证据位置，不承诺 clone 后可取得；长期验证优先使用 PR #2890 对应 Actions 日志与仓库进度记录。

## 可重复验证入口

标准依赖初始化为 `./init.sh`。全栈使用 `apps/web/playwright.fullstack-smoke.config.ts`；`WORKSPACEX_REUSE_INFRA=1` 明确复用已授权基础设施，缺基础设施应失败，不让子 agent 启新 Docker。root 选择独立 `WORKSPACEX_DB`/PG 连接和端口，避免与其他 peer 共享测试数据。

```sh
pnpm --dir apps/web exec playwright test --config=playwright.fullstack-smoke.config.ts --list
WORKSPACEX_REUSE_INFRA=1 pnpm --dir apps/web exec playwright test --config=playwright.fullstack-smoke.config.ts --workers=1
pnpm --filter @repo/api exec vitest run tests/agent-run/workbench-control-http-acceptance.test.ts
```

执行者需使用已有标准环境配置；本报告未运行以上命令、未创建服务。S0 文档交付已经形成，但历史 init 原始输出和初始完整浏览器包缺失仍如实保留；是否允许以当前可重复验证替代历史基线缺口，应由根协调在节点验收记录中明确决定。

## 当前 S0 验收结论

2026-09-07 10:33，在 `cbd94528e` 上执行 `RUN_INFRA=0 ./init.sh` 退出 0；锁文件哈希未变化，生成文件无新增差异。[原始日志](evidence/agent-workbench/2026-09-07-init.txt)。结合本报告的入口、依赖与失败清单，以及 `f1a0c295f` 的两条真实浏览器控制验收，当前基础环境可重复启动，S0 当前基线材料验收完成。此结论不补造历史日志，也不声明真实模型 PDF 或全部产品验收通过。
