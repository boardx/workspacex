# 契约束 `agent-runtime` — ① UI（签核第一件）

> 🚨 **截图待补：`phases/phase-01-run-a-project/ui-preview/` 下目前只有三份 markdown
> （`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md`）与一个 `files/` 子目录，
> 没有任何 `.png` 截图文件。**
>
> ⇒ **在截图补齐之前，第 ① 件不具备签核条件。**
> `design-signoff.md` 的 `## ① UI` 一节请留空不勾，等 ui-prototyper 按下面的
> 「截图清单」产出后再签。②（用例）与 ③（API 契约）两节可以先看。

> 覆盖 feature：**F48–F60** —— 派生视图，权威是 `design-signoff.md` 的 `covers:`
> 界面依据：`ui-preview/PROTOTYPE-DIGEST.md` 第八节（后台）、第二节（对话）、第七节（任务）；
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
| **S6** | 项目设置 · **AI 权限三开关** + 工作流编排绑 agent | `/projects/[id]`（设置区） | F58 F59 | **未建** |
| **S7** | 蓝本设计器 · **第 12 项「Agent 编排」** + 【模型策略】三档 | 蓝本设计器（归 02-tpl） | F50 F57 | **未建** |
| **S8** | 项目 · 成果沉淀 → **审计与反馈**（四类事件同一条时间线） | `/projects/[id]`（成果沉淀区） | F60 | **未建**（⚠ 原型里**存在**，D-34「已存在，别搬走」；本仓未建） |
| **S9** | 后台 · **组织级审计检索屏**（按项目/人/时间 + 导出） | `/admin/audit`（建议） | F60 | **未建**（⚠ **原型中就不存在**，D-34 新引入，**需从零补画**） |
| **S10** | 对话屏 · **与单个 agent 的私聊面板**（右侧滑出） | `/chat`（滑出面板） | F59 | **未建**（⚠ 对话屏已完整探明，**无任何私聊入口**——需从零补画） |
| **S11** | 主持台 · **AI 团队编排区**（当前载入了谁 / 为什么 / 下一步换谁） | 主持台全场视图 | F57 | **未建**（⚠ 主持台已完整探明，**无此区块**——需从零补画） |

**已建成 5 块 / 未建 6 块。** 未建的 6 块里，**S8 是「原型有、本仓没建」，
S9 / S10 / S11 是「原型里本来就没有」——性质不同，补法也不同**（前者补实现，后者要先补设计）。

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

## 三、截图清单（待补）

> 约定文件名放 `phases/phase-01-run-a-project/ui-preview/<slug>.png`。
> 七态请用预览开关拍：`?state=loading|empty|invalid|dep-failed|denied|success`。

| # | 文件名 | 拍什么 | 对应屏 |
|---|---|---|---|
| 1 | `ui-preview/admin-model.png` | 模型管理列表：两个分组 + 筛选 + 状态 + 行操作 + 两条组说明 | S1 |
| 2 | `ui-preview/admin-model-test.png` | 五项测试判读面板（**同时暴露缺口 3**：只有勾选，无三选 + 证据） | S1 |
| 3 | `ui-preview/admin-model-disable.png` | 停用二选一确认框 + 影响范围「N 个进行中的调用」+ 理由必填 | S1 |
| 4 | `ui-preview/admin-mcp.png` | MCP 五列清单 + `已隔离 · 待安全评审` 行 + **安全策略四开关区** | S2 |
| 5 | `ui-preview/admin-mcp-tools.png` | 「N 工具」展开的工具清单（白名单编辑器的数据源） | S2 |
| 6 | `ui-preview/admin-agent.png` | Agent 列表三态（运行中 / 草稿含阻断文案 / 待审核含门禁文案与越权申请数） | S3 |
| 7 | `ui-preview/admin-agent-definition.png` | `[查看定义]` 六段并列（**暴露缺口 14**：无「数据范围」「最近试跑」两列） | S3 |
| 8 | `ui-preview/admin-overview-anomaly.png` | 数据总览「异常待处理」两条告警 + `[查看调用链]` 下钻 | S4 |
| 9 | `ui-preview/chat-approval-confidential.png` | 批准卡「含机密，仅本地模型」+ `[改]` 面板候选收窄 + 调用链 Ava → Ledger | S5 |

⚠ 另建议补两张**空态**：`admin-model-empty.png` / `admin-agent-empty.png`——
原型每屏都填满样例数据、**零空态**，而本束有 6 条验收线索直接考空态
（20-1 V9、20-2 V11、21-1 V13、21-2 V14、4-1 V12、4-2 V13、4-3 V10、4-4 V15）。

未建的 6 块屏（S6–S11）**无截图可拍**，它们是缺口不是遗漏——见下一节与 `coverage.md` 缺口清单。

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

1. **截图到齐了吗** —— 没到齐这一节不能签（本文顶部的红字）。
2. **已建成的 5 块屏，信息架构对不对** —— 尤其 S3 的三态行（运行中 / 草稿含阻断文案 /
   待审核含门禁文案与越权申请数）与 S2 的四开关区（第 3 条只读常开、第 4 条只读常关）。
3. **未建的 6 块屏，缺口性质分清了吗** —— S8 是「原型有本仓没建」（补实现）；
   **S9 / S10 / S11 是「原型里本来就没有」（要先补设计，再补实现）**。
   后三块压着约 25 条验收线索，是本束第 ① 件最大的风险。
4. **S-01 / S-06 / S-13 三条实现者替 UC 做的决定，你认可吗** —— 尤其 **S-01**，
   它不是界面问题，是**后端拦截规则**问题。
