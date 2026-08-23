---
bundle: motion-microinteraction
phase: "12"
covers: [F03, F04, F11, F12]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# 契约束 `motion-microinteraction` 设计签核

> ## 🔴 本束现在不可签核。请不要把 `status` 改成 `confirmed`。
>
> **① 🔴 UI 材料未产出。** `ui-preview/motion-microinteraction/` 目录尚不存在——
> 编排级动效（消息到达、面板展开）是本阶段**新设计内容**，没有既有截图可引用，
> 需要 ui-prototyper 先做出动效关键帧的静态示意（或至少几张状态截图 + 文字描述时间线）。
> 已在 `ui-material-map.json` 补上映射行。
>
> **② ⚠ usecases.md 已备齐但有一处需要人类拍板**：UC-2/UC-3 「值得编排的时刻」目前
> 只有候选（消息到达、面板展开），不是已确认的产品决策——**评估报告原文标注这是
> [设计] 级依据，不是 [原型]/[Backlog] 级**。人类签核时需要确认这两个候选是否就是
> 要做的，还是有别的时刻更值得投入（如首屏加载、附件上传进度）。
>
> **③ N/A — 本束无后端 API 契约面。** 理由同 `interaction-primitives` 束：纯前端展示行为。

## 人类签核时请重点确认

- **① UI**：ui-prototyper 产出后，核对动效示意是否让人能看懂「编排」具体指什么
  （不是泛泛的「有动画」，而是有先后顺序的时间线）。
- **② 用例**：UC-2/UC-3 的编排时刻选择——**这是本束最需要人类判断的一点**，
  拍板后 F04 的验收标准才能真正落地，不然实现者只能猜。
- **③ API 契约**：确认「无 API 契约面」判断成立。
- **支撑材料**：`domain.md` I-4「四域同一组件微交互必须取同一 token」——如果某个域
  因历史原因暂时做不到（如某处深度耦合第三方样式），需要在这里明确记录为例外而不是
  静默不达标。
