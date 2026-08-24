---
status: confirmed
bundle: visual-identity-refresh
base_bundle: interaction-primitives
scope: token-visual-layer-only
covers:
  - F19
ruling: "人类 2026-08-24/25 会话：针对真实产品截图（chat 主屏）直接反馈'整体上来说，这个UI给人感觉很平庸，没有什么印象，不专业'。Claude 诊断出四点结构性问题（accent 色一色三用无层次、圆角 7px 一刀切、导航栏无品牌锚点、字重全仓统一无台阶），并出具对比 artifact `theme-direction.html`（同一套 chat 界面结构，仅替换 token，交互与文案未动），artifact 内明确标注'刻意保守：不换主色相，如需更激进的换主色方向可另出一版'，并给出三个选项：①按提案方向全站落地 ②出更激进换主色版本 ③只挑部分点做。人类选择'1'——按提案方向直接落地。"
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-25"
confirmed_via: "对话内直接回复数字'1'，对应 Claude 上一条消息列出的三个选项中的第一项（'就照这个方向直接落进 globals.css/tailwind.config.ts（我全站铺开）'）。"
---

# 视觉系统 token 升级 —— 设计签核

这是一份**新的 delta 包**，不修改任何已签核束的用例/API 契约，只在纯视觉 token 层
新增分级（`base_bundle: interaction-primitives` 仅表示复用其已建立的组件消费模式，
不代表本 delta 隶属于该束的用例范围）。本文件的 `status` 变更依据上方 frontmatter
记录的人类 2026-08-25 对话内明确选择（逐字转写于 `ruling`/`confirmed_via`，未替
人类归纳或编造）。

## ① UI

已有材料：artifact `theme-direction.html`（左右对比，左为现状复刻、右为提案方向），
人类已看过并选择按此方向落地。**实现时仍需补真实产品截图证据**（chat/kitchen-sink
等关键页面改动前后对比），这份签核批准的是方向，不是替代实现阶段的截图证据——
沿用 F14/F15 已建立的"先落地再取证"流程。

## ② 用例

无新增用例——本 delta 不改变任何交互逻辑、状态机、路由。范围明确排除（见需求文档
`requirements/11-visual-identity-refresh.md` R6）：不换主色相、不改交互、不要求
地毯式清零全部历史字面量残留。

## ③ API 契约

N/A——本束无对外 HTTP 面。纯前端 token 层改动（`globals.css` token 定义 +
`tailwind.config.ts` 消费层），理由同 `interaction-primitives`/`motion-microinteraction`
等已签核的纯前端束。

---

**签核记录**：人类已在 2026-08-25 会话中，看过对比 artifact 后直接选择"1"（按提案
方向落地）。这是本 delta 的签核动作。
