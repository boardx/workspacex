# 03-skill · UI 先行原型截图与 sign-off 说明

> ADR-003 / ADR-023 签核第 ① 件的材料。**能力域 `skill`（Skill 能力包），8 feature / 31 点。**
> 路由：**顶层 `/skill`**（并行安全）。代码：`apps/web/app/skill/page.tsx`
> ＋ `apps/web/components/skill/*`（6 屏组件 + `skill-shared.tsx`）
> ＋ `apps/web/lib/mock/skill.ts`（纯 mock，不接后端）。
>
> 截图用真实组件跑 `next dev`（视口 1360×900，2×）抓的，**不是设计稿**。
> 每屏可点、可切屏/视角/七态；抓图时 **0 条真实控制台报错**（仅被沙箱拦掉的 Google 字体请求，非致命）。
>
> ⚠ **我没有改任何 `ui-signoff.md` / `design-signoff.md` 的 status。** 那是人类的动作。
> 下面「待确认清单」是给 sign-off 用的，不是已确认结论。
>
> ⚠ 复用/未另造：`packages/contracts/src/identity.ts` 的 `CapabilityListing`（前端投影经 `lib/identity.ts`）、
> 七态共享 `components/state/state-shell.tsx`、三栏骨架 `components/shell/app-shell.tsx`、
> 四视角切换心智（沿用 rec/files 的 `?as=` 预览手段）。
> `apps/web/lib/mock/skill.ts` 已申报进 `apps/api/tests/kernel/no-builtin-capability-lists.test.ts`
> 的 `DECLARED_MOCK_DEBT`（「phase-01 skill 域 UI 先行」）——它含 skill 清单条目，是被门控计数的债务。

---

## 一、截图清单 —— 每张对应哪份 UC 的哪一节、哪些 feature

每屏都覆盖**七种必现状态**（default / loading / empty / invalid / dep-failed / denied / success），
文件名 `<uc>-<屏>-<状态>.png`。下表列主屏与关键交互/视角态，七态不逐张重列。

| 屏（默认态截图） | UC 节次 | feature | 关键点 |
|---|---|---|---|
| `uc-3-1-library-default` | UC-3.1 R3/R7/R8 | F61 F62 | Skill 库、四态状态机、来源标记、双门禁待审核行（安全扫描/方法论审核并排）、自审自批禁用 |
| `uc-3-1-library-editor` | UC-3.1 R8「真·未探明补抽取」 | F61 | 新建 skill 三段契约编辑器（模板/io schema/数据范围声明） |
| `uc-3-1-library-contract-viewer` | UC-3.1 R8 `[查看内容]` | F61 | 只读契约三段并列 |
| `uc-3-1-library-tryrun-fail` | UC-3.1 R7 试跑不符 schema | F62 | 试跑不入库 + 失败原因 + 可复制日志（**试跑入口=原型确认缺失，补画**） |
| `uc-3-1-library-facilitator` | UC-3.1 R5 引导师 | F61 | 只读浏览已启用 skill（视角投影） |
| `uc-3-1-library-member-denied` | UC-3.1 R5 组员 | F61 | 组员库不可见（视角投影） |
| `uc-3-2-binding-default` | UC-3.2 R3/R7/R8 | F63 F64 | 环节×三角色矩阵、混合槽可区分（skill/画布模板/agent 产物）、每格生成待办、来源版本 |
| `uc-3-2-binding-rebind` | UC-3.2 R3 步 3「真·未探明补抽取」 | F63 | 绑定槽编辑态 + 可绑定池（已启用∩可见性覆盖） |
| `uc-3-2-binding-saveas-dialog` | UC-3.2 R7 / O-03 | F63 | 另存为组织模板 · 主持人确认、不回写 |
| `uc-3-2-binding-orphan-dialog` | UC-3.2 A1/A3 AC6 | F64 | 切模板列出被孤立绑定、确认前不执行、不静默丢弃 |
| `uc-3-2-binding-member` | UC-3.2 R5 组员 | F64 | 画布左栏只读投影（有触发入口无增删改） |
| `uc-3-2-binding-observer` | UC-3.2 R5 观察者 | F64 | 可见环节结构、不可见绑定清单（视角投影） |
| `uc-3-3-temp-default` | UC-3.3 R3/R8 | F65 | 对话运行时配置带、临时挂载角标、摘掉不回溯 |
| `uc-3-3-temp-picker` | UC-3.3 R8「原型确认缺失，补画」 | F65 | ＋加技能选择器分两段（已绑定只读 / 可临时加载） |
| `uc-3-3-temp-member` | UC-3.3 E1 | F65 | 组员看不到＋加技能、直连接口被服务端拒 |
| `uc-3-4-versioning-default` | UC-3.4 R3/R8 | F66 | 版本链时间线、升级提示不阻断、危险动作分离 |
| `uc-3-4-versioning-disable-dialog` | UC-3.4 R8 停用确认 | F66 | 引用清单三栏嵌入对话框（进行中项目/蓝本/agent） |
| `uc-3-4-versioning-harddelete-dialog` | UC-3.4 R3 | F66 | 硬删永久拒绝 + 返回引用清单 + 内置不可删 |
| `uc-3-5-promotion-default` | UC-3.5 R3/R8 | F67 | 晋升队列（触发端示意）、生成回执待审核、「来自组织大脑」区块 |
| `uc-3-5-promotion-approve-dialog` | UC-3.5 R8「真·未探明补抽取」 | F67 | 批准确认面板 + skill 草稿预览 + 同时生成 skill 勾选 |
| `uc-3-6-feedback-default` | UC-3.6 R3/R8 | F68 | 采集侧 👍/👎（补画）、聚合队列归类分流、闭环指标、无法归因说明 |
| `uc-3-6-feedback-diff` | UC-3.6 R8「未探明补抽取」 | F68 | 契约改进提案左右 diff、人工复核不自动上线、触发发新版 |

