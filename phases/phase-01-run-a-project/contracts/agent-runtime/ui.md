# 契约束 `agent-runtime` — ① UI（签核第一件）

> ✅ **自检：本文件引用 48 张截图，目录下实际 48 张。**
> 目录＝`phases/phase-01-run-a-project/ui-preview/agent-runtime/`
> （`ls *.png | wc -l` → 48，另有一份 `README.md` 说明，不计入）。
> 两数相等，且下面第三节逐张列出、无重复、无遗漏 —— **不存在死链**。
>
> 📸 **截图已产出**（ui-prototyper 用 `apps/web` 真实组件 + mock 跑 `next dev` 抓的，
> 视口 1360×900 @2×，非设计稿）。材料位置与逐张说明见
> `ui-preview/agent-runtime/README.md`；本文件第三节是它的**索引 + 与本束屏号的对照**。
>
> ⚠ **但截图覆盖的是「净新屏」六块，不是本束全部屏。**
> 后台三张**列表屏**（模型 / MCP / Agent）与总览屏虽已用真实组件建成、带稳定
> `data-testid`（见第二节实测表），**本轮没有抓图**；原设想的 11 个文件名**一张都不存在**。
> 逐条缺口见「三之二、第 ① 件材料缺口」。
>
> ⇒ **签核条件：净新屏六块（权限内核 / MCP 安全策略 / 机密路由 / AI 团队编排 / 私聊 / 行为审计）
> 材料齐备，可签；已建成列表屏只能凭第二节的 `data-testid` 实测表与源码签，无图可看。**
> 这个差别请在签 `design-signoff.md` 的 `## ① UI` 时明确接受或退回。

> 覆盖 feature：**F48–F60** —— 派生视图，权威是 `design-signoff.md` 的 `covers:`
> 界面依据：`ui-preview/PROTOTYPE-DIGEST.md` 第八节（后台）、第二节（对话）、第七节（任务）；
> UI 先行原型（本束净新屏）：`ui-preview/agent-runtime/`（48 张 png + README）
> ← `apps/web/app/preview/agent-runtime/page.tsx` + `apps/web/components/agent-runtime/*`
> + `apps/web/lib/mock/agent-runtime.ts`（纯 mock，不接后端）
> 已建成代码：`apps/web/app/admin/[module]/page.tsx` + `apps/web/components/admin/*`

---

## 一、本束需要哪几块屏

⚠ 「现状」一列是**去仓库里核实过的**（`find app -name page.tsx` + `grep data-testid`），
不是照 UC 抄的。

| # | 屏 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| **S1** | 后台 · 模型管理 | `/admin/model` | F48 F49 F50 F51 | **已建成** |
| **S2** | 后台 · MCP 服务器（含安全策略四开关） | `/admin/mcp` | F52 F53 F54 | **已建成** |
| **S3** | 后台 · Agent 管理 | `/admin/agent` | F55 F56 | **已建成** |
| **S4** | 后台 · 数据总览（异常待处理 / 越权拦截 / 活动流） | `/admin` | F53 F54 F60 | **已建成** |
| **S5** | 对话屏 · 本线程的 AI 团队 + 批准卡 + tool-call 明细 | `/chat` | F51 F57 F58 F59 F60 | **已建成**（宿主归 `chat` 束） |
| **S6** | 项目设置 · **AI 权限三开关** + 工作流编排绑 agent | `/projects/[id]`（设置区） | F58 F59 | **未建**（✅ 三开关已在 `?screen=team` 原型中补画，见 `uc-4-2-team-default.png`；工作流编排绑 agent 仍未画） |
| **S7** | 蓝本设计器 · **第 12 项「Agent 编排」** + 【模型策略】三档 | 蓝本设计器（归 02-tpl） | F50 F57 | **未建**（❌ **原型也未画**，README §五-3 逐字写「真·未探明，本轮未画」） |
| **S8** | 项目 · 成果沉淀 → **审计与反馈**（四类事件同一条时间线） | `/projects/[id]`（成果沉淀区） | F60 | **未建**（⚠ 原型里**存在**，D-34「已存在，别搬走」；本仓未建。✅ 四类事件同一时间线已在 `uc-4-4-audit-default.png` 补画） |
| **S9** | 后台 · **组织级审计检索屏**（按项目/人/时间 + 导出） | `/admin/audit`（建议） | F60 | **未建**（⚠ **原型中就不存在**，D-34 新引入。✅ 已从零补画：`uc-4-4-audit-default.png`（组织管理员可见）/ `uc-4-4-audit-facilitator.png`（其余视角不可见）；多维联动筛选与导出 round-trip 未做，README §五-4） |
| **S10** | 对话屏 · **与单个 agent 的私聊面板**（右侧滑出） | `/chat`（滑出面板） | F59 | **未建**（⚠ 对话屏已完整探明，**无任何私聊入口**。✅ 已从零整面补画：`uc-4-3-chat-*.png` 九张） |
| **S11** | 主持台 · **AI 团队编排区**（当前载入了谁 / 为什么 / 下一步换谁） | 主持台全场视图 | F57 | **未建**（⚠ 主持台已完整探明，**无此区块**。✅ 已从零补画：`uc-4-2-team-*.png` 八张） |

