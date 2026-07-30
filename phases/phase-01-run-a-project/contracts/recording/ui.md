# 契约束 `recording` — 签核① UI：人看到的界面对不对

> ## 截图自检：**本文件引用 32 张截图，目录下实际 32 张**（N == M == 32，全部真实存在）
>
> 核对命令（任何人可复跑）：
> ```bash
> ls -1 phases/phase-01-run-a-project/ui-preview/rec/*.png | wc -l          # → 32（M）
> grep -o 'ui-preview/rec/[a-z0-9./-]*\.png' phases/phase-01-run-a-project/contracts/recording/ui.md \
>   | sort -u | wc -l                                                        # → 32（N，去重后）
> ```
> N 与 M 一旦不等，**必须在本行下方写明差在哪**，不得只改数字。当前无差异。
>
> ### ⚠ 目录名与束名对不上：截图在 `ui-preview/rec/`，不是 `ui-preview/recording/`
>
> 本束叫 `recording`，但 ui-prototyper 是按**能力域代号 `rec`**（05-rec）建的目录。
> **真实路径一律是 `phases/phase-01-run-a-project/ui-preview/rec/<文件名>.png`。**
> `ui-preview/recording/` **不存在**，写成它就是死链 —— 本文件的第一版就是这么断的，别再断第二次。
>
> ### ⚠ 截图拍的是 `/rec`，不是本文件 §一 里那四块既有屏
>
> ui-prototyper 把 `rec` 做成了**独立顶层路由 `/rec` 的「转写工作台」**（四屏 × 七态 × 三载体 × 五视角），
> 理由见 `ui-preview/rec/README.md` §三-1：转写是三载体共享能力，用载体切换器表达比分散到三处更好核对。
> 它**没有改** `/studio/interview`、`/group`、`/chat`、`/consent`。
> 所以：**§一 描述的是仓里既有的四块屏（真实 `data-testid`，grep 自 `apps/web/`），
> §二 的截图拍的是新建的 `/rec` 原型**。两者心智一致但不是同一套界面 —— 签核时请明确
> 你签的是「`/rec` 这套工作台的形态」，不是「`/studio/interview` 现在长这样」。
>
> 本文件里的 `data-testid` 全部是**从 `apps/web/` 源码里 grep 出来的真实值**，不是设计稿上的期望值。
> 标「未建」的地方，就是真的没有。

---

## 一、本束需要哪几块屏

### 屏 1 · 访谈现场 —— 转录区与逐字稿（本束的主屏）

| 项 | 值 |
|---|---|
| 路由 | `/studio/interview` |
| 组件 | `apps/web/app/studio/interview/page.tsx` → `apps/web/components/interview/interview-stage.tsx`（508 行）、`interview-outline.tsx`、`interview-copilot.tsx` |
| 服务 feature | **F69 F70 F71 F72 F74 F76 F77 F78** |
| 现状 | **已建成**（含七态预览轴 `?state=`、场景角色轴 `?view=`） |

已建成的真实 `data-testid`：

