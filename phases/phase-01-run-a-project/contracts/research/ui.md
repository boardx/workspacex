# 契约束 `research` — 签核①：UI（界面落点）

> ## 自检（可机械核对）：**本文件引用 49 张截图，`ui-preview/research/` 目录下实际 49 张（N == M == 49）。**
>
> 目录：`phases/phase-01-run-a-project/ui-preview/research/`（ui-prototyper 2026-07-31 产出）。
> 截图目录映射已在 `.harness/scripts/ui-material-map.json` 声明为 `research → ui-preview/research`。
> 详细索引与「我替人类做的判断 / 无法自洽的点」见同目录 `README.md`——**本文件是 ui.md 侧的引用表**。
>
> ⚠ 原型出处一律给**字节**偏移（`[原型 @n,nnn,nnnB]`，指 `phases/requirements/WorkspaceX Standalone.html`，
> 17,050,600 字节，按偏移取证，勿整份读）。本束与 `PROTOTYPE-SWEEP-UI.md` 同坐标系（字节）。
>
> ⚠ **本文件的 `status` 类签核动作只能由人类做，agent 不许动 `design-signoff.md`。**

---

## 一、三个平面（不分清，下面每一条「已建成/未建」都会被误读）

| 平面 | 在哪 | 是什么 |
|---|---|---|
| **生产屏** | `apps/web/app/research/page.tsx` + `components/research-studio/*` | 本束的 UI 先行原型（真实组件 + mock）。**新建在顶层 `/research`** |
| **占用屏** | `apps/web/app/studio/research/page.tsx` + `components/research/*` | ⚠ 服务 **UC-0.2 Context Pack**，**不是本束**。见「二」Q-2 |
| **原型屏** | `WorkspaceX Standalone.html` 界面区与 JS 数据区 | 人类给的设计原型。它有的，生产平面此前未必有 |

⚠ **本束在生产平面上从零开始**：`grep -c "研究场景\|时间盒\|桌面研究…" apps/web/lib/mock/research.ts` → **0**。
本原型的 mock 在**另一个文件** `apps/web/lib/mock/research-studio.ts`，与 Context Pack 的 `research.ts` 无关。

## 二、路由处置（Q-2 阻塞级 · 未裁）

`/studio/research` 现渲染 Context Pack。本原型**最小可逆**地：研究 Studio 建在顶层 `/research`；
`navigation.ts` 的「研究」一级导航重指 `/studio/research` → `/research`、ucRefs 换成 `24-research/uc-24-1…5`；
`nav-reachability.config.json` 的 `bundleRoutes.research` 同步为 `/research`（那条「绿得不诚实」从此为真）。
Context Pack 页面**未改**，仍 `/studio/research` 直达。**Q-2 的最终归并留给人类**（README「三」）。

---

## 三、屏清单与七态（五份 UC → 五块屏 × 七态 + 视角对照 + 特殊子态）

预览手段：`?screen=` / `?state=` / `?as=owner|collaborator` / `?sub=`（仅开发可达）。

### A · 新建深度研究弹层（`uc-24-1`）· `screen=new`

- **原型**：DOM 16,740,400–16,746,000；七组字段数据数组与预览句 16,903,700–16,906,900（JS 数据区，点原型点不到）。
- **要点**：七组默认值逐项等于原型常量（`desk` / `std` / 来源两项 / 交付一项 / 节点 `n1`），画反即重做。
  预览句随字段实时重算（N-12 / N-4）。

七态：`uc-24-1-new-default.png` · `uc-24-1-new-loading.png` · `uc-24-1-new-empty.png` ·
`uc-24-1-new-invalid.png` · `uc-24-1-new-dep-failed.png` · `uc-24-1-new-denied.png` · `uc-24-1-new-success.png`

特殊：`uc-24-1-new-preview-alt.png`（预览句另一取值，证明算出来的）·
`uc-24-1-new-group-prefill.png`（A1 从组预填）· 视角：`uc-24-1-new-view-collaborator.png`

### B · 研究主题详情：对话 + 四段结果（`uc-24-2`）· `screen=detail`

- **原型**：15,339,332–15,348,077（整屏）。左半对话（含执行步骤三条编号），右半四段
  （关键发现 / 争议·不确定 / 外部来源表 / 研究结论）。低置信 0.3 必现且带标注（N-3）。

七态：`uc-24-2-detail-default.png` · `uc-24-2-detail-loading.png` · `uc-24-2-detail-empty.png` ·
`uc-24-2-detail-invalid.png` · `uc-24-2-detail-dep-failed.png` · `uc-24-2-detail-denied.png` ·
`uc-24-2-detail-success.png` · 视角：`uc-24-2-detail-view-collaborator.png`

### C · 研究 Studio 列表 + 研究计划详情（`uc-24-3`）· `screen=list` / `screen=plan`

- **原型**：16,157,163–16,173,305（列表 + 三计数 + 证据表）· 16,003,815–16,005,200（左栏三段）。
- **要点**：卡片四个数（证据/目标/研究问题/候选洞察）· 证据表四列（证据/来源/置信度/去向）·
  目标缺失渲染 `—` 不是 `0`（N-8）· 行动作文案是「归档」不是删除（N-7）。