**已建成 5 块 / 未建 6 块。** 未建的 6 块里，**S8 是「原型有、本仓没建」，
S9 / S10 / S11 是「原型里本来就没有」——性质不同，补法也不同**（前者补实现，后者要先补设计）。

⚠ **「未建」列的口径没变 —— 它说的是「生产路由未建」，不是「没设计」。**
S9 / S10 / S11 三块「要先补设计」的，**设计这一步已由 UI 先行原型完成**
（`/preview/agent-runtime`，48 张图），签核时看的是那批图；**生产路由仍然未建**，
实现工作量一点没少。S7 是唯一**连设计都还没有**的一块。

---

## 二、已建成屏的真实落点与 `data-testid`

> 全部来自 `grep -rn 'data-testid' apps/web/components/admin apps/web/components/chat`，
> **不是编的**。路由由 `apps/web/app/admin/[module]/page.tsx` 的 `SCREENS` 映射产生。

### S1 · `/admin/model` → `apps/web/components/admin/model-screen.tsx`

| testid | 作用 | 服务的验收 |
|---|---|---|
| `admin-model-filters` | 筛选条（全部 / 闭源 API / 开源自托管 / 未测试） | 20-1 V4 |
| `admin-model-add` | `[＋ 接入模型]` | 20-1 V1 / V9（空态） |
| `admin-model-group-hosted` | 「闭源 API」分组（含组说明「凭据由管理员保管，成员看不到」） | 20-1 V1 |
| `admin-model-group-self` | 「开源自托管」分组（含「客户机密材料只走这一类」） | 20-1 V1；20-3 V16 |
| `admin-model-panel` / `-cancel` / `-save` | `[配置]` 面板（凭据掩码录入，**无「查看」按钮**） | 20-1 V3 / V6 |
| `admin-model-test-dialog` | `[测试]` 五项判读面板 | 20-1 V2 / V5 |
| `admin-model-test-items` / `-item` / `-check-1..5` | 五项逐条 | 20-1 V2 |
| `admin-model-test-cancel` / `-submit` | 「判读通过并启用」（五项全过前 disabled） | 20-1 V2 |
| `admin-model-disable-dialog` + `-cancel` / `-confirm` / `-impact` / `-inflight` / `-mode-*` / `-reason` | **D-U5 停用二选一**（立即中断 / 跑完当前一轮）+ 影响范围 N 个调用 + 理由必填 | 20-2 V3 / V7 |
| `admin-model-toast` | 停用/启用结果提示 | 20-2 V5 |

### S2 · `/admin/mcp` → `apps/web/components/admin/mcp-screen.tsx`

| testid | 作用 | 服务的验收 |
|---|---|---|
| `admin-mcp-add` | `[＋ 添加服务器]` | 21-1 V1 / V13 |
| `admin-mcp-list` | 五列清单（服务器 / 端点 / 工具 / 授权范围 / 状态） | 21-1 V1 / V18 |
| `admin-mcp-scope-note` | 授权范围说明 | 21-1 V3 |
| `admin-mcp-policy` | **安全策略四开关区** | 21-2 V1 |
| `admin-mcp-policy-toggle` | 逐个开关（⚠ 第 3 条须只读常开、第 4 条须只读常关） | 21-2 V2a；20-3 V15 |
| `admin-mcp-panel` / `-cancel` / `-save` | 注册 / 配置面板 | 21-1 V1 |
| `admin-mcp-tools-drawer` / `-tools-list` / `-tool-row` | 「N 工具」展开的工具清单（agent 白名单编辑器的数据源） | 21-1 V6 / V9 |
| `admin-mcp-review-dialog` | 放行评审面板（结论 / 理由 / 授权范围） | 21-2 V4 / V5 |
| `admin-mcp-disable-dialog` + `-impact` / `-inflight` / `-mode-*` / `-reason` | 撤销授权 / 重新隔离二选一 | 21-2 V11 |
| `admin-mcp-toast` | 结果提示 | 21-1 V15 |

