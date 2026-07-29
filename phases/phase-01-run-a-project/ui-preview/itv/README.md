# UI 先行原型 · `itv`（访谈）能力域 —— ADR-003 关卡材料

> 目的：让人类在 `feature_list.json` 的 20 个 itv feature（68 点）被当作权威**之前**，
> 先看到真实、可点、带异常态的界面，把方向分歧暴露在写后端代码之前。
> 本目录只有截图与本说明；**没有改任何 `requirements/`、`feature_list.json`、
> `ui-signoff.md` / `design-signoff.md` 的 status**——签核是人的动作。

用真实组件（`apps/web` 内核 + 设计 token + mock）搭建，`pnpm --filter web lint`（含
`lint:design` / dead-controls）、`typecheck`、`vitest` 全绿。dev server 起在 3111 逐屏截。

---

## 一、路由与信息架构（对齐 UC-6.0 R8，纠正原「项目 → 用户访谈」的虚构归属）

访谈 Studio 是**一等对象、独立发起、不依赖项目**，不是项目的下级：

```
/studio/interview                     UC-6.0 列表 + 范围切换器 + 两标签(访谈 / 访谈模板)
  ?scope=rp-procurement|unassigned    范围（project_id 可空；「不属于任何项目」是一等档）
  ?tab=interviews|templates           访谈模板标签 = UC-6.1 模板库
/studio/interview/[id]                访谈详情 · 六标签(?tab=)
  ?tab=design        研究设计          UC-6.2
  ?tab=respondents   受访者            UC-6.3 屏B（研究员侧只读镜像）+ UC-6.7 访谈侧投影
  ?tab=virtual       虚拟              phase-3 占位（本阶段不实现）
  ?tab=expert        专家推演          phase-3 占位
  ?tab=record        记录              UC-6.4 现场记录（复用既有三栏 InterviewStage）
  ?tab=insight       洞察与报告        UC-6.5
```

⚠ **原 `/studio/interview` 直接进「现场记录」是错的 IA**——UC-6.0 要求它先是**列表**。
本次把列表设为落地屏，现场记录移进 `[id]?tab=record`。既有 UC-6.4 组件
（`interview-stage/outline/copilot`）**原样复用**，只是换了挂载点。

七态经 `?state=`，角色视角经 `?view=`（researcher/facilitator/groupLead/observer/interviewee）。
**视角切换是预览手段，不是权限实现**——真实权限在服务端。

---

