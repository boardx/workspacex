# A6：原生历史返回与持续讨论验收补强

基线：`15ca37c4d`；独立分支 `worker/aidt-complete-acceptance`。只修改现有 `apps/web/e2e/aidt-local-persistence.spec.ts` 和本目录证据，不修改业务组件、全局配置、模型 lane、设计签核或共享 Backlog。

本轮是**验收代码交付**，尚未运行新增浏览器链。主任务先整合 A2 host 与 `returnRevision` prop 接线，再冻结源码、构建和执行。没有模型请求、浏览器通过或课堂效果的新增声明。

## 覆盖差异

| 场景 | 旧真实证据/既有用例 | 本轮实际新增断言 |
| --- | --- | --- |
| 基础回归 | `round-context/verification.md`：50 文件501 Web、7文件38 Runtime、native 1例、双停启完整通过 | 计数是旧冻结源码证据，本轮没有重跑并沿用为新通过 |
| 旧轮次返回 | 旧 native 在 S6 当前头部是首轮时走回1；后续走回2 | 学生分别保存返回1、3、4、5、2及独立原因/行动，再保存报告；所有选定轮次 revision 必须小于最新 head |
| 历史读回 | 旧用例读全历史列表并保留 JSON | 每次 URL 指定旧 returnRevision，等待浏览器实际 GET `/projects/:id/aidt/stages/6/revisions?beforeRevision=old+1&limit=1`；响应200、契约解析、整份 SharedStage 必须等于原保存回执；界面显示原原因/行动 |
| 原生 Chat 返工上下文 | A2 单元/host 回归使用明确 mock，非真实模型 | 从成果点击“返回本步对话”，在可见原生 Chat 展开历史反思，核对可见 pre 的原问题/旧原因/行动；不发送模型请求。漏传 `returnRevision` 将无法找到/读到该上下文而失败 |
| 不匹配与恢复 | 原生未覆盖历史返回错误目标/不存在版本 | 有效旧轮次指向错误步骤须拒绝；不存在版本的真实API虽返回head也须拒绝，实际重试后仍拒绝；切到可见Chat显示尚未带入、重试仍拒绝，但原生输入可填写并清空；最后用有效V1恢复 |
| 不代替学生生成 | 原 native 没有生成请求 | 1–5轮次 `newVersion` 均空；返回/历史检查期间无阶段写请求；S5原回执不变；既有生成请求观察延伸到重启后成员文字操作 |
| 持久化 | 旧 native 两次完整 start/stop，重新登录精确回读 | 双cycle和严格 `ownerExit === 0` 原断言全部保留；新登录逐个再读5份旧历史及原生Chat投射，并在报告UI精确恢复已保存markdown |
| 权限 | 既有 `aidt-member-collaboration.spec.ts` 有真实双成员、非成员404、归档403；本轮未重跑 | 新的无凭证 context 在登录前请求真实history，须401，且不含旧返回原因/报告正文。匿名拒绝不等于整套成员权限矩阵重新验收 |
| 全局文字 | 旧 native 在report发送并跨重启回读 | 保留report入口与375px回读；真实API必须精确唯一包含原消息；重启后再发送一条并精确唯一读回两条，均不发生成请求 |

所有学生输入均为合成验收材料，明确写明没有真实研究或测试；返回第5步也只保存学生的下一步选择，不生成原型、不标记新版已测试。

## 已执行的定向检查

- Web typecheck 退出0（发生在最后追加 Chat 预览/失败恢复及报告UI恢复断言前；最终集成类型检查由 root 执行，不重复全仓）。
- 最终 spec ESLint `--max-warnings 0` 退出0，见 `eslint.txt`。
- Playwright `--list` 精确发现1文件1例，见 `discovery.txt`；只发现、未启动浏览器或服务，发现所用隔离名/端口不是运行租约。
- `git diff --check` 退出0。
- 原 canonical testid gate 退出1，完整日志见 `testid-gate.txt`。这是实际失败，不计通过。

`testid-scope-audit.mjs` 只读比较基线与新spec：全局门的 `SOURCE_ROOTS` 缺 `apps/web/features`，基线已有19种原生AIDT锚点误报。额外纳入features只是诊断，不是替代门控；新增Chat锚点还依赖 A2提交 `5fd28e0108e33b2b653aa343cea59813e56ed245`。`testid-scope-audit.json` 保留各状态和缺失项。root负责修正门控真实扫描目录，未添加豁免。

## root 最终执行

在集成冻结目录使用Node22、pnpm9.15；以新目录保留首次失败，不复用旧 build/receipt，不设置模型fixture：

```sh
export PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH
export PLAYWRIGHT_BROWSERS_PATH=/tmp/aidt-playwright
export WORKSPACEX_ISOLATION_SEED=aidt-completion-native-20261116-1
export AIDT_LOCAL_DATA_DIR=/workspace/scratch/aidt-completion-native-20261116-1/data
export AIDT_LOCAL_OUTPUT_DIR=/workspace/scratch/aidt-completion-native-20261116-1/private-evidence
export AIDT_LOCAL_WEB_MODE=start
export AIDT_LOCAL_REUSE_BUILD=0
export NODE_ENV=development
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.aidt-local.config.ts --workers=1
```

标准外壳负责真实端口租约/重E2E锁；根任务统一执行，不与其他浏览器工作并行。密码、token、trace和含会话的原始日志保留私有目录；只交付审阅后的脱敏回执。继续遵守每次stop命令及原启动进程均exit0、13端口释放、PG数据/密钥保留的原门槛。

## 待验收边界

新增原生场景、A2/A3/A5最终host接线、真实 Design 版本选择尚待集成真实浏览器验收。真实模型供应商未配置，不能以 no-model native、单元mock或历史规划文档证明模型教学质量、模型超时恢复、生成原型、课堂多人协作、真实访谈/ASR及macOS/Windows实机。错误历史引用的恢复也不等于网络中断或模型供应商故障恢复已验证。没有生产部署、合并、签核改动或GitHub外发。

第二提交扩展：报告历史真实两页读取、审阅后追加、保留来源主动保存、新登录textarea恢复，以及A4真实成员文字/话题/草稿/幂等helper集成，见 [report-history-addendum.md](report-history-addendum.md)。仍待root整合冻结后实际运行完整native。