### S3 · `/admin/agent` → `apps/web/components/admin/agent-screen.tsx`

| testid | 作用 | 服务的验收 |
|---|---|---|
| `admin-agent-add` | `[＋ 新建 Agent]`（从空目录开始 / 复制一个现成的） | 4-1 V9 / V12 |
| `admin-agent-list` | agent 行列表（缩写 / 名字 / 职责·可见性 / 状态徽标 / 模型 / N skills / 操作） | 4-1 V1 / V6 |
| `admin-agent-definition` | `[查看定义]` 只读定义视图 | 4-1 V1 / V21 |
| `admin-agent-definition-blocker` | **「还没配工具白名单，不能发布」硬闸门文案** | 4-1 V2 / V15 |
| `admin-agent-panel` / `-cancel` / `-save` | `[编辑]` 配置面板 | 4-1 V13 |
| `admin-agent-field-model` | **模型下拉（只出已启用模型）** | 4-1 V5 / V17；20-2 V1a / V1b |
| `admin-agent-trial-modal` / `-trial-steps` / `-trial-output` | `[试跑]` 面板与调用链 | 4-1 V1 |
| `admin-agent-approve-dialog` | `[批准发布]` / `[退回]`（两道门禁 + 越权申请裁决） | 4-1 V3 / V20；4-4 V22 |
| `admin-agent-disable-dialog` + `-impact` / `-inflight` / `-mode-*` / `-reason` | 停用二选一 | 4-1 V18；4-2 V17 |
| `admin-agent-toast` | 结果提示 | 4-1 V14 |

### S4 · `/admin` → `apps/web/components/admin/overview-screen.tsx`

| testid | 作用 | 服务的验收 |
|---|---|---|
| `admin-overview-metrics` | 三块指标卡 | — |
| `admin-overview-anomalies` | **异常待处理（额度异常 / 越权调用）** | 21-1 V2 / V12；21-2 V8；20-3 V6；4-4 V5 / V6 / V20 |
| `admin-anomaly-chain-steps` / `-step` | `[查看调用链]` 下钻 | 4-4 V5 |
| `admin-overview-activity` | 活动流（成员 · 动作 · 相对时间） | 20-1 V12；21-1 V15；4-1 V14 |
| `admin-activity-export` / `admin-activity-report` | `[导出]` / `[生成月度报告]` | 4-4 V13 |

### S5 · `/chat` → `apps/web/components/chat/*`（宿主归 `chat` 束）

| testid | 作用 | 服务的验收 |
|---|---|---|
| `chat-team-panel` / `chat-team-compose` / `chat-team-edit-hint` / `chat-team-market` | 「本线程的 AI 团队 · 6」+ `[编制]` + `＋ 从 Agent 市场加入` | 4-2 V3 / V12 / V13 |
| `chat-header-team` / `chat-team-popover` | 线程头部「团队 4」（**在场数**，与编制数分离，S-06） | 4-2 V3 |
| `chat-badge-degraded` | `降级运行 · sonnet` 角标 | 4-1 V7；20-2 V9 |
| `chat-tool-calls` / `-toggle` / `-detail` / `chat-tool-call-row` | 消息内「工具调用 · 3 ｜ 读了 64 条 · 12.4k token」+ 逐条明细 | 4-4 V1 / V2 / V18；21-1 V5 |
| `chat-approval-card` / `-status` / `-actions` / `-approve` / `-reparam` / `-decline` | 批准卡与三个出口 | 4-4 V3；20-3 V3 |
| `chat-approval-callchain-toggle` / `-detail` | `▸ 调用链 Ava → Ledger` | 4-4 V1 / V3 |
| `chat-approval-datascope-note` | **「要读的数据：… · 含机密，仅本地模型」** | 20-3 V1 / V3；21-2 V10 |
| `chat-approval-policy-violation` | 机密策略违规提示 | 20-3 V2；20-1 V9 |
| `chat-approval-reparam-panel` / `chat-approval-toggle-local` | `[改]` 面板（含机密时闭源不可选） | 20-3 V3 |
| `chat-approval-queue` | `[看任务队列]`（跑批中 / 排队位次） | 4-1 V16；4-2 V4 / V19；4-3 V8 |
| `chat-settings-panel` / `-agents` / `-models` / `-confidential-notice` / `-apply` | 输入区「更多设置」的 agent 与模型选择、机密提示 | 20-2 V4；20-3 V16 |
| `admin-sample-config-notice` | 「这些是某组织的示例配置」声明（对应 S-13 编造数据的自曝） | 20-2 V12；21-1 V14 |

