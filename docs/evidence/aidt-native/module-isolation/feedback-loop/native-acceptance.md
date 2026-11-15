# 原生浏览器最终验收

最终代码候选：`db828d5e2fbb6d8c233b4278c2ee50a9b892739b`，基于 develop `9458932e466198416b81780da6284ea5f2b39c57`。标准隔离的新 API、PostgreSQL、确定性本地供应商和 clean Next production build 上，四条 Playwright 用例 **4 passed、退出码 0**；JSON 为 expected=4、skipped=0、unexpected=0、flaky=0、errors=[]。本文件及其它证据收尾不属于已构建的业务源码。

## 命令与环境

工作目录 `/workspace/aidt-module-latest`。本次实际命令如下；临时 staged wrapper 先用已核实的缓存 AGE 镜像准备隔离依赖／seed，再执行 canonical API 和浏览器生命周期。它是本环境的测试编排，**不是用户工作区启动器或持久服务**。

```sh
env PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-ui-v3-bin:$PATH \
  NEXT_PUBLIC_ENABLE_AIDT=1 ENABLE_AIDT_MODULE=1 \
  ENABLE_PROJECT_MEMBER_CHAT=1 NEXT_PUBLIC_ENABLE_PROJECT_MEMBER_CHAT=1 \
  AIDT_E2E_OUTPUT_DIR=/workspace/scratch/aidt-feedback-loop/mobile-fix-results \
  AIDT_AUDIT_HOLD_SECONDS=0 \
  PLAYWRIGHT_BROWSERS_PATH=/tmp/aidt-playwright \
  WORKSPACEX_WEB_TEST_MAX_WORKERS=2 \
  BUILDX_CONFIG=/workspace/scratch/aidt-module-latest/buildx \
  DOCKER_HOST=unix:///var/run/docker.sock \
  pnpm exec tsx .harness/scripts/with-test-isolation.ts -- \
  node /workspace/scratch/aidt-feedback-loop/mobile-fix/run-staged.cjs \
  pnpm --filter web exec playwright test \
    --config playwright.aidt-feedback-loop.config.ts \
    --project=seeded --project=audit --workers=1 --max-failures=4
```

两次 staged Enter 仅分别启动依赖与 canonical API／Next；`WORKSPACEX_REUSE_INFRA=1` 由该 wrapper 对同一 isolation 显式传递。没有使用旧 Web 构建、修改冻结构建产物、关闭 TLS 校验或绕过隔离检查。回归入口是仓库内 `apps/web/playwright.aidt-feedback-loop.config.ts`，默认不 hold；独立测试环境仍应由标准 `with-test-isolation.ts` 管理。固定浏览器宽度为 1280、375；native 另覆盖 768。`AIDT_AUDIT_OBSERVE_ONLY` 实际未设，最终 runtime JSON 为 strictLayout=true／observeOnly=null。

## 四条真实范围

| 用例 | 实际验证 |
| --- | --- |
| shared AIDT stages | 双成员服务端保存、重新登录回读、版本历史、CAS 409 保留本页并显式比较重提、报告与第六步草稿互不覆盖、普通项目及跨项目拒绝、归档只读；真实 PG 回读 9 条修订。 |
| pure human project chat | 双作者真实发送、话题回复、10 条并发消息、幂等重试／同 ID 改文冲突、增量分页与旧话题新回复、非成员管理员拒绝、移除成员旧 token 拒绝、归档只读；真实 PG 回读 15 条消息。两个专用协作项目的 AgentRun／model request 均为 0→0。 |
| AIDT native project | 原生入口与普通项目分离、六阶段独立持久线程／对应 Skill、真实消息与个人检查点、真实资源关联与加载失败、录音 UI 复用路径、成员与只读边界。原失败的手机展开教学＋成果工具＋辅助 AI 路径保留，输入框／有草稿的发送按钮均 80% viewport、真实中心命中；关闭重开保留未发送草稿与原教学展开状态。AI 打开时成员插件真实可点击／输入，成员 Esc 不连关 AI。 |
| fresh native teaching audit | 新组 Dashboard 等真实加载完成、首步 CTA 与六条保存状态；六步原生欢迎无 loading 后截图；成果空态／编辑态／末字段的 25/50/75% 实际命中；非空候选删除确认／取消；成员插件真实 Tab、Enter、Space、面板内外 Esc、Shift+Enter 不发送、草稿保留。API 已有真实 Agent 正文后，还等待原生 send state=ready 或 disabled，才接受回答截图。 |

