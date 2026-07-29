# 契约束 `interview` — ① UI（签核第一件）

> # ⚠ 这一件**当前不具备签核条件**
>
> `phases/phase-01-run-a-project/ui-preview/` 下**只有三份 markdown，没有任何截图**
> （`README.md` / `PROTOTYPE-DIGEST.md` / `README-files.md`）。
> ADR-023 决策一要求第 ① 件「引用 `ui-preview/` 截图与组件落点」——**截图待 ui-prototyper 产出后补**。
>
> 在截图补齐之前，人类**只能**签核第 ② 件（用例）与第 ③ 件（API 契约）。
> ⚠ 但 `design-signoff.md` 的 `status` 是**整份文件一个布尔**，没有分节状态位——
> 也就是说「三件里有一件没材料」这件事，**磁盘上没有任何机械保护**，全靠人在这里看到这行字。
> 这与 ADR-023 决策一「不接受沉默的第三种情况」是同一类问题，建议在一致性复核时一并提。
>
> ⚠ 另有一名 agent **正在并行为 itv 画 UI 原型**。本文件写的是**需求侧的屏清单与已建成现状**，
> 不是原型产出物本身；原型落地后请回填「截图清单」一节。

---

## 一、本束需要哪几块屏

现状栏的判据：**代码库里有没有对应路由/组件**（`apps/web/app/**`、`apps/web/components/**`）。

| # | 屏 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| **U-1** | **访谈 Studio 列表与范围切换器**（含两个标签页、筛选、新建入口、详情底栏的 `[挂到项目环节…]`） | `/studio/interview`（列表态）或 `/studio/interviews` | F80 F81 | **未建** —— 现有 `/studio/interview` 直接是**现场主屏**，没有列表层 |
| **U-2** | **访谈模板库列表 + 模板编辑器 + 抽取草案确认** | `/studio/interview?tab=templates` | F82 F83 | **未建**（ui-preview README 第四节已明确列为「未建的屏」） |
| **U-3** | **三步新建向导**（选模板 → 选对象 → 生成提纲） | `/studio/interview/new` | F84 | **未建**（同上） |
| **U-4** | **研究设计屏**（上下文三要素 + 大纲编辑器 + 研究计划参数面板） | `/studio/interview/[id]?tab=design` | F84 F85 | **未建** —— README 原文：「研究问题以覆盖度面板形式出现在现场屏，**无独立屏**」 |
| **U-5** | **受访者授权页**（四项独立勾选 + 降级文案 + 数据控制方区块） | `/consent` | F86 F87 | **已建，但口径与 UC-6.3 冲突**（见下文 §三 C-3，**最需要人类先看的一处**） |
| **U-6** | **研究员侧受访者名单与只读镜像**（同意书三态 + 关系拆场 + 本场角色 + 七开关） | `/studio/interview/[id]?tab=subjects` | F87 F88 F89 | **未建** |
| **U-7** | **现场记录三栏**（状态条 + 左提纲 / 中在场与转录 / 右副驾驶 + 下逐字稿） | `/studio/interview` | F90 F91 F92 | **部分已建**（见 §二） |
| **U-8** | **洞察与报告**（单场复盘 / 主题与证据矩阵 / 研究报告草稿） | `/studio/interview/[id]?tab=insights` | F93 F94 F95 | **部分已建** —— 只有一个回流卡片 `itv-insights`，**证据矩阵整块未建** |
| **U-9** | **受访者自助门户**（当前同意位 + 渲染快照 + 三动作区 + 请求进度 + 删除确认页） | `/portal`（或复用 `/consent` 的已提交分支） | F96 | **未建** —— `/consent` 的撤回块是雏形，但没有「改选择 / 要副本 / 请求进度」三块 |
| **U-10** | **项目组卡内的观察/访谈对象表**（六列 + `[AI 建议人选]` 候选卡 + 预约草稿） | `/projects/[id]`（项目筹备 · 定题与分组 · 组卡展开） | F97 F98 F99 | **未建** |
| **U-11** | **撤回五步流水线与影响范围**（两级 SLA 可视化） | `/consent` 与 `/studio/interview` 两处入口 | F89 F96 | **已建（演示态）** |

