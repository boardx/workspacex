# 契约束 `interview` — ① UI（签核第一件）

> **自检行（可机械核对）**：本文件引用 **62 张**截图（**均在 `ui-preview/itv-v2/`**），
> v2 目录下实际 **62 张** —— 两数相等，无遗漏、无多引。
> v1 目录 `ui-preview/itv/` 另有 **44 张**，**已被 v2 推翻、不计入签核**（见 §四·0），
> 本文件**不逐张引用 v1 的任何一张**。
>
> 核对办法（**唯一实现**）：`node .harness/scripts/lint-ui-material.mjs`
> —— 别再手写 grep 去数：本束文件名含中文，`[a-z0-9-]+` 那类正则会返回 0 处命中而看起来「全绿」。
> §四·1 的索引表里**每个文件名恰好出现一次**；§四·3 另有一次正文交叉引用
> （`uc-6-5-洞察报告-default.png`），故全文「引用总次数」为 63、**去重后为 62**。

> # ⚠ 这一件**已有材料，但材料不完整，且经历过一次整体推翻**
>
> **截图已产出**，落在 `phases/phase-01-run-a-project/ui-preview/itv-v2/`（62 张，路由 `/itv`）。
> ADR-023 决策一要求第 ① 件「引用 `ui-preview/` 截图与组件落点」——**这一条现已满足**，
> 逐张索引见 §四·1。
>
> ⚠ **但请先读 §四·0**：同一能力域有**两版**原型。v1（`ui-preview/itv/`，44 张）
> **主线画错、已被 v2 推翻**，仅作留痕保留，**不要照它签核**。
>
> ⚠ **材料仍有空洞**：原设想的 11 块屏里，**5 块 v2 完全没画**（§四·2 汇总）。
> 其中 **U-6 受访者名单**最危险：**v1 画过、v2 没画，而 v1 已被推翻**——
> 等于这块屏**现在没有任何可签的材料**，却不会在截图目录里表现为「缺一张文件」。
>
> ⚠ `design-signoff.md` 的 `status` 是**整份文件一个布尔**，没有分节状态位——
> 「三件里有一件材料只覆盖了一半」这件事，**磁盘上没有任何机械保护**，全靠人在这里看到这段字。
> 这与 ADR-023 决策一「不接受沉默的第三种情况」是同一类问题，建议在一致性复核时一并提。

---

## 一、本束需要哪几块屏

现状栏的判据：**代码库里有没有对应路由/组件**（`apps/web/app/**`、`apps/web/components/**`）。

⚠ **下表的「现状」栏写于 v2 原型产出之前**，判的是**旧路由 `/studio/interview` + `/consent`** 的建成情况。
v2 原型另起顶层路由 `/itv`（组件 `apps/web/components/itv/**`、mock `apps/web/lib/mock/itv.ts`），
把其中若干「未建」的屏画了出来。每行末尾的 `【v2】` 标注即**以 v2 截图为准的最新事实**，
与 §四·1 的索引一一对应；**没有 `【v2】` 标注的行 = v2 也没画 = 第 ① 件的空洞**（§四·2）。