⚠ **改派提示条与「非实时」标注在本轮 grep 中没有找到对应 `data-testid`**——
见 `coverage.md` 缺口 20 / 21。需确认是未建还是未打标。

---

## 三、截图索引（真实文件，48 张，逐张核对过）

> 目录：`ui-preview/agent-runtime/`（路径相对 phase 根）。**下表每一行都是磁盘上真实存在的
> `.png`**，不是约定文件名。原型路由 `/preview/agent-runtime`，三个查询参数：
> `?screen=`（6 屏）｜`?as=`（视角）｜`?state=`（七态，走共享 `StateShell`）。
> 逐张的 UC 节次与 feature 归属见 `ui-preview/agent-runtime/README.md` 第一节，本表不重抄。

**六屏合计 9 + 5 + 8 + 8 + 9 + 9 = 48 张。**

### 屏 1 · 三层权限 · 工具白名单编辑器（`?screen=permission`，UC-4.1 / UC-21.1）— 9 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 1 | `ui-preview/agent-runtime/uc-4-1-permission-default.png` | default | 能力维护者 | 三层求交并列三格 + 白名单编辑器；「卡在第 ② 层」高亮 |
| 2 | `ui-preview/agent-runtime/uc-4-1-permission-cosign.png` | default | 组织管理员 | 会签复选**仅此视角出现** |
| 3 | `ui-preview/agent-runtime/uc-4-1-permission-tool-whitelist-cosign.png` | default | 组织管理员 | 越权申请逐条裁决弹层（双签闸门） |
| 4 | `ui-preview/agent-runtime/uc-4-1-permission-loading.png` | loading | 能力维护者 | 七态 U1 |
| 5 | `ui-preview/agent-runtime/uc-4-1-permission-empty.png` | empty | 能力维护者 | 白名单为空 ＝ 不得发布（对应 S3 的 `admin-agent-definition-blocker`） |
| 6 | `ui-preview/agent-runtime/uc-4-1-permission-invalid.png` | invalid | 能力维护者 | 越权未会签不得保存 |
| 7 | `ui-preview/agent-runtime/uc-4-1-permission-dep-failed.png` | dep-failed | 能力维护者 | MCP 网关不可达 |
| 8 | `ui-preview/agent-runtime/uc-4-1-permission-denied.png` | denied | 引导师 | 只用不配 |
| 9 | `ui-preview/agent-runtime/uc-4-1-permission-success.png` | success | 能力维护者 | 会签放行、白名单定稿 |

### 屏 2 · MCP 安全策略 · 放行评审（`?screen=mcp-policy`，UC-21.2）— 5 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 10 | `ui-preview/agent-runtime/uc-21-2-mcp-policy-default.png` | default | 组织管理员 | **安全策略四开关区**（第 3 条只读常开、第 4 条只读常关，带锁形图标）+ 隔离行 |
| 11 | `ui-preview/agent-runtime/uc-21-2-mcp-review-panel.png` | default | 组织管理员 | 放行评审弹层：结论三选 + 理由 + 授权范围 |
| 12 | `ui-preview/agent-runtime/uc-21-2-mcp-policy-invalid.png` | invalid | 组织管理员 | 放行未设授权范围 |
| 13 | `ui-preview/agent-runtime/uc-21-2-mcp-policy-empty.png` | empty | 组织管理员 | 无待评审服务器 |
| 14 | `ui-preview/agent-runtime/uc-21-2-mcp-policy-denied.png` | denied | 能力维护者 | 策略只读 |

⚠ 屏 2 **没有 loading / dep-failed 两态**（其余五屏都有）。这不是漏列，是原型没拍。

