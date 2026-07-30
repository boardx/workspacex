# 契约束 `recording` — 签核① UI：人看到的界面对不对

> # ⚠ 截图待 ui-prototyper 产出后补
>
> **`phases/phase-01-run-a-project/ui-preview/` 下目前只有三份 markdown，没有任何截图。**
> 在截图补齐之前，**第 ① 件不具备签核条件** —— 人类无法在只有文字描述的情况下
> 确认「人看到的界面对不对」。本文件现在是**骨架**：它列清了本束需要哪几块屏、
> 哪些已建成（含真实路由与 `data-testid`）、哪些没建、以及截图补齐后应该长什么名字。
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

## 二、截图清单（待补）

> ui-prototyper 产出后，按下列文件名存进 `phases/phase-01-run-a-project/ui-preview/`，
> 并把本节的「待补」逐条改成引用。**文件名是约定，不要随手改** —— 改了本文件的引用就断了。

| 截图文件 | 内容 | 现状 |
|---|---|---|
| `ui-preview/rec-interview-stage.png` | `/studio/interview` 转录区 + 逐字稿全貌（默认态） | 待补 |
| `ui-preview/rec-interview-overlap.png` | `seg-08` 重叠段「两人同时说话 · 待人工指派」+ 无默认选中 + 保持待指派出口 | 待补 |
| `ui-preview/rec-interview-lowconf.png` | `seg-12` 低置信「待校对」+ **解除出口**（D-10 补的） | 待补 · **出口未建** |
| `ui-preview/rec-interview-pii.png` | 逐字稿行内「已自动遮盖：… · 查看原文需权限」+ `[查看原文]` 出口 + 无权限态 | 待补 · **整块未建** |
| `ui-preview/rec-interview-ai-annotation.png` | AI 打点候选态 + `[确认] [编辑后确认] [忽略]` + `[看洞察]` 依据出口 | 待补 · **三出口未建** |
| `ui-preview/rec-assign-speaker.png` | 逐字稿校对屏：声道卡 + 候选名单 + 指派 + **撤销** | 待补 · **整屏未建** |
| `ui-preview/rec-group-mic.png` | `/group` 麦克风开关 + 「未录制」显式标注 + 「录制已暂停」缺口标记 | 待补 · **后两者未建** |
| `ui-preview/rec-chat-transcript.png` | `/chat` 右栏五标签 + 转录卡 + 自动跟随 + 正在识别 | 待补 |
| `ui-preview/rec-retention-per-material.png` | 逐份转写的「保留至 …」与删除时间（AC1b） | 待补 · **整块未建** |
| `ui-preview/rec-consent-render.png` | `/consent` 保留期文案由参数渲染 + 已提交快照对照 | 待补 |
| `ui-preview/rec-offline-gap.png` | 断网缓存与补传：转写流 gap 标记 | 待补 · **整块未建** |

---

## 三、本束的界面缺口一览（给签核人的一页纸）

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

- [ ] **截图全部待补** —— 在 ui-prototyper 产出之前，第 ① 件**不具备签核条件**。
      请确认是「等截图再签」还是「先签 ②③、① 单独等」（ADR-023 是三件在一处逐节确认，
      本束建议前者）。
- [ ] **§三 的 9 个界面缺口**，哪些必须在 F69–F79 开工前补出、哪些接受 API 先行。
      其中 **#4（待校对的解除出口）需要先裁决 D-10**，它不是排期问题而是设计缺失。
- [ ] **S-16 的力度**是否符合 O-13 的本意（这是 F71 的全部界面语义）。
- [ ] **S-11 观察者判定三处不一致**要不要在本阶段统一。
- [ ] **屏 5 的跨束边界**：F73 的「在文件浏览器可见可下载」由 `files` 束交付，本束只负责物化与登记。