| # | 屏 | 期望路由 | 服务哪几个 feature | 现状 |
|---|---|---|---|---|
| **U-1** | **访谈 Studio 列表与范围切换器**（含两个标签页、筛选、新建入口、详情底栏的 `[挂到项目环节…]`） | `/studio/interview`（列表态）或 `/studio/interviews` | F80 F81 | **未建** —— 现有 `/studio/interview` 直接是**现场主屏**，没有列表层。**【v2】已画**：`uc-6-0-访谈列表-*`（8 张） |
| **U-2** | **访谈模板库列表 + 模板编辑器 + 抽取草案确认** | `/studio/interview?tab=templates` | F82 F83 | **未建**（ui-preview README 第四节已明确列为「未建的屏」）。**【v2】部分已画**：`uc-6-1-模板库-*`（8 张）+ `uc-6-1-报告模板编辑器-*`（7 张）；⚠ **抽取草案确认屏仍未画**（§四·2 G-①） |
| **U-3** | **三步新建向导**（选模板 → 选对象 → 生成提纲） | `/studio/interview/new` | F84 | **未建**（同上）。**【v2】已画**：`uc-6-2-新建向导-*`（9 张，含步骤 1 / 步骤 2） |
| **U-4** | **研究设计屏**（上下文三要素 + 大纲编辑器 + 研究计划参数面板） | `/studio/interview/[id]?tab=design` | F84 F85 | **未建** —— README 原文：「研究问题以覆盖度面板形式出现在现场屏，**无独立屏**」。**【v2】已画**：`uc-6-2-研究设计-*`（7 张） |
| **U-5** | **受访者授权页**（四项独立勾选 + 降级文案 + 数据控制方区块） | `/consent` | F86 F87 | **已建，但口径与 UC-6.3 冲突**（见下文 §三 C-3，**最需要人类先看的一处**）。⚠ **v2 未重画、未纳入截图** —— 第 ① 件对这一屏**没有原型材料**（§四·2 G-②） |
| **U-6** | **研究员侧受访者名单与只读镜像**（同意书三态 + 关系拆场 + 本场角色 + 七开关） | `/studio/interview/[id]?tab=subjects` | F87 F88 F89 | **未建**。🔴 **v1 画过（`uc-6-3-受访者名单-*`，8 张）但 v1 已被推翻；v2 没画** ⇒ **现在没有任何可签材料**（§四·2 G-③，本束最危险的空洞） |
| **U-7** | **现场记录三栏**（状态条 + 左提纲 / 中在场与转录 / 右副驾驶 + 下逐字稿） | `/studio/interview` | F90 F91 F92 | **部分已建**（见 §二）。**【v2】已画**：`uc-6-4-现场记录-*`（8 张，含受访者视角） |
| **U-8** | **洞察与报告**（单场复盘 / 主题与证据矩阵 / 研究报告草稿） | `/studio/interview/[id]?tab=insights` | F93 F94 F95 | **部分已建** —— 只有一个回流卡片 `itv-insights`，**证据矩阵整块未建**。**【v2】已画**：`uc-6-5-洞察报告-*`（8 张，含证据矩阵与「套报告模板出洞察报告」）；⚠ **单场复盘子标签仍未画**（§四·2 G-④） |
| **U-9** | **受访者自助门户**（当前同意位 + 渲染快照 + 三动作区 + 请求进度 + 删除确认页） | `/portal`（或复用 `/consent` 的已提交分支） | F96 | **未建** —— `/consent` 的撤回块是雏形，但没有「改选择 / 要副本 / 请求进度」三块。⚠ **v2 未画**（§四·2 G-⑤） |
| **U-10** | **项目组卡内的观察/访谈对象表**（六列 + `[AI 建议人选]` 候选卡 + 预约草稿） | `/projects/[id]`（项目筹备 · 定题与分组 · 组卡展开） | F97 F98 F99 | **未建**。⚠ **v2 未画**（只在新建向导第二步做了对象表的投影，不是主入口）（§四·2 G-⑥） |
| **U-11** | **撤回五步流水线与影响范围**（两级 SLA 可视化） | `/consent` 与 `/studio/interview` 两处入口 | F89 F96 | **已建（演示态）**。⚠ **v2 未画、未纳入截图** —— 界面在 `/consent` 里活着，但**不在签核材料里**（§四·2 G-⑦） |

> ⚠ 上表写于 v2 之前：**11 块屏里 7 块完全未建、2 块只建了一部分**。这不是遗漏，是 phase-01 UI 先行
> 只做了「R8 指定的主屏」（现场记录）。
>
> **v2 产出后的最新账**：11 块里 **6 块有 v2 截图**（U-1 U-2 部分 U-3 U-4 U-7 U-8），
> **5 块没有**（U-5 U-6 U-9 U-10 U-11）。v2 另**新增**了原设想里根本没有的一屏
> ——`uc-6-5-虚拟推演访谈-*`（7 张），它是人类 2026-07-30 那条链上的一环（见 §四·0 错误 4）。
>
> 签核 UI 这一件之前，**至少 U-5 的口径冲突必须先裁**——它已经被实现进 mock 了，越晚改代价越大；
> 而且 U-5 **恰恰是 v2 没画的 5 块之一**，即「最需要看图裁决的一屏，没有图」。

---

## 二、已建成部分的真实落点（核实过的代码路径与 `data-testid`）