| testid | 服务哪条验收 |
|---|---|
| `itv-session-header` `itv-realtime-bar` | uc-5-1 R8 状态条（`德→中 · 延迟 1.8s ｜ 说话人未识别`） |
| `itv-tracks` `itv-track-{trackId}` | uc-5-1 V1 四路并行 |
| `itv-transcript` `itv-seg-{segId}` `itv-tc-{segId}` | uc-5-1 V2 V15（每句常驻时间码 / anchor） |
| `itv-transcript-search` | uc-5-1 V4「搜索逐字稿」 |
| `itv-audio-scrubber` `itv-audio-reset` | uc-5-1 V2「点时间码跳回音频」 |
| `itv-overlap-{segId}` `itv-overlap-pick-{segId}` `itv-overlap-assign-{segId}` `itv-overlap-keep-{segId}` | uc-5-1 V3 / O-13：`seg-08` 真重叠，**无默认选中**，另有「保持待指派」退出口 |
| `itv-dispute-{segId}` `itv-dispute-note-{segId}` | uc-5-2 V8「争议 · 多人认领」（⚠ 见 §四 S-16） |
| `itv-decision-{segId}` | uc-5-3 V2「AI 标记 · 决策点（待确认）」徽章 |
| `itv-mark-quote-{segId}` `itv-quote-{segId}` | uc-5-3 V1 V4「标为引述 / 已标为引述」 |
| `itv-mark-moment-{segId}` `itv-moment-{segId}` | uc-5-3 V1「标记此刻 / 打点」 |
| `itv-assign-{segId}` `itv-assign-pick-{segId}` | uc-5-2 V1 指派说话人 |
| `itv-auth-badge` `itv-auth-panel` `itv-auth-count` | uc-5-1 V8「授权 3/4 · Weber 不参与 AI 分析」 |
| `itv-readonly-banner` `itv-alias-note` `itv-interviewee-self` | uc-5-2 V5 观察者只读 + 说话人掩码到角色标签（S-11） |
| `itv-retention` | uc-5-4 V1「转写保留期」（在 `interview-outline.tsx`，**项目级一个数值**） |
| `itv-withdraw-*`（9 个）`itv-withdrawal-*`（3 个） | uc-5-4 E1 撤回链（**跨束**：consent / 17-gov） |
| `itv-coverage-summary` `itv-insights` `itv-followups` `itv-followups-denied` | uc-5-3 V3 RQ 覆盖度（**消费方跨束**：06-itv） |

⚠ **这块屏上本束缺的东西**（全部要补，见 §三）：
1. **PII 遮盖标注与「查看原文」出口** —— 一个 testid 都没有（F72 的全部界面）。
2. **AI 打点的 `[确认] [编辑后确认] [忽略]` 三出口** —— 只有徽章，没有出口（F77）。
3. **撤销指派的出口** —— 只有 `itv-assign-*`，没有撤销（F74 的 AC1 后半）。
4. **`识别置信度低 · 待校对` 的解除出口** —— 原型行内操作条五个按钮里**没有文本编辑入口**（D-10）。
5. **逐份转写的保留期/删除时间** —— `itv-retention` 是项目级的，AC1b 要的是**每份**（D-11）。

### 屏 2 · 小组工作台 —— 麦克风权限与随时关闭

| 项 | 值 |
|---|---|
| 路由 | `/group` |
| 组件 | `apps/web/app/(entry)/group/page.tsx` → `apps/web/components/entry/group-workbench.tsx` |
| 服务 feature | **F69** |
| 现状 | **已建成**（部分） |

真实 `data-testid`：`group-mic-toggle`（麦克风开关，常驻可达）· `group-mic-status`（本路录制状态）·
`group-voice-sticky`（语音便签）· `group-hand-raised-note`。

⚠ 缺：**「未录制」的显式标注**与**「录制已暂停」在转写流上的缺口标记**（uc-5-1 V6 / A2）。
现在只有一个开关，没有它关掉之后**在转写侧看得见的后果**。

### 屏 3 · 对话线程右栏 —— 第三种录制载体

| 项 | 值 |
|---|---|
| 路由 | `/chat` |
| 组件 | `apps/web/components/chat/chat-right-panel.tsx`、`apps/web/components/chat/message-stream.tsx` |
| 服务 feature | **F69 F70 F76 F77** |
| 现状 | **已建成** |