> ⚠ **11 块屏里 7 块完全未建、2 块只建了一部分**。这不是遗漏，是 phase-01 UI 先行只做了
> 「R8 指定的主屏」（现场记录）。签核 UI 这一件之前，**至少 U-5 的口径冲突必须先裁**——
> 它已经被实现进 mock 了，越晚改代价越大。

---

## 二、已建成部分的真实落点（核实过的代码路径与 `data-testid`）

### `/studio/interview` —— 现场主屏（U-7 / 部分 U-8）

```
apps/web/app/studio/interview/page.tsx            三栏骨架 + 解析 ?state / ?as / ?org / ?view
apps/web/components/interview/interview-outline.tsx    左栏 · 提纲（118 行）
apps/web/components/interview/interview-stage.tsx      中栏 · 在场与逐字稿（508 行）
apps/web/components/interview/interview-copilot.tsx    右栏 · 副驾驶（176 行）
apps/web/components/interview/interview-view-switcher.tsx  场景角色预览轴
apps/web/lib/mock/interview.ts                    ⚠ 手写 mock（应从契约生成，见 §三）
```

真实 `data-testid`（`grep -rn "data-testid" apps/web/components/interview`，逐个核对过）：

| 区域 | testid | 对应验收 |
|---|---|---|
| 视角轴 | `itv-view-switcher` · `itv-view-{researcher,facilitator,groupLead,observer,interviewee}` | 各 UC 的 V-权限态（⚠ **预览手段，不是权限实现**） |
| 状态条 | `itv-session-header` · `itv-auth-badge` · `itv-auth-panel` · `itv-auth-count` · `itv-realtime-bar` | uc-6-3/V1 · uc-6-4/V6 V12 |
| 授权四项 | `itv-tracks` · `itv-track-<id>` | uc-6-3/V1 ⚠ **id 集合与 UC 冲突**（C-3） |
| 左栏提纲 | `itv-outline` | uc-6-4/V2 |
| 右栏副驾驶 | `itv-copilot` · `itv-followups` · `itv-followups-denied` · `itv-coverage-summary` | uc-6-4/V3 V4 · uc-6-4/V1 |
| 逐字稿 | `itv-transcript` · `itv-transcript-search` · `itv-readonly-banner` · `itv-seg-<id>` · `itv-tc-<id>` | uc-6-4/V7 V9 |
| 段落标注 | `itv-overlap-<id>` · `itv-overlap-assign-<id>` · `itv-overlap-pick-<id>-<cid>` · `itv-overlap-keep-<id>` · `itv-dispute-<id>` · `itv-dispute-note-<id>` · `itv-quote-<id>` · `itv-moment-<id>` · `itv-decision-<id>` | uc-6-4/V7（⚠ 实现属 05-rec 束） |
| 段落操作 | `itv-assign-<id>` · `itv-assign-pick-<id>-<sid>` · `itv-mark-quote-<id>` · `itv-mark-moment-<id>` | uc-6-4/R3 步骤 8 |
| 音频 | `itv-audio-scrubber` · `itv-audio-reset` | uc-6-4「点时间码跳回音频」 |
| 保留期 / 代称 | `itv-retention` · `itv-alias-note` | uc-6-2/V4 · uc-6-3/AC3 署名替代口径 |
| 回流洞察 | `itv-insights` | uc-6-5/V1（⚠ 只是卡片，**矩阵未建**） |
| 受访者自视图 | `itv-interviewee-self` · `itv-withdraw-self` · `itv-withdraw-submit` · `itv-withdraw-confirm` · `itv-withdraw-back` · `itv-withdraw-impact` · `itv-withdraw-ack` · `itv-withdraw-commit` · `itv-withdraw-cancel` · `itv-withdraw-done` | U-9 雏形 · uc-6-6/V1 V2 |
| 撤回影响 | `itv-withdrawal-impact` · `itv-withdrawal-quotes` · `itv-withdrawal-decision` | uc-6-3/V7b · uc-6-6/V7 |

### `/consent` —— 受访者同意书（U-5 / U-11）

```
apps/web/app/(entry)/consent/page.tsx
apps/web/components/entry/consent-form.tsx
apps/web/lib/mock/entry.ts                        ⚠ 手写 mock，且与 interview.ts 的四项不一致
```