⚠ **本节写的是旧路由 `/studio/interview` + `/consent` 的落点**，即 v1 时代的实现。
v2 原型另起顶层路由 `/itv`（组件 `apps/web/components/itv/**`、mock `apps/web/lib/mock/itv.ts`），
**并行安全、不覆盖旧路由**，其 testid 锚点集另列在 `ui-preview/itv-v2/README.md` §一。
本节保留是因为 U-5（`/consent`）与 U-7（现场三栏）的**既有实现仍在这里**，
而 §四·2 的 G-② / G-⑦ 正是「实现在这里、图不在签核材料里」。
⚠ 下表 `itv-view-{researcher,facilitator,groupLead,observer,interviewee}` 的 **5 档是 v1 的错**
（`V1-WAS-WRONG.md` 错误 5）；v2 只有 3 档，**签核以 3 档为准**。

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
| **S-03** 🔴 | **访谈/问卷的角色（研究员 / 受访者 / 参与者）不在 `ProjectRole` 四值枚举里**，实现另开 `?view=` 预览轴 | **必须先裁**。本束 8 份 UC 的 V-权限态全部依赖这些角色；`?view=` 是预览不是权限，落不成断言。与 S-02（合规负责人缺位）合并裁决 —— 见 coverage 缺口 **G-2**。⚠ **v2 已就角色数量给出答案**：访谈自有三档（研究员/受访者/观察者），**不含引导师/组长**（那是工作坊角色，`V1-WAS-WRONG.md` 错误 5）。但这只解决了「有哪几个角色」，**没有解决「它们不在 `ProjectRole` 里、`?view=` 仍是预览而非权限」** —— 本条仍须裁 |
| **S-05** 🔴 | **撤回五步的两个 SLA 是推断补的**：D-13 档案只给了 01「即时」、04「需人工」、05「30 天内」，实现按 D-15 推断补了 02「≤5 分钟」、03「即时」 | ui-preview 自评「**合规风险最高的一处**」。本束 F89/F96 的核心验收就是这两级 SLA，**需合规确认或给出真实 SLA** |
| **S-09** 🔴 | **受访者授权「3/4」的四项拆法**：实现选了 `录音✓ / 转写✓ / 引述✓ / 内部复用✗` | ⚠ **这套四项正是 UC-6.3 开头点名说「是错的」的旧版本。** 人类已于 2026-07-27 拍板改为 `录音 / 转成文字稿 / 交给 AI 分析 / 报告中署名与职务`。**代码没跟上裁决。** 更糟的是 `/consent` 屏只有**三项**（`录音 / 转文字稿 / 实名引用`），全仓共**三个互相冲突的版本** —— 见 coverage 缺口 **C-3** |
| **S-10** 🟠 | **代称格式**：小组工作台用「参与者 B（你）」，访谈侧用「某物流园区运营总监」；手机号一律掩码 `138 •••• 2049` | 掩码格式可用（对齐 O-39）；**代称生成规则仍是 domain 的 [待定 D-7]** |
| **S-11** 🟡 | **观察者在访谈现场看到多少**：实现选了「不硬拒，转录只读 + 说话人掩码到角色标签 + 显式横幅」 | 与 uc-6-4/R5「观察者只读脱敏结果」一致，但 uc-6-3/R5 另写「观察者**永远看不到**未脱敏原文与联系方式」——两条能否共存需确认 |
| **S-12** 🟡 | **丢弃清单的 7 类原因是发明的**（`已撤回 / 时效过期 / 低置信 / 无授权 / 预算截断 / 去重 / 越出范围`），会成为 Context Pack 的 `omissions[].reason` 枚举 | 本束的 `buildInterviewContextPack` **直接消费它**。⚠ **本束不得再造一份排除原因词汇**（coverage X-6） |
| **S-16** 🟡 | **重叠语音「待人工指派」的力度**（O-13）：无默认选中 + 明写「系统不自动归属」+ 有「保持待指派」退出口 | 对齐 uc-6-4/V7 的两类标注；实现属 05-rec 束（coverage X-3） |
| **S-18** 🟡 | 合规邮箱 `compliance@yuanyang-consulting.cn` 是**占位值**，UC 只写「合规邮箱」没给值 | uc-6-3/V5 要求「三项随项目参数变化」——占位值必须换成真实项目参数，否则 V5 验收是假的 |
| **未建清单** | README 第四节明确列出：**UC-6.1 新建访谈模板未建**、**UC-6.2 研究设计/大纲未建** | 与本文 §一 的 U-2 / U-3 / U-4 一致。**⚠ 此条已被 v2 部分解决**：三块屏 v2 都画了（§四·1），剩余未画的见 §四·2 的 G-① |