### 预览怎么走
预览控制条（仅 dev，生产 `NODE_ENV=production` 不渲染）三行：
- **屏** `?screen=`：library / binding / temp / versioning / promotion / feedback
- **视角** `?as=`：maintainer（能力维护者）/ reviewer（方法论审核人）/ facilitator / groupLead / member / observer
  ——组织级职能（前两者）与四项目角色并列；视角切换是**预览手段，真实权限在服务端 RLS**。
- **七态** `?state=`：走共享 `StateShell`，保留 testid `loading/empty/err-*/dep-failed/denied/saved`。

每个可交互元素与关键展示区都带 `data-testid`（`skill-*`），命名遵循 uiux-standards，供后续 verification 锚定。
这是与旧原型（零 testid、零异常态、纯 happy path）最大的差别。

⚠ **两种「拒绝」在界面上刻意分开**：七态里的 `denied`（testid `denied`）是「服务端拒绝了这次请求」；
视角投影里的 `skill-role-denied` 是「切到这个预览视角时界面本就不该出现」。二者渲染不同、不可混用。

---

## 二、界面上**无法自洽**的点（sign-off 必须先裁）

1. **🔴 「议程环节」命名四名并存，我没挑一个用。** `stepId` / `stage.*` / `agenda_stage` / `agenda_segment`
   （已签契约 + 已落库 + 人类拍板 D-03 + phase-01 需求，见 00-project/OPEN-QUESTIONS.md Q-3）。
   本原型 mock 用中性 `segmentRef` 承载、界面文案统一「议程环节」，并在**每个绑定屏右栏 + 矩阵表头旁**
   显式标注「命名待裁决 → Q-3」。**这是契约裁决，不该由 UI 单方定**——F63/F64 的绑定条目模型
   （`环节ID × Skill × 版本 × 角色 × 触发方式`）写不出稳定字段名，直到 Q-3 落。

2. **🔴 UC-3.5「方法晋升生成」与 phase-03「组织大脑」的边界，UC 未写清。** 触发端 14-brain 在 phase-3（D-24），
   本 phase 只做接收端（R10 处置②）。我在 promotion 屏顶部放了**边界待裁决横幅**，并把晋升队列标为
   「触发端示意 · 非本 phase 交付」。**哪些字段/门禁属 phase-1 接收端、哪些留给 phase-3 触发端，
   边界需人类裁决**——否则 F67 的「双向关联」两头都可能各建一份副本。

3. **来源标记 / 四态 / 版本链 / 满意度 / 引用枚举都不在契约里。** `CapabilityListing` 只有
   `id/orgId/kind/name/scope/enabled/endpoint/disabledReason`，**没有 `source`/`status`/`version`/
   `satisfaction`/`references`**。这些是 skill 域新增形状，目前只活在 `lib/mock/skill.ts`（已注明「待迁入
   packages/contracts」）。**若各 feature 落地时后端各写一份 DTO，就是 ADR-020 要防的漂移**——建议先补契约。