真实 `data-testid`：`chat-right-panel` · `chat-tab-{key}` / `chat-tabpanel-{key}`（五标签
转录/执行/洞察/产物/**材料**，均带计数）· `chat-transcript-tab` · `chat-transcript-card` ·
`chat-transcript-row` · `chat-transcript-search` · `chat-transcript-timer` ·
`chat-transcript-identifying`（「正在识别」）· `chat-transcript-insight`（`[看洞察]` 依据出口）·
`chat-transcript-inline` · `chat-transcript-view` · `chat-transcript-stop` +
`chat-transcript-stop-confirm/-yes/-no` · `chat-transcript-stopped` · `ambient-recording`。

⚠ 「自动跟随」开关**已建但只有 `id="chat-follow"`，没有 `data-testid`** ——
uc-5-1 V4 要断言它，需要补一个稳定 testid。

### 屏 4 · 受访者同意书 —— 保留期文案的动态渲染

| 项 | 值 |
|---|---|
| 路由 | `/consent` |
| 组件 | `apps/web/app/(entry)/consent/page.tsx` → `apps/web/components/entry/consent-form.tsx` |
| 服务 feature | **F79**（渲染消费方在 `consent` 束，本束是**参数提供方**） |
| 现状 | **已建成** |

真实 `data-testid`：`consent-body` · `consent-controller` · `consent-confirm` ·
`consent-decline-all` · `consent-withdraw-*`（8 个，五步撤回链）。

⚠ 缺：**渲染变量缺失时的拒绝态**（uc-5-4 E6：不得发出授权链接），以及
**已提交快照 vs 新渲染值**的对照呈现（V2 的 ①②）。

### 屏 5 · 项目文件浏览器 —— 录制产物的可见与下载（**跨束**）

| 项 | 值 |
|---|---|
| 路由 | `/projects/[id]/files` |
| 组件 | `apps/web/app/projects/[projectId]/page.tsx` 及 files 相关组件 |
| 服务 feature | **F73**（本束只负责物化与登记，目录树与下载归 `files` 束） |
| 现状 | **已建成，但归属另一个束** |

⚠ **这是本束唯一的跨束界面依赖。** F73 的 user_visible_behavior
（「音频 + `transcript.jsonl` 在项目文件浏览器可见、可下载」）**它的可见性由 files 束交付**。
签核本束时，请一并确认这条边界，否则会出现「两边都以为对方做了」。

### 屏 6 · 逐字稿校对屏 —— **未建**

| 项 | 值 |
|---|---|
| 期望路由 | 未定（入口在 `/studio/interview` 状态条的「逐字稿校对 14」计数） |
| 服务 feature | **F71 F74** |
| 现状 | **未建**。uc-5-2 R8 明写：「点击『逐字稿校对 14』之后的**完整校对屏**未探明」 |

⚠ **未探明 ≠ 原型没做**，不得据此裁掉需求（uc-5-2 R10 原话）。
R8 反推的布局：左侧匿名声道卡（时长占比 / 首次出现时间码 / 代表片段试听），右侧逐字稿，
拖人到声道卡完成整声道指派；顶部常驻「已指派 2/3 声道 · 争议 1 · 待校对 14」；
「待校对」与「待人工指派」可各自筛选。**这些都标 [设计]，需人类确认。**

### 屏 7 · 断网 / 补传态 —— **未建**

| 项 | 值 |
|---|---|
| 期望位置 | `/studio/interview` 与 `/group` 的转写流上 |
| 服务 feature | **F69** |
| 现状 | **未建**（原型「断网」档案 0 命中，uc-5-1 E2 标 [Backlog]） |

需要的呈现：转写流上的 **gap 标记**（不是拼接成连续假象）+「本地缓存 N 段待补传」。

---

## 二、截图索引（真实文件，共 32 张，全部存在）

> 路径前缀一律 **`ui-preview/rec/`**（⚠ 是 `rec/`，不是 `recording/`，见文首）。
> 原型是 `/rec` 工作台，四屏由 `?screen=` 切；每屏一套七态由 `?state=` 切
> （`default / loading / empty / invalid / dep-failed / denied / success`，走共享 `StateShell`）；
> 另有 `?carrier=`（workshop / interview / thread）与 `?as=`（视角）两轴，只在需要演示差异时单独抓图。
> 依据：`ui-preview/rec/README.md` §一。**下表逐张列全 32 张，无遗漏、无重复。**

### 屏 1 · 实时转录 `?screen=live` —— UC-5.1（10 张）

| 截图 | 状态 / 视角 | 演示什么 | feature |
|---|---|---|---|
| `ui-preview/rec/uc-5-1-live-default.png` | **default** · 访谈载体 | 转录区 + 逐字稿全貌：五标签＋四常驻控件；PII 行内「已自动遮盖：… · 查看原文需权限」＋ `rec-pii-reveal-*`；`seg-03` 遮盖但可引述 vs `seg-06/07/08` 不稳定态不可引述的同屏对照 | F69 F70 F72 |
| `ui-preview/rec/uc-5-1-live-loading.png` | **loading** | 转写接入中（UC-5.1 R8 必现状态） | F69 F70 |
| `ui-preview/rec/uc-5-1-live-empty.png` | **empty** | 尚无转写段的空态 | F69 F70 |
| `ui-preview/rec/uc-5-1-live-invalid.png` | **invalid** | 入参/校验失败态（U1–U3） | F69 F70 |
| `ui-preview/rec/uc-5-1-live-dep-failed.png` | **dep-failed** | 依赖失败（ASR / 组织默认保留期缺失等上游不可用） | F69 F70 |
| `ui-preview/rec/uc-5-1-live-denied.png` | **denied** · 组员视角 | 跨组无权限：组员不进他组结果集（UC-5.1 R5；UC-0.3 R8） | F69 |
| `ui-preview/rec/uc-5-1-live-success.png` | **success** | 操作完成回执态 | F69 F70 |
| `ui-preview/rec/uc-5-1-live-workshop.png` | **特殊态：载体 = workshop** | 项目现场四组并行的轨道状态条（录制中 / 断网缓存 / 已关麦 / **未录制**），含**拒绝麦克风**那一路（A2/E1）——这是「未录制」显式标注的落点 | F69 |
| `ui-preview/rec/uc-5-1-live-thread.png` | **特殊态：载体 = thread** | 对话线程里的「会议转录中」形态：同一套 `SegmentRow`，只在会话头分叉（延迟/语言方向/录音路数/file-first 产物清单） | F69 |
| `ui-preview/rec/uc-5-1-live-observer.png` | **特殊态：视角 = observer** | 观察者脱敏只读：说话人以角色显示、写操作全隐藏（S-11 的一种表态，⚠ 见 §三缺口 G-2） | F69 |

### 屏 2 · 指派说话人 `?screen=assign` —— UC-5.2（7 张）

| 截图 | 状态 | 演示什么 | feature |
|---|---|---|---|
| `ui-preview/rec/uc-5-2-assign-default.png` | **default** | 匿名声道卡（说话人 A/B/C）＋候选名单（未授权者 P-12 置灰显示不隐藏）＋指派＋**撤销**；**两态待处理**＝「待人工指派」与「争议 · 多人认领」；顶部常驻声纹 embedding 销毁提示（O-14） | F74 F75 |
| `ui-preview/rec/uc-5-2-assign-loading.png` | **loading** | 回填进行中 | F74 |
| `ui-preview/rec/uc-5-2-assign-empty.png` | **empty** | 无待指派声道 | F74 |
| `ui-preview/rec/uc-5-2-assign-invalid.png` | **invalid** | 并发 / 争议校验失败（E1/E3） | F74 |
| `ui-preview/rec/uc-5-2-assign-dep-failed.png` | **dep-failed** | 依赖失败（在场名单/聚类结果不可用） | F74 |
| `ui-preview/rec/uc-5-2-assign-denied.png` | **denied** | 无指派权限 | F74 |
| `ui-preview/rec/uc-5-2-assign-success.png` | **success** | 指派完成 + 全量回填回执 | F74 |

### 屏 3 · 引述与打点 `?screen=annotate` —— UC-5.3（7 张）

| 截图 | 状态 | 演示什么 | feature |
|---|---|---|---|
| `ui-preview/rec/uc-5-3-annotate-default.png` | **default** | 引述↔RQ 绑定 ＋ **AI 打点候选独立队列**，带 `[确认] [编辑后确认] [忽略]` 三出口；依据被撤回的失效候选灰显划线 | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-loading.png` | **loading** | 候选生成中 | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-empty.png` | **empty** | 无候选 / 无引述 | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-invalid.png` | **invalid** | **不稳定态拒绝引述**（partial / lowConfidence / pending-manual / disputed 四个拒绝码要能分流，E5/E6） | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-dep-failed.png` | **dep-failed** | 依赖失败（RQ 列表 / AI 服务不可用） | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-denied.png` | **denied** | 无标注权限 | F76 F77 |
| `ui-preview/rec/uc-5-3-annotate-success.png` | **success** | 标记完成 | F76 F77 |

### 屏 4 · 回流与保留期 `?screen=retention` —— UC-5.4（8 张）

| 截图 | 状态 / 视角 | 演示什么 | feature |
|---|---|---|---|
| `ui-preview/rec/uc-5-4-retention-default.png` | **default** | 保留期参数面板 ＋ 材料库**逐份**「保留至 …」＋ 同意书「动态渲染 vs 已提交快照」并列对照；**🔴 到期但删不掉红卡**（I-11 / X-4 冲突，本束最硬的待裁决项，见签核说明 §二-1） | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-loading.png` | **loading** | 参数读取中 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-empty.png` | **empty** | 无到期材料 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-invalid.png` | **invalid** | 参数非法 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-dep-failed.png` | **dep-failed** | **org-default 保留期缺失**（I-33：缺失时拒绝开始录制，不用隐含常量兜底）／同意书**变量缺失**（I-39：不得发出授权链接）——E5/E6 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-denied.png` | **denied** | 无保留期配置权限 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-success.png` | **success** | 到期删除完成 / 删除证明回执 | F78 F79 |
| `ui-preview/rec/uc-5-4-retention-interviewee.png` | **特殊态：视角 = interviewee** | 受访者授权告知视角：同意书上的保留期天数由参数渲染（`180` 是项目当前取值示例、**不是产品常量**，I-32 不许硬编码） | F79 |

**小计：10 + 7 + 7 + 8 = 32 张，与目录实际数一致。**

---

## 二之二、第 ① 件材料缺口（原设想有、现在没有的）

> ⚠ **两类缺口性质不同，分开标：**
> - **「未画图」** —— 界面上其实有，只是没单独抓一张图，或压根没这块画面。
> - **「未实现」** —— 原型上整块能力就不在（原表已标「整块未建」的那些）。
> 下表先给「原设想 11 条 → 真实截图」的逐条核实，再汇总真缺口。

### （a）原设想 11 条的逐条核实

| 原设想文件名（**已作废，全部不存在**） | 真实落点 | 判定 |
|---|---|---|
| `rec-interview-stage` | `ui-preview/rec/uc-5-1-live-default.png` | ✅ 有对应（但拍的是 `/rec` 不是 `/studio/interview`） |
| `rec-interview-overlap` | 内容并入 `uc-5-1-live-default.png`（`seg-06/07/08` 不稳定态）＋ `uc-5-2-assign-default.png`（两态待处理、无默认选中、保持待指派） | ✅ 有对应，无独立截图 |
| `rec-interview-lowconf` | 低置信段可见于 `uc-5-1-live-default.png`；**解除出口没有** | ⚠ 部分 —— 见 G-1 |
| `rec-interview-pii` | 遮盖标注与 `rec-pii-reveal-*` 按钮已在 `uc-5-1-live-default.png`；**点开后的授权屏与无权限拒绝态没有** | ⚠ 部分 —— 原表「整块未建」**已不成立**（按钮已建），改判见 G-2 |
| `rec-interview-ai-annotation` | `ui-preview/rec/uc-5-3-annotate-default.png`（三出口 + 失效候选） | ✅ 有对应；原表「三出口未建」**已不成立** |
| `rec-assign-speaker` | `ui-preview/rec/uc-5-2-assign-*.png`（7 张） | ✅ 有对应；原表「整屏未建」**已不成立**（但此屏是按 R8 反推补的 [设计]，仍需人类确认布局本意） |
| `rec-group-mic` | `ui-preview/rec/uc-5-1-live-workshop.png`（四组并行轨道状态，含「未录制」与拒绝麦克风路） | ✅ 有对应；原表「后两者未建」中的**「未录制」已建**，**「录制已暂停」的转写流缺口标记仍无** —— 见 G-3 |
| `rec-chat-transcript` | `ui-preview/rec/uc-5-1-live-thread.png` | ✅ 有对应（拍的是 `/rec` 的 thread 载体，不是 `/chat` 右栏本体） |
| `rec-retention-per-material` | `ui-preview/rec/uc-5-4-retention-default.png`（材料库逐份「保留至」） | ✅ 有对应；原表「整块未建」**已不成立** |
| `rec-consent-render` | `ui-preview/rec/uc-5-4-retention-default.png`（渲染 vs 快照并列）＋ `uc-5-4-retention-interviewee.png` | ✅ 有对应 |
| `rec-offline-gap` | 轨道级「断网缓存」可见于 `uc-5-1-live-workshop.png`；**转写流上的 gap 标记没有** | ⚠ 部分 —— 见 G-3 |

### （b）真缺口汇总（K = 6）

| # | 缺口 | 类型 |
|---|---|---|
| **G-1** | ⚠ 未产出：`识别置信度低 · 待校对` 的**解除出口**（文本修正）—— 该屏尚未画。⚠ 同时**未实现**：行内操作条里没有文本编辑入口。**它不是排期问题，是设计缺失，需先裁决 `domain.md` D-10**；不补它，该状态在产品上是死的 | **未画图 + 未实现** |
| **G-2** | ⚠ 未产出：PII **「查看原文」点开之后**的授权屏与**无权限拒绝态** —— 该屏尚未画。按钮（`rec-pii-reveal-*`）已建，但「弹二次授权 / 走审批 / 谁能批」UC-5.1 R3 第 6 步只说「独立授权动作并写审计」没说形态（`ui-preview/rec/README.md` §二-3）。**另一条同源未定项**：观察者/组员**能否下载**音频与逐字稿（R5 未写死，原型被迫二选一呈现） | **未画图**（形态未定，非实现遗漏） |
| **G-3** | ⚠ 未产出：**转写流上的 gap 缺口标记**与**「录制已暂停」在转写侧看得见的后果** —— 该屏尚未画。轨道级状态（断网缓存 / 已关麦 / 未录制）已在 `uc-5-1-live-workshop.png`，但「不把断点拼接成连续假象」的**逐字稿侧 gap 呈现**整块没有 | **未画图 + 未实现** |
| **G-4** | ⚠ 未产出：逐字稿校对屏的**代表片段试听** —— 该屏尚未画。`ui-preview/rec/README.md` §五-3 明写「音频不真播」：点时间码只高亮该段，没有播放器/波形/跳转，AC2「点时间码跳回音频」在界面上验不了 | **未实现**（mock 边界，非遗漏） |
| **G-5** | ⚠ 未产出：**屏 5「项目文件浏览器」**（F73 录制产物可见可下载）—— 该屏尚未画，`ui-preview/rec/` 下无对应截图。**这是设计使然**：它归 `files` 束交付（见 §一 屏 5）。签核本束时请一并确认这条边界，否则会出现「两边都以为对方做了」 | **跨束，不在本束截图范围** |
| **G-6** | ⚠ 未产出：**响应式 375 / 768 档截图** —— 只抓了 1360×900 桌面图（`ui-preview/rec/README.md` §五-7）。`AppShell` 有响应式断点，本次未跑该屏 | **未画图**（实现可能有，未取证） |

> ⚠ 以上六条**不得因为「32 张全绿」被吞掉**。第 ① 件的截图数对得上，**不等于**界面覆盖是完整的。

---

## 三、本束的界面缺口一览（给签核人的一页纸）

> ⚠ **本节说的是 §一 那四块既有屏（`/studio/interview` `/group` `/chat` `/consent`）上的缺口，
> 原文保留不改。** `/rec` 原型**没有动这四块屏**，所以这些条目在既有屏上**依然成立**；
> 但其中 #1 #2 #3 #5 #6 #7 #8 在 `/rec` 工作台上**已有原型形态**（对照 §二之二（a）表）。
> 换句话说：**「原型画了」≠「既有屏实现了」**，开工时要么把 `/rec` 收编为正式落点、
> 要么把这些形态搬回既有屏 —— 这本身是一个需要人类拍板的取舍。

| # | 缺什么 | 影响的 feature | 能否 API 先行 |
|---|---|---|---|
| 1 | PII 遮盖标注 + 查看原文出口 + 无权限态 | F72（3 点） | ✅ 五类遮盖与手机号密文是纯 API 断言（domain I-19/I-20） |
| 2 | AI 打点三出口 | F77（2 点） | ✅ 候选闸门是纯 API 断言（I-24） |
| 3 | 撤销指派出口 | F74（4 点） | ✅ 回填/退回是纯 API 断言（I-11） |
| 4 | 「待校对」解除出口（文本修正） | F71（4 点） | ⚠ **需先裁决 D-10** —— 不补它，该状态在产品上是死的 |
| 5 | 逐份保留期/删除时间 | F78（3 点） | ✅ |
| 6 | 断网 gap 标记与补传 | F69（4 点） | ✅ `gapRanges` 已定（I-5） |
| 7 | 「未录制」显式标注 | F69 | ✅ |
| 8 | 逐字稿校对屏（整屏） | F71 F74 | ⚠ 未探明，需补抽取原型 |
| 9 | 自动跟随开关缺 `data-testid` | F69 | ✅ 一行改动 |

---

## 四、`ui-preview` 三份 markdown 里与本束相关的已知缺口

> 它们是「UC 没写、由**实现者替 UC 做了的决定**」，全部需要人类确认。
> 来源：`ui-preview/README.md`（S-01～S-18）、`PROTOTYPE-DIGEST.md`、`README-files.md`。

| 条目 | 内容 | 与本束的关系 |
|---|---|---|
| **S-16 重叠语音「待人工指派」的力度（O-13）** | `seg-08` 是真重叠：`speakerId: null`、`status: "pending-manual"`、列出候选人；UI 显示 warning 徽章 + 指派区明写「系统**不自动归属**」+ **无默认选中**，另有「保持待指派」退出口。相邻 `seg-17` 演示「同一段被多人认领」→「争议 · 多人认领」 | **直接命中 F71**。README 原话：「请确认这个力度是否符合 O-13 的本意」。⚠ `disputed`（争议）在原型档案里 **0 命中** —— 它是实现者造的状态，见 `domain.md` **D-9** |
| **S-09 受访者授权「3/4」的四项拆法** | UC-6.3 只要「授权 3/4」没枚举那四项；实现选了 录音✓ / 转写✓ / 引述✓ / 内部复用✗，**实名引用作为独立开关**（拒绝 → 用代称） | 决定 `Track.consentState` 读哪份定义（`domain.md` X-7）。**本束不得自己拆** |
| **S-10 代称格式** | 小组工作台用「参与者 B（你）」，访谈侧用「某物流园区运营总监」；**手机号一律掩码 `138 •••• 2049`** | 掩码格式是 F72 的直接输入（I-20 的界面侧） |
| **S-11 观察者能看到多少** | 访谈现场**不硬拒**，而是「转录只读 + 说话人掩码到角色标签（连代称都不给）+ 显式横幅」；对话侧**滤掉转录卡** | 两处判断不同、README 明写「需统一」。影响 uc-5-1 V8 / uc-5-2 V5 的权限断言（`domain.md` X-10） |
| **S-05 撤回五步的两个 SLA 是推断补的** | D-13 只给了 01「即时」、04「需人工」、05「30 天内」；实现按 D-15 **推断补了** 02「≤5 分钟」、03「即时」 | 本束的撤回联动（I-27 / uc-5-4 E1）依赖这条 SLA。README 标它为**合规风险最高的一处** |
| **S-04 三个数值 UC 明写「需产品给出」，界面目前不编造** | 实现**拒绝编造**并显式标注「产品待定」，mock 里用 `*Known: false` 标死防止被硬编码 | 本束的 D-1（DER 阈值）应照这个处理方式：**结构性断言先行，数值留空且防硬编码** |
| **S-14 危险动作补了二次确认与影响范围** | 受访者撤回加了「我已了解影响范围」勾选才解锁红色确认键；文件删除强制填原因（≥4 字） | 本束的撤销指派、声纹销毁、到期删除都属危险动作，应沿用同一规范 |
| **S-18（一条）合规邮箱是占位** | `compliance@yuanyang-consulting.cn` 是占位，UC 只写「合规邮箱」没给值 | 直接命中 F79 的模板变量（I-39：变量缺失不得发出授权链接） |
| **PROTOTYPE-DIGEST 对话右栏** | 「五个标签 `转录` `执行 2/4` `洞察 6` `产物 3` `材料 12`；头部『会议进行中 · 显示转录』+ `自动跟随` 开关 + 计时 `28:14`；逐条转录含 `Ava 标记为决策点` + `看洞察`，末条标 `正在识别`」 | 这是屏 3 的原始依据，与已建成代码一致 |
| **PROTOTYPE-DIGEST 受访者同意书** | 「录音：只在这场访谈中录，存于远洋的服务器，**180 天后自动删除**」 | ⚠ 这个 180 天是**某个项目的当前取值示例，不是产品常量**（uc-5-4 头部）。F79 必须把它渲染出来，**不许硬编码**（I-32） |
| **README-files（22-files 侧）** | 「`transcript.jsonl` 默认不对观察者可见」；「派生物折叠在原件之下、带 `derived_from v?`」 | 直接命中 F73 的登记形态（I-28）与跨束边界（屏 5） |

---

## 五、签核这一节时请确认

- [x] ~~截图全部待补~~ —— **已解除**：`ui-preview/rec/` 下 32 张截图齐备，第 ① 件**已具备签核条件**，
      索引见 §二。请注意签的是 **`/rec` 工作台**的形态，不是 `/studio/interview` 的现状（见文首）。
- [ ] **§二之二（b）的 6 条真缺口（G-1～G-6）** 逐条表态：哪些必须在 F69–F79 开工前补出、
      哪些接受带缺口开工。其中 **G-1 需先裁决 D-10**，**G-2 需先定 PII 授权形态与观察者下载权**
      （UC-5.1 R5/R10 两条挂起项），**G-5 是跨束边界**（F73 的可见可下载由 `files` 束交付）。
- [ ] **`/rec` 与既有四屏的关系**：`/rec` 是新建的独立工作台，与 `/studio/interview` 的转录区
      并存。请裁定是把 `/rec` 收编为正式落点，还是把原型形态搬回既有屏 ——
      **不裁定就会出现同一能力两处实现**（本仓已因「同一事实两处」漂移过五次）。
- [ ] **`ui-preview/rec/README.md` §二 的 5 条「界面上无法自洽」** 一并过一遍，尤其
      **#1 材料保留期到期删除 vs 定版快照不可删（I-11 / X-4）** —— 已画成
      `ui-preview/rec/uc-5-4-retention-default.png` 里的 🔴 红卡，原型**没有**替它做删/不删的决定。
- [ ] **§三 的 9 个界面缺口**，哪些必须在 F69–F79 开工前补出、哪些接受 API 先行。
      其中 **#4（待校对的解除出口）需要先裁决 D-10**，它不是排期问题而是设计缺失。
- [ ] **S-16 的力度**是否符合 O-13 的本意（这是 F71 的全部界面语义）。
- [ ] **S-11 观察者判定三处不一致**要不要在本阶段统一。
- [ ] **屏 5 的跨束边界**：F73 的「在文件浏览器可见可下载」由 `files` 束交付，本束只负责物化与登记。