### 另一条 ui-preview 没说、但本束必须提的

`apps/web/lib/mock/interview.ts` 与 `apps/web/lib/mock/entry.ts` 都是**手写 mock**。
`contract-design.md` 的硬规则第 2 条写着「**不许手写 mock —— 从契约生成**」，
理由正是本仓已五次因「同一事实两处声明」漂移。**C-3 就是第六次，而且已经发生了。**
签核后开工的第一件事应该是：建 `packages/contracts/src/interview.ts`，
把 `ConsentKey` 定成单源，两份 mock 都从它生成。

---

## 四、截图清单（第 ① 件的签核材料）

### 四·0 先读这条：**v1 已被 v2 推翻，不要照 v1 签核**

仓库里同一能力域有**两个原型目录**：

| 目录 | 张数 | 地位 |
|---|---:|---|
| `phases/phase-01-run-a-project/ui-preview/itv/`（**v1**） | 44 | 🔴 **已被 v2 推翻。保留仅为留痕，不是签核材料。** |
| `phases/phase-01-run-a-project/ui-preview/itv-v2/`（**v2**） | **62** | ✅ **本件唯一的签核材料**，逐张索引见 §四·1 |

⚠ **目录名（`itv`）与本束名（`interview`）对不上是历史遗留**，不是两个不同的束——
`itv` 是访谈能力域的短名，v1/v2 都服务本束的 F80–F99。

**v1 错在哪：** 逐条证据（含原型 HTML 的字节偏移）写在 **`ui-preview/itv-v2/V1-WAS-WRONG.md`**，
本文件**不重抄**（同一事实不得声明在两处），只列六条错误的**标题**供定位：

1. 缺了整条链的第一环：「访谈模板的创建」这一层不存在
2. 没有「套用模板新建访谈」的三步向导
3. 完全没有「报告模板」这个概念
4. 把「虚拟用户画像推演访谈」做成了 phase-3 空占位
5. 把工作坊的角色模型（引导师 / 组长）套到了访谈上
6. 访谈的归属没定准（隐含挂在项目下，而它应与工作坊平级）

**v1 目录为什么还留在仓库里：** ADR 意义上的**推翻要留痕**——v1 的 44 张是人类当时看过的东西，
删掉会让「为什么改主线」这件事失去物证。`V1-WAS-WRONG.md` 的每条论证都以 v1 截图为参照物。
⚠ 但**留痕 ≠ 材料**：本文件**刻意不把 v1 的 44 张逐张列进签核索引**，
列进去就等于把已推翻的材料混进签核范围。

⚠ **推翻带来的副作用最危险的一处**：v1 画过、v2 没画的屏，其材料是**净损失**——
详见 §四·2 的 **G-③（受访者名单）**。

---

### 四·1 签核索引：`ui-preview/itv-v2/` 共 **62 张**

命名规则 `<uc-id>-<屏名>-<状态或视角>.png`。七态 = `default` / `loading` / `empty` /
`invalid` / `dep-failed` / `denied` / `success`（由 `?state=` 驱动）；视角由 `?view=` 驱动。
下列 62 行**与磁盘上的 62 个文件一一对应，无遗漏、无重复**。

#### UC-6.0 · 访谈列表（8 张）

跨项目 · 真人/数字人混排 · 范围切换器两档。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 1 | `ui-preview/itv-v2/uc-6-0-访谈列表-default.png` | default | 列表主态：范围切换器 + 真人/虚拟分列计数 + 虚拟条目强标记 |
| 2 | `ui-preview/itv-v2/uc-6-0-访谈列表-loading.png` | loading | 列表骨架加载态 |
| 3 | `ui-preview/itv-v2/uc-6-0-访谈列表-empty.png` | empty | 该范围下无访谈 |
| 4 | `ui-preview/itv-v2/uc-6-0-访谈列表-invalid.png` | invalid | 非法范围参数的输入错误态 |
| 5 | `ui-preview/itv-v2/uc-6-0-访谈列表-dep-failed.png` | dep-failed | 依赖失败（列表服务不可用）仍给出可读降级 |
| 6 | `ui-preview/itv-v2/uc-6-0-访谈列表-denied.png` | denied | 无权访问该范围（须与「不存在」不可区分，uc-6-0/E3） |
| 7 | `ui-preview/itv-v2/uc-6-0-访谈列表-success.png` | success | 操作成功回执态 |
| 8 | `ui-preview/itv-v2/uc-6-0-访谈列表-不属于任何项目.png` | **特殊态** | 范围切到「不属于任何项目」——这是**一等档**，不是空态；证明 `project_id` 可空（F80） |