`consent-header` · `consent-body` · `consent-item-<id>` · `consent-check-<id>` ·
`consent-confirm` · `consent-decline-all` · `consent-controller` ·
`consent-withdraw-entry` · `consent-withdraw-open` · `consent-withdraw-panel` ·
`consent-withdraw-flow` · `consent-withdraw-step-<no>` · `consent-withdraw-ack` ·
`consent-withdraw-confirm` · `consent-withdraw-back` · `consent-withdraw-cancel` · `consent-withdraw-done`

⚠ `/consent` 屏在 ui-preview README 的对照表里挂的 UC 是 **UC-1.2 + D-13**（组员入口），
**不是 UC-6.3**。也就是说：**本束最合规敏感的那一屏，是照着另一个 UC 建的。**

### 七态与预览开关（已有的门控资产，本束可直接复用）

- 七态：任意屏加 `?state=loading|empty|invalid|dep-failed|denied|success`，
  已写进 `scripts/verify-ui-states.sh`（18 屏 × 6 态 = 108 格）。
- 三个预览开关（`?state=` `?as=` `?view=`）**在生产构建下不可达**，由 `scripts/verify-prod-gates.sh` 断言。
  ⚠ 这条很重要：`?view=observer` 看起来像权限，**它不是**——本束每条 V-权限态都必须有**服务端**断言。

---

## 三、ui-preview 三份 markdown 里与本束相关的已知缺口

> 这些是 ui-preview 自己声明的「**UC 没写、由实现者替 UC 做了的决定**」，逐条摘出。

| ID | 内容 | 本束的判断 |
|---|---|---|
| **S-03** 🔴 | **访谈/问卷的角色（研究员 / 受访者 / 参与者）不在 `ProjectRole` 四值枚举里**，实现另开 `?view=` 预览轴 | **必须先裁**。本束 8 份 UC 的 V-权限态全部依赖这些角色；`?view=` 是预览不是权限，落不成断言。与 S-02（合规负责人缺位）合并裁决 —— 见 coverage 缺口 **G-2** |
| **S-05** 🔴 | **撤回五步的两个 SLA 是推断补的**：D-13 档案只给了 01「即时」、04「需人工」、05「30 天内」，实现按 D-15 推断补了 02「≤5 分钟」、03「即时」 | ui-preview 自评「**合规风险最高的一处**」。本束 F89/F96 的核心验收就是这两级 SLA，**需合规确认或给出真实 SLA** |
| **S-09** 🔴 | **受访者授权「3/4」的四项拆法**：实现选了 `录音✓ / 转写✓ / 引述✓ / 内部复用✗` | ⚠ **这套四项正是 UC-6.3 开头点名说「是错的」的旧版本。** 人类已于 2026-07-27 拍板改为 `录音 / 转成文字稿 / 交给 AI 分析 / 报告中署名与职务`。**代码没跟上裁决。** 更糟的是 `/consent` 屏只有**三项**（`录音 / 转文字稿 / 实名引用`），全仓共**三个互相冲突的版本** —— 见 coverage 缺口 **C-3** |
| **S-10** 🟠 | **代称格式**：小组工作台用「参与者 B（你）」，访谈侧用「某物流园区运营总监」；手机号一律掩码 `138 •••• 2049` | 掩码格式可用（对齐 O-39）；**代称生成规则仍是 domain 的 [待定 D-7]** |
| **S-11** 🟡 | **观察者在访谈现场看到多少**：实现选了「不硬拒，转录只读 + 说话人掩码到角色标签 + 显式横幅」 | 与 uc-6-4/R5「观察者只读脱敏结果」一致，但 uc-6-3/R5 另写「观察者**永远看不到**未脱敏原文与联系方式」——两条能否共存需确认 |
| **S-12** 🟡 | **丢弃清单的 7 类原因是发明的**（`已撤回 / 时效过期 / 低置信 / 无授权 / 预算截断 / 去重 / 越出范围`），会成为 Context Pack 的 `omissions[].reason` 枚举 | 本束的 `buildInterviewContextPack` **直接消费它**。⚠ **本束不得再造一份排除原因词汇**（coverage X-6） |
| **S-16** 🟡 | **重叠语音「待人工指派」的力度**（O-13）：无默认选中 + 明写「系统不自动归属」+ 有「保持待指派」退出口 | 对齐 uc-6-4/V7 的两类标注；实现属 05-rec 束（coverage X-3） |
| **S-18** 🟡 | 合规邮箱 `compliance@yuanyang-consulting.cn` 是**占位值**，UC 只写「合规邮箱」没给值 | uc-6-3/V5 要求「三项随项目参数变化」——占位值必须换成真实项目参数，否则 V5 验收是假的 |
| **未建清单** | README 第四节明确列出：**UC-6.1 新建访谈模板未建**、**UC-6.2 研究设计/大纲未建** | 与本文 §一 的 U-2 / U-3 / U-4 一致 |

