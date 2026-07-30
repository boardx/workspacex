# UI 先行原型 v2 · `rec`（录音与转写）—— 补画三屏 · ADR-003 关卡材料

> **本版是补画**：v1（`ui-preview/rec/`，32 张）把三屏的**结论**展示了、却漏了**产生结论的那一屏**。
> 逐条错处见同目录 `V1-WAS-WRONG.md`。v2 = 32 张原样复制 + 24 张补画，路由沿用 `/rec`。
> URL 维度：`?screen=prep|process|verify|live|assign|annotate|retention` · `?state=`（七态）· `?as=`（五视角）· `?carrier=`（三载体）。

---

## 一、截图 → UC → 屏映射（本轮新增 24 张）

| 截图前缀 | 屏 | 对应 UC / 节 | 覆盖状态 |
|---|---|---|---|
| `uc-5-1-prep-*` | 准备室 · 逐人 × 三项授权矩阵（录音/转录/AI 分析） | UC-5.1 R8 授权 · 原型 16088061 | 七态全 + `interviewee` 视角 |
| `uc-5-1-process-*` | 处理状态 · 6 任务独立报状态、失败不阻塞 | UC-5.1 处理 · 原型 16121854 | 七态全 + `member` 视角 |
| `uc-5-3-verify-*` | 逐字稿校对 · 播放器 + 低置信改词 + 进证据库闸门 | UC-5.3 校对 · 原型 16125909 | 七态全 + `observer` 视角 |

其余 32 张（`uc-5-1-live-*` / `uc-5-2-assign-*` / `uc-5-3-annotate-*` / `uc-5-4-retention-*`）是 v1 原样复制，未改。

### 关键 testid 锚点
- 准备室：`rec-prep` `rec-prep-authcount` `rec-prep-blocked-badge` `rec-prep-matrix` `rec-prep-row-{p-10,p-11,p-12}` `rec-prep-cell-{pid}-{record,transcribe,aiAnalysis}` `rec-prep-note-{pid}` `rec-prep-checks` `rec-prep-check-{id}` `rec-prep-speaker-labels` `rec-prep-start` `rec-prep-footnote`
- 处理状态：`rec-process` `rec-process-failed-badge` `rec-process-tasks` `rec-process-task-{id}` `rec-process-failnote-{id}` `rec-process-retry-{id}` `rec-process-principle`
- 逐字稿校对：`rec-verify` `rec-verify-commit` `rec-verify-pending-badge` `rec-verify-nav` `rec-verify-navspeaker-{id}` `rec-verify-chapter-{id}` `rec-verify-player` `rec-verify-play` `rec-verify-item-{id}` `rec-verify-lowconf-{id}-{i}` `rec-verify-speaker-{id}-{i}` `rec-verify-themes` `rec-verify-theme-{id}` `rec-verify-evidence-note`

---

## 二、我替 UC 做的、UC 没写明的设计决定（逐条，请人类核对）

1. **授权取值集 = {允许, 拒绝, 待签}** 三态，逐人 × 三项独立。原型只给了这三个词，未给「部分允许/条件允许」等中间态；
   我把它建成 `AuthzValue = "allow"|"deny"|"pending"`，**待迁入 `packages/contracts`**（契约现只有布尔 `authComplete`）。
2. **「开始」按钮可用性 = 无任何 pending**（`PREP_CAN_START`）。原型只说「P-12 未签前开始不可用」，我把它一般化为
   「任意一人任意一项 pending → 不可开始」。若产品允许「只要录音项齐了就能开始，AI 分析可后补」，这条判据要改。
3. **处理任务 4 态**（完成/进行中/失败/等待前序）。原型给了这四种视觉，我落成 `TaskState` 枚举 + 阻塞任务灰显。
   「阻塞」是我从「AI 摘要·等翻译完成」推的显式态，原型只画了灰色未勾选。
4. **逐字稿校对的写权限** = 仅引导师/研究员可改词与「并入证据库」；观察者/受访者只读。原型校对屏无视角切换器，
   这套权限投影是我按 rec 域其它屏的口径补的。
5. **低置信改词的默认高亮出口** = 第一个「听这一段」为 primary，其余为 outline。原型三按钮等权，我给了主次以引导先听后改。

---

## 三、R8 线索之间的矛盾与处理

- **准备室 P-10=Weber vs 既有 SPEAKERS P-10=陈涛**：原型自身在准备室屏与其它屏用了不同编号。
  我在准备室屏**忠实复刻准备室的编号**（P-10=Weber），未与既有 `SPEAKERS` 强行对齐——见 `V1-WAS-WRONG.md` §无法自洽点 1。
- **会话号 11 vs 10**：准备室标「访谈 11」、处理/校对标「访谈 10」，原型如此，照抄未统一。
- **「AI 分析拒绝」的下游**：准备室说 Weber 发言「不参与主题归纳与证据强度计算，报告里只能作为直接引述」——
  这条与校对屏右栏「待你判断·附和不计入强度」的证据强度口径一致，v2 两屏都做了呈现，未发现冲突。

---

## 四、界面上无法自洽的点（sign-off 重点）

见 `V1-WAS-WRONG.md` 末节两条（P-10 编号、会话号）。此外：
- **处理状态屏无视角切换的写含义**：处理是后台 worker 行为，重试按钮对只读视角禁用，但「谁能重试」原型无明证，我按引导师/研究员给。

---

## 五、建议 sign-off 时重点核对的 3 处

1. **授权矩阵的取值集与「开始」判据**（§二.1 / §二.2）—— 三态是否够、AI 分析拒绝是否要允许「先开始录音」。做错后面证据强度计算全受影响。
2. **P-10 编号统一**（§三）—— 准备室 Weber vs 既有 陈涛，越早定越省，牵动指派/引述/报告/图谱的出处一致性。
3. **逐字稿「确认才进证据库」闸门 + 「附和不计入强度」**（`uc-5-3-verify-*` 右栏）—— 这是 rec → 证据库的唯一入口与证据强度红线的界面投影，须确认醒目度与默认行为。