#### UC-6.1 · 模板库（8 张）

链路起点。每行含 用过 N 次 / 题数 / 时长区间 / 数据字段（→ 矩阵列）/ 配套报告模板。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 9 | `ui-preview/itv-v2/uc-6-1-模板库-default.png` | default | 五要素行 + `[编辑]` `[用它新建]` + 绑定的报告模板列 |
| 10 | `ui-preview/itv-v2/uc-6-1-模板库-loading.png` | loading | 模板库加载态 |
| 11 | `ui-preview/itv-v2/uc-6-1-模板库-empty.png` | empty | 空态（⚠ 走的是共享 StateShell 单出口，**不是**「新建 / 从已有访谈抽取」两出口的定制空态，见 §三 未建清单） |
| 12 | `ui-preview/itv-v2/uc-6-1-模板库-invalid.png` | invalid | 非法筛选参数 |
| 13 | `ui-preview/itv-v2/uc-6-1-模板库-dep-failed.png` | dep-failed | 依赖失败降级 |
| 14 | `ui-preview/itv-v2/uc-6-1-模板库-denied.png` | denied | 无模板库权限 |
| 15 | `ui-preview/itv-v2/uc-6-1-模板库-success.png` | success | 成功回执态 |
| 16 | `ui-preview/itv-v2/uc-6-1-模板库-移动端375.png` | **特殊态** | **视口 375** 移动端降级，验证不横向溢出（⚠ 全 v2 仅此一屏截了移动端） |

#### UC-6.1 · 报告模板编辑器（7 张）

v2 新增概念屏：左提纲、右「配套报告模板」（章节 + 必须人写/AI 起草 + 数据来源映射）。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 17 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-default.png` | default | 报告章节 + 每章「必须人写 / AI 起草」+ 缺来源标红「发布被阻断」 |
| 18 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-loading.png` | loading | 编辑器加载态 |
| 19 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-empty.png` | empty | 尚未定义任何报告章节 |
| 20 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-invalid.png` | invalid | 章节映射非法（缺数据来源）的输入错误态 |
| 21 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-dep-failed.png` | dep-failed | 依赖失败降级 |
| 22 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-denied.png` | denied | 无编辑权限（只读） |
| 23 | `ui-preview/itv-v2/uc-6-1-报告模板编辑器-success.png` | success | 保存成功回执 |

#### UC-6.2 · 新建向导（9 张）

三步：选模板 → 选对象 → 生成提纲（`?step=1|2|3`）。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 24 | `ui-preview/itv-v2/uc-6-2-新建向导-default.png` | default | 默认停第 3 步（生成提纲），含「AI 已按目标生成 · 待你确认」草案闸门 |
| 25 | `ui-preview/itv-v2/uc-6-2-新建向导-loading.png` | loading | 向导加载态 |
| 26 | `ui-preview/itv-v2/uc-6-2-新建向导-empty.png` | empty | 无可用模板 / 无可选对象 |
| 27 | `ui-preview/itv-v2/uc-6-2-新建向导-invalid.png` | invalid | 必填未填的输入错误态 |
| 28 | `ui-preview/itv-v2/uc-6-2-新建向导-dep-failed.png` | dep-failed | AI 生成提纲的依赖失败，**向导仍可继续** |
| 29 | `ui-preview/itv-v2/uc-6-2-新建向导-denied.png` | denied | 无新建权限 |
| 30 | `ui-preview/itv-v2/uc-6-2-新建向导-success.png` | success | 新建成功回执 |
| 31 | `ui-preview/itv-v2/uc-6-2-新建向导-步骤1选模板.png` | **特殊态** | 第 1 步：每模板显示「用过 N 次 · 数据字段 · 配套报告模板」 |
| 32 | `ui-preview/itv-v2/uc-6-2-新建向导-步骤2选对象.png` | **特殊态** | 第 2 步：选对象 + **上下级拆场提示**；⚠ 这是 U-10 对象表的**投影**，不是主入口 |