4. **满意度最小样本量数值未定（O-37）。** 界面已把「低于样本量显示『样本不足』而非百分比」这条**结构**做实
   （mock 里 `MIN_SATISFACTION_SAMPLE=20` 是占位），但窗口期与阈值数值待产品确认。看
   `uc-3-6-feedback` 与 library 满意度列。

---

## 三、我替 UC 做了哪些它没写明的设计决定（人类逐条看）

1. **组织级职能（能力维护者/审核人）与四项目角色并入同一个视角切换器。** UC 各 R5 把审核人称作
   「[设计] 新增角色，五角色里没有对应项」。我没有把它做成第五种项目角色（那会撞 O-03），而是在
   **预览视角**层把它当组织级职能（`viewToProjectRole` 映射为 null，顶部条显示「项目角色不适用」）。
   这是预览手段的取舍，**不是权限实现**。

2. **「补画」与「补抽取」两类缺口用不同视觉标记显式区分。** 凡 R8 标为「原型确认缺失/新增设计」的元素
   （试跑入口、＋加技能入口与选择器、停用/恢复入口、评价控件、diff 页、来自组织大脑区块）都挂
   `补画 · xxx` 黄标（testid `skill-newscreen-tag`）；「真·未探明补抽取」的（契约编辑器、查看内容、
   版本区块、批准确认面板）照 R8 直接画出。**哪些接受、哪些改，是 sign-off 的核心。**

3. **待审核行的两道门禁结论并排成独立 Badge**（R8[设计]），并按 `securityScan`/`methodReview` 分别取色，
   让审核人一眼看到卡在哪道。自审自批用**按钮 disabled + 红字说明**呈现（维护者视角）。

4. **混合槽三类用不同 Badge 色 + 前缀标签**（skill=primary / 画布模板=outline / agent 产物=ai），
   在界面上兑现「数据模型可区分，不糊成字符串」（F63 [设计]）。

5. **危险动作（停用/硬删/切模板）一律走带影响范围的确认对话框**，不是孤立红按钮：停用嵌三栏引用清单、
   硬删返回引用清单并说明内置不可删、切模板列孤立绑定。

6. **feedback 归类徽标决定 `[生成 skill 改进 PR]` 是否出现**（契约可解→有；实现层/模型所限→只给软件反馈通道），
   把 O-35「结构性判据不用相似度打分」的后果画进按钮可见性。

7. **社区导入入口置灰**（D-06 phase-1 不实现），保留 `source=community` 取值但按钮 disabled + title 说明。

---

## 四、R8 线索之间相互矛盾 / 我怎么处理的

- **UC-3.1 R8 说 skill 只有「已启用/待审核」两态，但 O-11 要求恰四态。** 我按 O-11 补齐 `草稿`/`已停用`
  两态（`已归档`不单列，是 disabled 呈现变体），四态在 library 列表与 versioning 都可见；`SKILL_STATUSES`
  枚举里**不存在「已发布」**。
- **UC-3.4 R8 早稿写「已归档 与 已停用 两态」，已被 O-11 收敛为一态。** 版本链用 `live/archived/draft` 表达
  版本节点状态，与 skill 的四态状态机是**两个维度**（版本状态 vs skill 状态），界面上分开呈现避免混淆。
- **UC-3.2 AC1「切环节 skill 自动换」出自 Backlog，原型未直接呈现。** 我把它画进「运行时投影」区并挂
  `补画` 标，不把它当已确认行为。

---

## 五、明确没做的部分（本原型不覆盖）

- **后端逻辑一律没写**：契约校验、安全扫描、双门禁转移、越权检查、RLS、待办同步、归因链计算、
  版本快照、脱敏闸门——全部是 feature 实现阶段的事，这里只有 mock 与界面投影。
- **别的能力域的宿主屏**：对话线程本体（08-chat）、画布本体（07-canvas）、议程编辑器（02-tpl/UC-2.2）、
  任务看板流转（11-board）、组织大脑触发端（14-brain/phase-3）、模型路由（20-model）——只画了
  skill 在这些屏上的**投影/接缝**（如画布左栏只读清单、对话配置带），不画宿主。
- **响应式仅抓 1360 桌面档**：AppShell 有 375/768/1280 断点，本次未逐档抓图。
- **社区导入信任模型、灰度发布**：D-06/phase-2 范围，未做。
- **未接真实模型/向量库**：试跑、提案生成、满意度都是 mock 结果。