列表七态：`uc-24-3-list-default.png` · `uc-24-3-list-loading.png` · `uc-24-3-list-empty.png` ·
`uc-24-3-list-invalid.png` · `uc-24-3-list-dep-failed.png` · `uc-24-3-list-denied.png` ·
`uc-24-3-list-success.png` · 视角：`uc-24-3-list-view-collaborator.png`

计划七态：`uc-24-3-plan-default.png` · `uc-24-3-plan-loading.png` · `uc-24-3-plan-empty.png` ·
`uc-24-3-plan-invalid.png` · `uc-24-3-plan-dep-failed.png` · `uc-24-3-plan-denied.png` ·
`uc-24-3-plan-success.png` · 特殊：`uc-24-3-plan-target-missing.png`（N-8）· 视角：`uc-24-3-plan-view-collaborator.png`

### D · 结论出口与门控阻断（`uc-24-4`）· `screen=detail&sub=…`

- **原型**：15,347,036–15,348,077（结论区三按钮）· 16,942,800–16,944,400（对话面三动作，JS 数据区）。
- **要点**：三种阻断画成「点了被拒 + 说明 + 错误码」，**不是灰按钮**；部分成功单独出一张。

`uc-24-4-detail-block-no-source.png`（`NO_EXTERNAL_SOURCE` · N-1）·
`uc-24-4-detail-block-disputed.png`（`EVIDENCE_IS_DISPUTED` · N-2）·
`uc-24-4-detail-block-conflict.png`（`CONFLICT_PENDING_HUMAN` · N-5）·
`uc-24-4-detail-promote-partial.png`（入库成功 + `DECISION_NODE_GONE` 回流失败，不回滚 · E2）

### E · 现场深度研究与冲突判定（`uc-24-5`）· `screen=live`

- **原型**：15,493,520–15,500,339（整屏）。任务列表三态（运行中/已就绪/待判定）+ 头部两个数 +
  冲突待判定区三动作（平权、无预选、无倒计时 · N-6）+ 提出方留痕（N-9）。

七态：`uc-24-5-live-default.png` · `uc-24-5-live-loading.png` · `uc-24-5-live-empty.png` ·
`uc-24-5-live-invalid.png` · `uc-24-5-live-dep-failed.png` · `uc-24-5-live-denied.png` ·
`uc-24-5-live-success.png` · 特殊：`uc-24-5-live-conflict-filter.png`（只看冲突 · A1）·
`uc-24-5-live-conflict-empty.png`（冲突为 0 时区块仍在 · A2）· 视角：`uc-24-5-live-view-collaborator.png`

---

## 四、屏与不变量的对应（评审时按这张表看 —— 四视角/阻断态比 happy path 重要）

| 不变量 | 在哪张图看得出来 |
|---|---|
| **N-1** 入库需外部来源 | `uc-24-4-detail-block-no-source.png` |
| **N-2** 争议项永不入库 | `uc-24-2-detail-default.png`（段②）· `uc-24-4-detail-block-disputed.png` |
| **N-3** 低置信标出不丢弃 | `uc-24-2-detail-default.png`（段③ 0.3）· `uc-24-3-plan-default.png`（证据表 0.3 行）|
| **N-4** 检索不越出来源偏好 | `uc-24-1-new-default.png` · `uc-24-1-new-preview-alt.png`（预览句「来源限定在…」）|
| **N-5** 冲突先标不确定 | `uc-24-5-live-default.png` · `uc-24-4-detail-block-conflict.png` |
| **N-6** 建议不预选不自动执行 | `uc-24-5-live-default.png` |
| **N-7** 只归档不删除 | `uc-24-3-list-default.png`（行动作文案「归档」）|
| **N-8** 缺失渲染 `—` 不是 `0` | `uc-24-3-plan-target-missing.png` |
| **N-9** 提出方留痕 | `uc-24-3-list-default.png` · `uc-24-5-live-default.png` |
| **N-10** 观察者出口 = 空集 | `uc-24-1-new-denied.png` · `uc-24-2-detail-denied.png` · `uc-24-3-list-denied.png` · `uc-24-3-plan-denied.png` · `uc-24-5-live-denied.png` |
| **N-11** 入库是候选洞察 | `uc-24-3-plan-default.png`（「待送综合 Studio 验证」）· `uc-24-4-detail-promote-partial.png` |
| **N-12** 七项配置是执行契约 | `uc-24-1-new-default.png` · `uc-24-1-new-preview-alt.png` |

⚠ 视角对照四张（列表/计划/详情/现场的 `<屏名>-view-collaborator` 截图）是本束第 ① 件最要紧的性质：
**owner 与 collaborator 是否真的改变界面**——见 README「四①②③」的三处待人类核对判断。

⚠ **观察者是七态里的 `denied` 投影，不是第四视角**：研究成员模型 = owner/collaborator（U-1=B），
原型研究管理区 16.099M–16.125M 无任何成员/角色控件（负向印证）。U-1 与各 UC R5 的四项目角色有张力，
取舍与理由见 README「四①」。**签核时请一并确认这条取舍。**