#### UC-6.2 · 研究设计（7 张）

上下文三要素 + 大纲编辑器 + 研究计划参数四行。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 33 | `ui-preview/itv-v2/uc-6-2-研究设计-default.png` | default | 三要素 + 段落两层结构 + 研究计划参数四行（保留期渲染成「读项目参数」不写死） |
| 34 | `ui-preview/itv-v2/uc-6-2-研究设计-loading.png` | loading | 加载态 |
| 35 | `ui-preview/itv-v2/uc-6-2-研究设计-empty.png` | empty | 大纲尚未生成 |
| 36 | `ui-preview/itv-v2/uc-6-2-研究设计-invalid.png` | invalid | 段落问法不合格的提示态（⚠ 仅提示不阻断，是原型替 UC 做的判断） |
| 37 | `ui-preview/itv-v2/uc-6-2-研究设计-dep-failed.png` | dep-failed | 依赖失败降级 |
| 38 | `ui-preview/itv-v2/uc-6-2-研究设计-denied.png` | denied | 无编辑权限 |
| 39 | `ui-preview/itv-v2/uc-6-2-研究设计-success.png` | success | 「待你确认」闸门通过后的成功态 |

#### UC-6.4 · 现场记录（8 张）

质性访谈现场三栏：左提纲 / 中逐字稿 / 右 AI 副驾驶。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 40 | `ui-preview/itv-v2/uc-6-4-现场记录-default.png` | default | 三栏 + 状态条 + 逐字稿标注（含**拒绝 AI 分析的盾牌标**、附和·非独立证据标） |
| 41 | `ui-preview/itv-v2/uc-6-4-现场记录-loading.png` | loading | 现场加载态 |
| 42 | `ui-preview/itv-v2/uc-6-4-现场记录-empty.png` | empty | 尚无转录内容 |
| 43 | `ui-preview/itv-v2/uc-6-4-现场记录-invalid.png` | invalid | 非法输入态 |
| 44 | `ui-preview/itv-v2/uc-6-4-现场记录-dep-failed.png` | dep-failed | **副驾驶不可用而现场继续可用**（`COPILOT_UNAVAILABLE`，签核重点） |
| 45 | `ui-preview/itv-v2/uc-6-4-现场记录-denied.png` | denied | 无权进入现场 |
| 46 | `ui-preview/itv-v2/uc-6-4-现场记录-success.png` | success | 成功回执态 |
| 47 | `ui-preview/itv-v2/uc-6-4-现场记录-受访者视角.png` | **受访者视角** | `?view=interviewee`：受访者看到的现场（⚠ **预览手段，不是权限实现**，见 §二） |

#### UC-6.5 · 虚拟推演访谈（7 张）

⚠ **原设想的 U-1…U-11 里没有这一屏** —— 它是 v2 按人类 2026-07-30 原话新增的链条环节，
推翻了 v1 的「phase-3 空占位」做法（见 §四·0 错误 4）。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 48 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-default.png` | default | 三段：专家设定（置信上限/材料不足）· 提问与推演（**强制显示「不确定」「会被推翻」**）· 采纳与标注；三条硬约束常驻页头 |
| 49 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-loading.png` | loading | 推演进行中 |
| 50 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-empty.png` | empty | 尚无虚拟专家 / 无推演结果 |
| 51 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-invalid.png` | invalid | 构造材料不足（至少 2 场真人访谈或 3 条组织层判断）的拒绝态 |
| 52 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-dep-failed.png` | dep-failed | 推演服务依赖失败降级 |
| 53 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-denied.png` | denied | 无推演权限 |
| 54 | `ui-preview/itv-v2/uc-6-5-虚拟推演访谈-success.png` | success | 采纳成功 + 「已采纳的去向」 |

#### UC-6.5 · 洞察报告（8 张）

证据矩阵五取值 → 套报告模板逐章生成洞察报告。