### 屏 3 · 机密数据的模型路由 · 批准卡（`?screen=routing`，UC-20.3 / UC-20.2）— 8 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 15 | `ui-preview/agent-runtime/uc-20-3-routing-default.png` | default | 引导师 | 批准卡「含机密，仅本地模型」+ 调用链 —— **S-01 / X-3 裁决的界面证据** |
| 16 | `ui-preview/agent-runtime/uc-20-3-routing-explain.png` | default | 引导师 | 「含机密」可点解释下钻（逐项机密判定依据） |
| 17 | `ui-preview/agent-runtime/uc-20-3-routing-change-confidential.png` | default | 引导师 | `[改]` 面板：含机密时**只列自托管候选** |
| 18 | `ui-preview/agent-runtime/uc-20-3-routing-nolocal-fail.png` | dep-failed | 引导师 | **无可用自托管 ⇒ 整屏失败、零逃生口**（本束最重要一态） |
| 19 | `ui-preview/agent-runtime/uc-20-3-routing-invalid.png` | invalid | 引导师 | 改成闭源被拒 |
| 20 | `ui-preview/agent-runtime/uc-20-3-routing-dep-failed.png` | dep-failed | 引导师 | 证据平面不可达 |
| 21 | `ui-preview/agent-runtime/uc-20-3-routing-denied.png` | denied | 观察者 | — |
| 22 | `ui-preview/agent-runtime/uc-20-3-routing-success.png` | success | 引导师 | 路由到本地 qwen3-32b |

⚠ 屏 3 **没有 loading / empty 两态**。dep-failed 有两张（18 无本地模型 / 20 证据平面不可达），
是两种不同的依赖失败，不是重复。

### 屏 4 · AI 团队编排 · 主持台（`?screen=team`，UC-4.2）— 8 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 23 | `ui-preview/agent-runtime/uc-4-2-team-default.png` | default | 引导师 | 编制≠在场双徽标（S-06）+ 因什么载入 + 下一步换谁 + 优先级裁剪 + 改派 + **项目级 AI 权限三开关**（＝S6 的一半） |
| 24 | `ui-preview/agent-runtime/uc-4-2-team-member.png` | default | 组员 | 改派提示条「存在但不可操作 + `待确认` 徽标」——**界面被迫先呈现一半**，见缺口 ③ |
| 25 | `ui-preview/agent-runtime/uc-4-2-team-observer.png` | default | 观察者 | 只见在场名单 |
| 26 | `ui-preview/agent-runtime/uc-4-2-team-loading.png` | loading | 引导师 | — |
| 27 | `ui-preview/agent-runtime/uc-4-2-team-empty.png` | empty | 引导师 | 无 agent，不自动塞默认 |
| 28 | `ui-preview/agent-runtime/uc-4-2-team-invalid.png` | invalid | 引导师 | 可见性不覆盖本项目 |
| 29 | `ui-preview/agent-runtime/uc-4-2-team-dep-failed.png` | dep-failed | 引导师 | 实时通道不可用 → 非实时（对应第二节末尾「非实时标注无 testid」那条存疑） |
| 30 | `ui-preview/agent-runtime/uc-4-2-team-success.png` | success | 引导师 | 按环节重新载入，原因已记录 |

⚠ 屏 4 **没有 denied 态**（观察者视角第 25 张承担了「看得少」，但没有「完全不可见」那一态）。

### 屏 5 · 与单个 agent 私聊（`?screen=chat`，UC-4.3）— 9 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 31 | `ui-preview/agent-runtime/uc-4-3-chat-default.png` | default | 引导师 | skill 清单（带版本）+ 常驻「可被审计」告知条 + 转出入口 |
| 32 | `ui-preview/agent-runtime/uc-4-3-chat-transfer-provenance.png` | default | 引导师 | 转出到主线程 · 出处预览弹层 |
| 33 | `ui-preview/agent-runtime/uc-4-3-chat-member.png` | default | 组员 | 默认无私聊入口（O-24） |
| 34 | `ui-preview/agent-runtime/uc-4-3-chat-denied.png` | denied | 观察者 | 无私聊入口 |
| 35 | `ui-preview/agent-runtime/uc-4-3-chat-loading.png` | loading | 引导师 | — |
| 36 | `ui-preview/agent-runtime/uc-4-3-chat-empty.png` | empty | 引导师 | 无可私聊 agent |
| 37 | `ui-preview/agent-runtime/uc-4-3-chat-invalid.png` | invalid | 引导师 | 目标主线程已归档，转出被拒 |
| 38 | `ui-preview/agent-runtime/uc-4-3-chat-dep-failed.png` | dep-failed | 引导师 | 模型停用 / MCP 隔离 ⇒ 能力受限 |
| 39 | `ui-preview/agent-runtime/uc-4-3-chat-success.png` | success | 引导师 | 转出带出处，正文未进主线程 |