### 另一条 ui-preview 没说、但本束必须提的

`apps/web/lib/mock/interview.ts` 与 `apps/web/lib/mock/entry.ts` 都是**手写 mock**。
`contract-design.md` 的硬规则第 2 条写着「**不许手写 mock —— 从契约生成**」，
理由正是本仓已五次因「同一事实两处声明」漂移。**C-3 就是第六次，而且已经发生了。**
签核后开工的第一件事应该是：建 `packages/contracts/src/interview.ts`，
把 `ConsentKey` 定成单源，两份 mock 都从它生成。

---

## 四、截图清单（**待补** —— ui-prototyper 产出后回填）

约定文件名（放 `phases/phase-01-run-a-project/ui-preview/`）：

| 屏 | 截图文件名 | 至少要拍到什么 |
|---|---|---|
| U-1 | `ui-preview/itv-studio-list.png` | 范围切换器两档 + 两个标签页 + 虚拟条目强标记 + 真人/虚拟分列计数 |
| U-2 | `ui-preview/itv-template-library.png` | 五要素行 + `[编辑]` `[用它新建]` + 空态两出口 |
| U-3 | `ui-preview/itv-new-wizard.png` | 三步进度 + 每步可返回不丢内容 |
| U-4 | `ui-preview/itv-research-design.png` | 页头 `AI 已按目标生成 · 待你确认` + 三要素 + 段落两层结构 + 研究计划参数四行 |
| U-5 | `ui-preview/itv-consent-page.png` | **四项**独立勾选 + 两条降级文案 + 数据控制方三项 + `[全部拒绝]` 与 `[确认并进入访谈]` **同等权重** |
| U-6 | `ui-preview/itv-subject-roster.png` | 同意书三态列（**无勾选控件**）+ `已拆场` 标签 + 七开关（第七默认关） |
| U-7 | `ui-preview/itv-live-stage.png` | 状态条三行 + 三栏 + 下栏逐字稿五种标注 + 私下提醒块 |
| U-8 | `ui-preview/itv-evidence-matrix.png` | 五种格子**五种可辨识视觉**（`附和` 与 `反例` 不能长得像 `弱`）+ 头部 `N 场 · M 位` |
| U-9 | `ui-preview/itv-subject-portal.png` | 三动作区并列 + 请求进度 + 删除确认页四段说明 |
| U-10 | `ui-preview/itv-subject-table.png` | 六列 + 掩码联系方式 + 候选卡三出口 |
| U-11 | `ui-preview/itv-withdrawal-flow.png` | 五步 + 两级 SLA + 「证据已撤回」段落**仍在** |

⚠ 可达性要求（uc-6-3/R8 · uc-6-5/R8）：U-5 与 U-9 面向**外部非注册用户**（可能年长、用手机、需字幕），
**文案不得依赖悬浮提示**；U-8 的五取值配色需过**色盲**可辨识度检查。

---

## 五、签核这一件前请确认

- [ ] **截图尚未产出** —— 在 `ui-preview/*.png` 补齐前，第 ① 件**没有材料可签**。确认是否接受「先签 ②③、UI 单独补签」。
- [ ] **U-5 的四项口径（S-09 / C-3）** —— 全仓三个版本，且已建成的界面里**根本没有「交给 AI 分析」这一项**，
      而 O-05 的全部合规约束都挂在它上面。这一条不裁，F86–F88、F93、F95 全部无法验收。
- [ ] **场景角色是否需要独立一层（S-03 / G-2）** —— 不裁则本束 8 条 V-权限态无处落地。
- [ ] **11 块屏里 7 块未建** —— 确认这些屏由并行的 ui-prototyper 补，还是随各 feature 开工时建。