最终 audit 保存 61 条观测，四例共 100 张截图。375×812 默认 Chat host 由基线 405px 提升为 509px，真实欢迎正文可见；没有以模拟 Shell 传参代替浏览器结果。

## 失败尝试保留

| 尝试 | 结果与处理 |
| --- | --- |
| `1c5bf9a5` | 2 passed／2 failed：旧 Dashboard 文案断言、原生隐藏文本副本 selector。保留内容、未发送、真实存储断言，窄修测试并加强稳定等待／可见消息命中。 |
| `7aa8bd16` | 3 passed／1 failed：冷路由后同步 isVisible 触发 helper 等待已移除的重复 AI 按钮。正式失败图中真实 Chat 已稳定可用；改为等待真实面板或工具触发器。 |
| `f5d3a0e3` | 3 passed／1 failed：更严格的 viewport 断言揭示真实手机辅助 AI 裁切。不能用默认 Chat 的通过替代该路径。业务改成手机可视视口浮层、保留原生 DOM，之后新栈四例全部重验。 |

失败产物分别保留在 `/workspace/scratch/aidt-feedback-loop/{final-results,recheck-results,accepted-results}/`；第三个目录名称不表示通过，其 manifest 明确 failed／exit1。没有合并旧轮次绿色结果。

## 证据路径

最终截图／Playwright JSON 根：`/workspace/scratch/aidt-feedback-loop/mobile-fix-results/`。

- `01-dashboard-{1280,375}.png`：真实加载完成后的六步与起点。
- `02-step-{1..6}-chat-{1280,375}.png`：六步原生 Chat 稳定欢迎。
- `03-step-*`、`04-step-*`、`05-step-*`：六步成果空态、已填和底部字段。
- `12-chat-populated-{1280,375}.png`：SDK 终态后的真实已持久化回答。
- `project-aidt-native-AIDT-n-c2075--readonly-access-boundaries-seeded/aidt-teaching-mobile-start.png`、同目录 `aidt-mobile-ai-with-member-chat.png`：手机辅助 AI 和实际成员插件叠层。
- `aidt-member-collaboration--b7ea2-d-isolation-remain-explicit-seeded/aidt-report-editor-{1280,375}.png`、同目录 `shared-stage-pg-readback.json`：真实小组报告和 PG 修订。
- `aidt-member-collaboration--2af06-idempotency-and-no-AgentRun-seeded/project-human-member-topic-{real,375}.png`、同目录 `member-chat-pg-readback.json`：话题根摘要／滚动回复与 PG 消息。

源／环境／完整日志／迁移 SHA／截图 SHA／清理总清单：`/workspace/scratch/aidt-feedback-loop/mobile-fix/manifest.json`。同目录有 `source-checkpoint.json`、`native-e2e-runtime.json`、`native-e2e-console.log`、`cleanup.json`。我已实际查看最终手机 Dashboard、稳定 Chat、末字段、移动 AI、成员叠层、报告编辑及长话题图。

## 清理与边界

隔离 id `run-mwh8rzxk-113ebfb5-efcbde1cfa80`，Compose `wsx-efcbde1cfa80db67ea36`。标准 wrapper 退出后，实测 ps-a 无该栈容器、13 个自有端口无监听，cleanup clean=true。只使用 loopback；未部署生产、开放隧道、外绑服务或改访问权限。

这是本地真实 API／PG／原生 UI 验收，模型为确定性本地供应商 fixture。真实 AI 质量、ASR／麦克风、物理手机软键盘／真实 IME、30 人课堂负载未验收。没有共享桌面或外部可访问运行链接；静态截图和已经清理的 localhost 均不是可持续使用的小组工作区。没有交付新的未验证 runtime CLI。