### 屏 6 · Agent 行为审计（`?screen=audit`，UC-4.4）— 9 张

| # | 文件 | 状态 | 视角 | 拍到了什么 |
|---:|---|---|---|---|
| 40 | `ui-preview/agent-runtime/uc-4-4-audit-default.png` | default | 组织管理员 | 四类事件同一条时间线 + 异常限速 + **组织级检索区**（＝S9） |
| 41 | `ui-preview/agent-runtime/uc-4-4-audit-drill-toolcalls.png` | default | 组织管理员 | tool-call 四要素 + 调用链深度 2 + 采纳与否 + **三层权限快照** |
| 42 | `ui-preview/agent-runtime/uc-4-4-audit-chain.png` | default | 组织管理员 | 异常调用链下钻（含拦截点，归「授权范围越权」） |
| 43 | `ui-preview/agent-runtime/uc-4-4-audit-facilitator.png` | default | 引导师 / 项目负责人 | **无组织级检索**，给「切到组织管理员查看」说明而非空白 |
| 44 | `ui-preview/agent-runtime/uc-4-4-audit-denied.png` | denied | 组长 | 审计屏整体不可见 |
| 45 | `ui-preview/agent-runtime/uc-4-4-audit-loading.png` | loading | 组织管理员 | — |
| 46 | `ui-preview/agent-runtime/uc-4-4-audit-empty.png` | empty | 组织管理员 | 无审计事件，**不造示例** |
| 47 | `ui-preview/agent-runtime/uc-4-4-audit-invalid.png` | invalid | 组织管理员 | 留痕写入失败即调用失败（E2 / AC6） |
| 48 | `ui-preview/agent-runtime/uc-4-4-audit-success.png` | success | 组织管理员 | 导出 CSV，可复现 |

---

## 三之二、第 ① 件材料缺口 —— 原设想里有、实际没画的

> 本节是**故意显眼**的。上一版本文件按「界面依据」设想了 11 个截图文件名
> （`ui-preview/admin-*.png` / `chat-approval-confidential` 等），
> 实际产出走的是另一条路线：ui-prototyper 明确**只补净新屏、不重画已建成的列表屏**
> （`ui-preview/agent-runtime/README.md` 顶部「范围纪律」＋ §五-2）。
> ⇒ **那 11 个设想文件名一个都不存在，且不会被补**，除非签核时明确要求。
> 下面逐条列出，签核人必须知道自己**在没有这些图的情况下**签了什么。

**缺口 K = 11 条（设想截图）+ 1 条（整屏未设计）= 12 条。**

### A. 已建成但无截图的四块屏（凭第二节 `data-testid` 实测表与源码签，无图）

- ⚠ 未产出：**模型管理列表**（两个分组 + 筛选 + 状态 + 行操作 + 两条组说明，原设想 `ui-preview/admin-model`，S1）—— 该屏尚未画
- ⚠ 未产出：**五项测试判读面板**（原设想 `ui-preview/admin-model-test`，S1；原本要用它暴露 `coverage.md` 缺口 3「只有勾选，无三选 + 证据」）—— 该屏尚未画
- ⚠ 未产出：**模型停用二选一确认框**（影响范围「N 个进行中的调用」+ 理由必填，原设想 `ui-preview/admin-model-disable`，S1）—— 该屏尚未画
- ⚠ 未产出：**MCP 五列清单 + `已隔离 · 待安全评审` 行**（原设想 `ui-preview/admin-mcp`，S2）—— 该屏尚未画。**注意**：同一设想文件名里的「安全策略四开关区」已由第三节第 10 张（`uc-21-2-mcp-policy-default.png`）覆盖，**缺的是清单那半边**
- ⚠ 未产出：**「N 工具」展开的工具清单**（白名单编辑器的数据源，原设想 `ui-preview/admin-mcp-tools`，S2）—— 该屏尚未画
- ⚠ 未产出：**Agent 列表三态**（运行中 / 草稿含阻断文案 / 待审核含门禁文案与越权申请数，原设想 `ui-preview/admin-agent`，S3）—— 该屏尚未画
- ⚠ 未产出：**`[查看定义]` 六段并列只读视图**（原设想 `ui-preview/admin-agent-definition`，S3；原本要用它暴露 `coverage.md` 缺口 14「无『数据范围』『最近试跑』两列」）—— 该屏尚未画
- ⚠ 未产出：**数据总览「异常待处理」两条告警 + `[查看调用链]` 下钻**（原设想 `ui-preview/admin-overview-anomaly`，S4）—— 该屏尚未画。**注意**：调用链下钻的**语义**已由 `uc-4-4-audit-chain.png` 覆盖，但那是审计屏的下钻，**不是 `/admin` 总览屏的**
- ⚠ 未产出：**`/chat` 宿主屏上的批准卡**（原设想 `ui-preview/chat-approval-confidential`，S5）—— 该屏尚未画。**注意**：批准卡本身的三张关键图已由 `uc-20-3-routing-default / -explain / -change-confidential` 覆盖，缺的是**它嵌在真实对话流里长什么样**（宿主归 `chat` 束）