| # | 路径 | 状态 / 视角 | 演示的是什么 |
|---:|---|---|---|
| 55 | `ui-preview/itv-v2/uc-6-5-洞察报告-default.png` | default | 矩阵五取值（强●绿 / 弱◐灰 / 未提及– / 附和≈虚线黄 / 反例✕红框，**色+形双通道**）+ 头部 `N 场 · M 位` + 底部「洞察报告 · 套报告模板逐章生成」 |
| 56 | `ui-preview/itv-v2/uc-6-5-洞察报告-loading.png` | loading | 归纳进行中 |
| 57 | `ui-preview/itv-v2/uc-6-5-洞察报告-empty.png` | empty | 尚无候选洞察 |
| 58 | `ui-preview/itv-v2/uc-6-5-洞察报告-invalid.png` | invalid | 试图给**虚拟来源**标强 ⇒ 显式锁标「虚拟来源不能标强（接口层拒绝）」（O-16 合规红线的界面投影） |
| 59 | `ui-preview/itv-v2/uc-6-5-洞察报告-dep-failed.png` | dep-failed | 归纳依赖失败降级 |
| 60 | `ui-preview/itv-v2/uc-6-5-洞察报告-denied.png` | denied | 无洞察权限 |
| 61 | `ui-preview/itv-v2/uc-6-5-洞察报告-success.png` | success | 报告生成成功回执 |
| 62 | `ui-preview/itv-v2/uc-6-5-洞察报告-观察者视角.png` | **观察者视角** | `?view=observer`：只读 + 说话人掩码到角色标签 + 显式横幅（对应 S-11 的口径分歧） |

**合计：8 + 8 + 7 + 9 + 7 + 8 + 7 + 8 = 62 张。** 与 v2 目录下实际的 62 个 `.png` 文件一一对应。

---

### 四·2 **第 ① 件材料缺口**（原设想的屏，v2 没画）

原 U-1…U-11 里，**5 块屏 v2 完全没有截图**；另有 2 处**屏内的子结构**没画。
下列条目**不得因为「v2 交了 62 张」而被当作已完成**。

| ID | 缺口 | 原设想的文件名（**不存在**） | 严重度 |
|---|---|---|---|
| **G-②** | ⚠ 未产出：**U-5 受访者授权页**（四项独立勾选 + 两条降级文案 + 数据控制方三项 + `[全部拒绝]`/`[确认并进入访谈]` 同等权重）—— 该屏尚未画 | ~~`ui-preview/itv-consent-page`~~ | 🔴 **最高** |
| **G-③** | ⚠ 未产出：**U-6 研究员侧受访者名单与只读镜像**（同意书三态列无勾选控件 + `已拆场` 标签 + 七开关）—— 该屏尚未画。🔴 **v1 画过 8 张（`uc-6-3-受访者名单-*`），但 v1 已被推翻 ⇒ 净损失，现在无任何可签材料** | ~~`ui-preview/itv-subject-roster`~~ | 🔴 **最高** |
| **G-⑤** | ⚠ 未产出：**U-9 受访者自助门户**（三动作区并列 + 请求进度 + 删除确认页四段说明）—— 该屏尚未画 | ~~`ui-preview/itv-subject-portal`~~ | 🔴 |
| **G-⑥** | ⚠ 未产出：**U-10 项目组卡内的观察/访谈对象表**（六列 + 掩码联系方式 + `[AI 建议人选]` 候选卡三出口 + 预约草稿）—— 该屏尚未画（v2 只在新建向导第 2 步做了**投影**，非主入口） | ~~`ui-preview/itv-subject-table`~~ | 🟠 |
| **G-⑦** | ⚠ 未产出：**U-11 撤回五步流水线与影响范围**（五步 + 两级 SLA + 「证据已撤回」段落仍在）—— 该屏尚未画（`/consent` 里有演示态实现，但**未纳入 v2 截图**，不是签核材料） | ~~`ui-preview/itv-withdrawal-flow`~~ | 🔴 |
| **G-①** | ⚠ 未产出：**U-2 的「抽取草案确认」子屏** —— 模板库用 Badge「从访谈抽取」+ 溯源链呈现**结果**，抽取动作的分步 UI 尚未画（UC-6.1 A3 语义未定） | — | 🟠 |
| **G-④** | ⚠ 未产出：**U-8 的「单场复盘」子标签** —— 洞察屏只聚焦「主题矩阵 + 洞察报告」，单场复盘只在现场屏的 AI 副驾驶里体现，独立视图尚未画 | — | 🟡 |

#### 这些缺口为什么共同构成一个模式