## 二、每张截图对应哪个 UC 的哪一节

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-6-0-列表-*` | 访谈 Studio 列表 + 范围切换器 | UC-6.0 R3/R8 | 七态全 + `范围不属于任何项目` + `移动端375` |
| `uc-6-0-详情-虚拟标签占位` | 详情「虚拟」标签 | UC-6.0 R6（范围外声明） | default |
| `uc-6-1-模板库-*` | 访谈模板库 | UC-6.1 R3/R8 | default/empty/invalid/dep-failed/denied/success |
| `uc-6-2-研究设计-*` | 研究设计（三步向导头 + 大纲 + 研究计划参数） | UC-6.2 R3/R8 | 七态全 + `观察者视角` |
| `uc-6-3-受访者名单-*` | 受访者名单与角色 + 七开关 + AI 建议人选 | UC-6.3 屏B / UC-6.7 访谈侧 | 七态全 + `观察者视角` |
| `uc-6-4-记录-*` | 现场记录三栏（复用既有） | UC-6.4 / UC-5.x | default/dep-failed/denied + `观察者视角` + `受访者视角` |
| `uc-6-5-洞察与报告-*` | 主题×证据矩阵 + 写作约束 + 候选洞察 | UC-6.5 R8 | 七态全 |

共 44 张。文件名即 `<uc-id>-<屏名>-<状态/视角>.png`。

### 关键 testid 锚点（供 requirement-author / verification 回溯）
- 列表：`itv-scope-switcher` `itv-scope-{rp-procurement,unassigned}` `itv-studio-tabs`
  `itv-row-{id}` `itv-row-virtual-{id}` `itv-row-unassigned-{id}` `itv-count-split`
  `itv-row-attach-{id}` `itv-row-attach-pick-{id}-{stage}`
- 模板：`itv-template-{id}` `itv-template-usedcount-{id}` `itv-template-use-{id}`
  `itv-template-source-{id}` `itv-template-empty-extract`
- 研究设计：`itv-design-state` `itv-design-confirm` `itv-wizard-trail` `itv-context-{who,situation,decision}`
  `itv-methodology-{id}` `itv-segment-{n}` `itv-segment-rewrite-{n}` `itv-plan-retention` `itv-plan-no-training`
- 受访者：`itv-respondent-{id}` `itv-respondent-consent-{id}` `itv-respondent-reveal-{id}`
  `itv-switch-{id}` `itv-candidate-{id}` `itv-candidate-add-{id}`
- 矩阵：`itv-matrix-cell-{theme}-{col}` `itv-matrix-col-{col}` `itv-matrix-note-toggle-{theme}`
  `itv-constraint-{id}` `itv-matrix-legend-{evidence}`

---

## 三、mock 数据的单一事实源说明（重要）

新增 `apps/web/lib/mock/interview-studio.ts` 集中承载列表 / 模板 / 大纲 / 研究计划 /
名单 / 矩阵的枚举与示例值，文件头标注 **「待迁入 packages/contracts」**。
**没有散落进组件**，避免重演本仓已发生六次的「同一事实声明在两处」。

已**复用而非重定义**的既有单一事实源：撤回链 SLA（`lib/withdrawal-flow.ts`）、
现场转录/授权/洞察候选/研究问题（`lib/mock/interview.ts`）、受访者四项同意位口径
（`lib/mock/entry.ts`）。保留天数（180）以 `RESEARCH_PLAN.retentionParam` 承载并标注
「项目参数 · 材料保留期」，组件只引用，**代码里不写死天数**（UC-6.2 AC4 / O-01）。

---

## 四、⚠ 从 UC 读出来但界面上无法自洽的点（人类签核重点看）

1. **一场访谈能否同时归属研究项目与业务项目？**（UC-6.0 R10 [待确认]）
   原型两处措辞打架：列表范围是「研究项目 · 采购决策如何形成」，而行内所属显示
   「欧洲进入策略」（业务项目）。界面上我**两级并存**地渲染了（范围一个、行内一个），
   但这暗示数据模型是**两个可空外键**（`research_project_id` + `project_id`）还是一个——
   **UC 没定，我没法在界面上自洽**。若最终是单外键，列表行的「所属」列要重画。

2. **范围切换器的完整档位与默认值**（UC-6.0 R8 UI-sign-off / R10 [待确认]）
   只做了原型确证的两档。界面顶部用 `itv-scope-open-question` 显式把
   「是否还需要『全部』『按项目分组』、进来先看哪一档」挂成待裁决条——**这是需要人拍板的**。

3. **质量提示 `N 段还需你改问法` 是否阻断进入现场？**（UC-6.2 R4/E5 [待确认]）
   我做成**仅提示不阻断**（大纲「待确认」闸门才阻断进现场）。但 UC 明确标为待确认——
   若产品要「问法不合格也阻断」，研究设计屏与记录屏的进场按钮联动要改。

4. **模板标签括注「来自 3 场项目」到底是什么语义？**（UC-6.1 R4/A3 [口径降级]）
   它可能是「反向抽取」也可能只是「本库取自 3 个项目」的来源说明。我**赌了「支持反向抽取」**：
   给 extracted 模板加了「从访谈抽取 / 草案 / 溯源链」。若产品说只是来源说明，
   `itv-template-source-*` 与「从已有访谈抽取」出口要撤掉——**这是我替 UC 做的一个可能过度的判断**。

5. **「授权与准备」子标签内部未探明**（UC-6.3 R10）
   受访者标签下这个子标签在原型档案里 0 命中。我**没有臆造**，用 `itv-respondents-prep`
   放了一条「未探明，不臆造」的说明，并指向记录屏已实现的「授权 3/4」口径。需人确认是否要补画。

6. **UC-6.7 的主入口（项目筹备 → 组卡内嵌对象表）没画。**
   我只画了**访谈侧投影**（受访者名单 27 位）。项目筹备侧的「组卡展开对象表 + 未分组
   [AI 按背景分配]」属 `02-tpl`/项目域，跨出 itv Studio；且 UC-6.0 R2 明确它是
   **[原型确认缺失]** 的待补入口。留给项目域原型或后续补画（见「没做的部分」）。

---

## 五、我替 UC / 产品做的、UC 没写明的设计决定（逐条，请人类核对）

- **IA 重构**：把 `/studio/interview` 从「直接进现场」改成「先是列表」。依据 UC-6.0，
  但这是**结构性改动**，请确认。
- **六标签用 `?tab=` 整页导航**（而非前端 tab 切换）：为了 SSR 可锚定 testid、URL 可分享。
- **虚拟/专家推演做成占位屏**（不实现），显式标 phase-3。UC-6.0 R6 支持，但占位文案是我拟的。
- **证据矩阵五取值的视觉编码**：强=实心绿●、弱=◐、未提及=–、附和=虚线框≈、反例=红框✕。
  兼顾色盲（色 + 形双通道）。UC-6.5 UI-sign-off 明确要产品/设计确认可辨识度与配色，**这套是我提的方案**。
- **联系方式遮盖格式**（`138 •••• 2049` / `+49 •••• •••• 41`）与「查看写审计」文案是我拟的；
  UC-6.7 R8 说需**合规**参与确认。
- **列表默认范围 = 研究项目档**（不是「不属于任何项目」）。UC-6.0 R8 说默认值需产品确认——我先默认第一档。
- **AI 建议人选候选卡的三出口文案**（加入表 / 编辑后加入 / 忽略）与「加入时联系方式留空」是我按 R8 [设计] 落的。
- **研究计划参数示例值**（22 场 / 1–3 人 / 同组织≤2 / 60 分 / 90 分 / 保留 180 天）
  全部按原型那一组具体数字渲染；UC-6.2 R10 [待确认] 说要区分「产品默认值 vs 该研究项目取值」——我未区分。

---

## 六、R8 线索之间互相矛盾、我怎么处理的

- **「必问」标记的归属**（UC-6.2 R8 [来源屏更正]）：原型里 `必问` 出现在**记录**屏左栏提纲，
  不在研究设计屏。我**没有**在研究设计的大纲段落加 `必问`，遵从更正后的口径。
- **「用户访谈」区块名**（UC-6.0 R2/R10）：档案 0 命中、属虚构。我**没有**建这个区块，
  访谈入口只从左侧 STUDIO → 访谈 进入。
- **研究计划「四行 vs 五项」**（UC-6.2 R3 步骤7）：按更正后的**四行**做，
  「数据保留 N 天 · 禁止用于训练」是**一行两语义**，不拆成两行。

---

## 七、没做 / 未覆盖的部分（如实说）

- **UC-6.7 项目筹备侧组卡对象表**（主入口）、**未分组 + AI 按背景分配**：未画（跨 itv 域，见上 §4.6）。
- **UC-6.3 屏A 受访者授权页 + UC-6.6 自助门户**：**已有**，在 `app/(entry)/consent` 等
  （`components/entry/*`，属进场/auth 域），本次未重画，未纳入本目录截图。
- **模板编辑器内部面板**（分段/字段编辑的展开态）：`[编辑]` 现跳研究设计屏复用其大纲编辑器，
  未做独立的模板编辑面板（UC-6.1 R10 该面板内部亦「未探明」）。
- **三步新建向导的分步交互**（选模板 → 选对象 → 生成提纲的逐步屏）：只做了
  `?tpl=` 落点与研究设计屏顶部的「向导已完成」回显条（`itv-wizard-trail`），
  **未做**三步逐屏的独立向导 UI。
- **单场复盘子标签**：复用了 UC-6.4 的候选洞察数据，未做独立的单场复盘专属视图。
- **移动端**：只截了列表一张（375）验证不横向溢出；其余屏的移动端降级未逐屏截
  （responsive e2e 已把新路由纳入三档溢出检查）。
- **模板库 `?state=empty`** 走的是共享 StateShell 空态（单出口「新建」）；
  「不预置示例 + 两个出口（新建 / 从已有访谈抽取）」的定制空态在 `EmptyTemplateLibrary`
  组件里（当数据数组真为空时呈现），未接到 `?state=empty` 预览开关上。

---

## 八、建议 sign-off 时**重点核对的 3 处**

1. **§4.1 两级归属（研究项目 + 业务项目）到底是一个外键还是两个**——这决定列表行、
   范围过滤、权限投影，是 F80「范围数据模型」的地基，做错后面 6 个 UC 全返工。
2. **§4.4 模板「来自 3 场项目」= 反向抽取 还是 来源说明**——我赌了前者并画了整条抽取链
   （F83）。若赌错，F83 的一半功能是凭空造的，越早撤越省。
3. **§5 证据矩阵五取值配色 + 联系方式遮盖/查看审计**——UC-6.5 与 UC-6.7 都明确要
   设计/合规参与确认。这两处一个关可辨识度（含色盲），一个关个人数据合规，是硬约束不是偏好。