### B. 上一版本自己点名"另建议补"的两张空态 —— 也没补

- ⚠ 未产出：**模型管理空态**（原设想 `ui-preview/admin-model-empty`）—— 该屏尚未画
- ⚠ 未产出：**Agent 管理空态**（原设想 `ui-preview/admin-agent-empty`）—— 该屏尚未画

⇒ 上一版提出这两张的理由**依然成立且未被消解**：原型每屏都填满样例数据、**零空态**，
而本束有 8 条验收线索直接考空态（20-1 V9、20-2 V11、21-1 V13、21-2 V14、
4-1 V12、4-2 V13、4-3 V10、4-4 V15）。净新屏六块里已有 5 张 empty 图
（第 5 / 13 / 27 / 36 / 46 张），**但它们全在净新屏上，`/admin/*` 三张列表屏的空态一张都没有**。

### C. 连设计都还没有的一块（不是没截图，是没画）

- ⚠ 未产出：**蓝本设计器第 12 项「Agent 编排」配置面板内部**（触发条件编辑器、优先级设置、
  【模型策略】三档，S7 / F50 F57）—— 该屏尚未画。`ui-preview/agent-runtime/README.md`
  §二-6 与 §五-3 逐字记为「真·未探明，本轮未画」，且「4 个」到底是 4 条规则还是 4 个 agent
  **未定**。这一条**不是抓图问题，是设计缺失**，签核时性质与上面 11 条不同。

### D. 净新屏内部缺的七态格子（不是屏缺，是态缺）

- 屏 2（MCP 安全策略）缺 **loading / dep-failed**
- 屏 3（机密路由）缺 **loading / empty**
- 屏 4（AI 团队编排）缺 **denied**

⇒ 若某条 verification 要锚 `StateShell` 的这几个保留 testid，**目前没有对应截图作为设计依据**。

---

## 四、`ui-preview` 三份 markdown 里与本束相关的已知缺口

> 这些是**「UC 没写、由实现者替 UC 做了的决定」**，来自 `ui-preview/README.md` 的 S-xx 清单。
> 它们不是 bug，是缺口被填的位置——**需要人类逐条确认**。

### 🔴 S-01 批准卡：机密数据能否与云端模型并存 —— **本束最重要的一条**

> 原型同时印着「gpt-5.2 ＋ **本地** qwen3-32b」和「含机密，**仅本地模型**」，**字面矛盾**。
> 实现取的口径是：**机密数据只路由到本地模型，云端模型可并存承接非机密部分**。
> 故 `modelPolicyViolation()` 只在「有机密但无任何本地模型」时报违规，而非「有云端模型就违规」。
> **这直接决定后端 gateway 的拦截规则。** 位置：`/chat`，`lib/mock/chat.ts` 的 `modelPolicyViolation`。

⚠ 而 `feature_list.json` 的 **F51** 与 **UC-20.3 R3 第 4 步（O-22③ + O-17）** 取的是
**相反的口径：整轮全本地，云端本轮不可用，明写「不是分流」**。

⇒ **本束的 `domain.md` I-10 与 `usecases.md` 的 `routeModelCall` 按「整轮全本地」写，
并把这条列为 `domain.md` 的「待人类裁决 ①」与 `design-signoff.md` 的重点确认项。
若裁决为 S-01 那一版，I-10 / I-4 / F51 验收 / `modelPolicyViolation` / 二次确认文案全部要改。**

### 🟠 S-06 「在场数」是否包含跑批中的 agent —— 直接影响 4-2 V3

> 原型同时有「团队 **4**」与「AI 团队 · **6**」。实现定义 `在场 = presence === "present"`（4 个），
> **跑批中（Ledger）与空闲（Echo）不计入在场**，与编制数 6 分离。
> 影响线程头「团队 N」与列表「N 个 agent」的所有数字。位置：`/chat`。