**G-②、G-③、G-⑤、G-⑦ 全部落在「受访者 / 同意 / 撤回」这条线上**——
也就是本束**合规最敏感、最需要人类看着图裁决**的那半边。
v2 的 62 张覆盖的是「模板 → 新建 → 设计 → 现场 → 推演 → 报告」这条**研究员侧**主链；
**受访者侧一张都没有**（v2 README §六自述：属进场/auth 域，本次未重画）。

⇒ 直接后果：`design-signoff.md`「必须先裁的三件事」第 1 条（**四项同意位在仓库里有三个冲突版本**）
**没有任何 v2 截图可以对照裁决**。人类要裁这一条，只能看代码里的 `/consent` 实现——
而那个实现**只有三项**，正是要被裁掉的那一版。

⚠ 另有 **1 处非缺口的差异**须点名，免得被误读成缺口：
v1 的 `uc-6-0-详情-虚拟标签占位` 在 v2 里**没有对应文件**，
但这是**升级不是丢失**——v2 用 7 张 `uc-6-5-虚拟推演访谈-*` 把它从空占位做成了真实屏。

---

### 四·3 可达性要求（原文保留）

⚠ 可达性要求（uc-6-3/R8 · uc-6-5/R8）：U-5 与 U-9 面向**外部非注册用户**（可能年长、用手机、需字幕），
**文案不得依赖悬浮提示**；U-8 的五取值配色需过**色盲**可辨识度检查。

⚠ **这条要求当前只有一半能核**：U-8 的五取值配色可对着
`ui-preview/itv-v2/uc-6-5-洞察报告-default.png` 核（色+形双通道），
而 **U-5 与 U-9 是 G-②/G-⑤ 两个缺口——没有图，可达性无从核对**。
v2 全量 62 张里**只有 1 张移动端截图**（`uc-6-1-模板库-移动端375.png`），
而它恰恰不是要求移动端可达性的那两屏。

---

## 五、签核这一件前请确认

- [ ] **确认签核材料是 v2 而不是 v1** —— `ui-preview/itv-v2/` 的 **62 张**是唯一材料；
      `ui-preview/itv/` 的 44 张（v1）**已被推翻，只是留痕**（§四·0，证据见 `ui-preview/itv-v2/V1-WAS-WRONG.md`）。
      若你此前看过的是 v1 的图，**结论需要重新做一遍**。
- [ ] **确认接受「主链已画、受访者侧全缺」的部分签核** —— §四·2 列了 **5 块完全未产出的屏 + 2 处未产出的子结构**，
      且 G-②/③/⑤/⑦ **全部**落在合规最敏感的受访者/同意/撤回线上。
      是否接受「按 v2 已有的 62 张先签研究员侧主链、受访者侧四屏单独补画后补签」？
      ⚠ `design-signoff.md` 的 `status` 是整份文件一个布尔、**没有分节状态位**，
      这个「部分签」在磁盘上**没有任何机械保护**。
- [ ] 🔴 **G-③ 是净损失，须单独拍板** —— 受访者名单 v1 画过、v2 没画，而 v1 已推翻。
      确认是让 ui-prototyper 按 v2 的口径重画，还是接受这块屏在无原型的情况下开工（F87/F88 的地基）。
- [ ] **v2 README §七 点名的 3 处建模判断须一并裁** —— 报告模板 1:1 绑定 vs 独立成库多对多 ·
      证据矩阵五取值配色与虚拟/真人来源的界面区分 · 虚拟画像推演是一屏还是两屏。
      这三处是 v2 **替产品做的**判断，不裁则 F82/F83/F94/F95 的返工面最大。
- [ ] **U-5 的四项口径（S-09 / C-3）** —— 全仓三个版本，且已建成的界面里**根本没有「交给 AI 分析」这一项**，
      而 O-05 的全部合规约束都挂在它上面。这一条不裁，F86–F88、F93、F95 全部无法验收。
- [ ] **场景角色是否需要独立一层（S-03 / G-2）** —— 不裁则本束 8 条 V-权限态无处落地。
- [ ] **仍未产出的 5 块屏（G-②/③/⑤/⑥/⑦）** —— 确认由 ui-prototyper 补画（并入 v2 目录），
      还是随各 feature 开工时建。若是后者，`verify-ui-states.sh` 的七态矩阵要同步扩。