⇒ 本束 `domain.md` **I-34** 按此写（`presentCount` 只数 `在场`）。**请确认这个口径。**

### 🟡 S-13 后台里三条被补的东西 —— 三条全落在本束

> - **新造了第 7 个 agent「Forge」**，把总览的「自建 agent 访问客户 CRM 被拦 7 次」与
>   Agent 页的「越权申请待确认」串成同一条线索。**原型是两处独立提及，没说是同一个。**
> - **18 台模型的型号与定价全是编的**（`gpt-5.2`、`claude-opus-4.6` 等）。
>   原型只给了计数与闭源/自托管二分。
> - **「可选范围」被降级为只读文字**（如「仅：Ledger（机密路由）」）+ 顶部筛选器，
>   没做成逐模型的多选编辑器。**D-07 要求「可选范围过滤」，这是范围上的收缩。**
> - **「可承接机密」徽标只贴自托管模型** —— 把「机密只走自托管」做成了模型列表上的显式标记，
>   原型只在批准卡侧写过这条约束。

⇒ 三条确认项：
1. **Forge 这条线索是否成立**（它影响 F53 越权拦截证据的归属，`coverage.md` 21-1 V12）。
2. **18 台模型必须只是组织配置数据**——UC-20.1 R6 明写「不得硬编码进代码或种子数据」，
   删掉后界面必须走空态而非崩（`domain.md` I-8 / I-9 的同源要求）。
3. **「可选范围」的收缩是不是 phase-1 的正确边界**，还是要补回逐模型编辑器。

### 🟡 S-14 危险动作都补了二次确认与影响范围（UC 只给了一个按钮）

本束的三个 `*-disable-dialog`（model / mcp / agent）就是这条的落地，
带**二选一 + 影响范围 N + 理由必填**。UC 里只有一个动作按钮，**这套语义是拟的**——请确认。

### 五、其余相关但归属别束的 S 项（列出以免遗漏）

- **S-02 / S-03 角色本体是否需要「场景角色」层** —— 本束的 O-21「方法论审核人 / 安全评审人」
  两职能拆分**依赖这个裁决**（`coverage.md` 缺口 15）。README 自己建议**合并裁决**。
- **S-11 观察者能看到多少** —— 影响 4-1 V11 / 4-3 V5 / 4-4 V14 的观察者行。
- **S-12 丢弃清单的 7 类原因** —— 与本束的 `omissions`（20-3 A3「剔除机密材料」出口）相接。

---

## 五、这一件签核时要看什么

1. **你接受「净新屏有图、已建成列表屏无图」这个覆盖面吗** —— 第三节的 48 张图真实存在、
   六屏 × 七态 × 四视角，覆盖权限内核 / MCP 安全策略 / 机密路由 / AI 团队编排 / 私聊 / 行为审计；
   但 `/admin/model` `/admin/mcp` `/admin/agent` `/admin` 四块**一张图都没有**，
   只能凭第二节的 `data-testid` 实测表与源码签。**「三之二」列的 12 条缺口就是你要接受或退回的东西。**
   若不接受，退回项应是缺口 A 的 9 条 + B 的 2 张空态。
2. **已建成的 5 块屏，信息架构对不对**（**无截图，看第二节实测表 + 跑 `/admin/*` 亲眼看**）——
   尤其 S3 的三态行（运行中 / 草稿含阻断文案 / 待审核含门禁文案与越权申请数）；
   S2 的四开关区已有图（第 10 张），可直接看第 3 条只读常开、第 4 条只读常关。
3. **未建的 6 块屏，缺口性质分清了吗** —— S8 是「原型有本仓没建」（补实现）；
   **S9 / S10 / S11 是「原型里本来就没有」（要先补设计，再补实现）**，
   其中**设计这一步已由 UI 先行原型补上**（S9→第 40/43 张，S10→第 31–39 张，S11→第 23–30 张），
   **生产路由仍未建**。**S7（蓝本第 12 项「Agent 编排」）是唯一连设计都还没有的一块**——
   见「三之二」C 节，它压着 F50 / F57 的一部分验收线索，是本束第 ① 件现在最大的风险。
4. **S-01 / S-06 / S-13 三条实现者替 UC 做的决定，你认可吗** —— 尤其 **S-01**，
   它不是界面问题，是**后端拦截规则**问题。
