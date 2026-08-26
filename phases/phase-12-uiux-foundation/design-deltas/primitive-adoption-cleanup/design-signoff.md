---
status: draft
bundle: primitive-adoption-cleanup
base_bundle: interaction-primitives
scope: swap-existing-primitives-plus-token-hotfix
covers:
  - F20
  - F21
  - F22
ruling: "人类在会话内看到 tpl-designer「工作坊·蓝本设计」页真实截图后反馈'整体的tokens感觉并没有改变？左边的nav bar上方的icon是错误的W'，Claude 逐点列出 8 处具体不专业观感问题。人类回复'对整个系统做一次重构，使用新的设计，并解决以上的问题'。Claude 随后做了全站审计，确认规模集中在 tpl-designer（45%）+ canvas/chat 两个次热点。**在审计与方案草拟期间，人类又发来一张真实截图，指出'选中的tag都看不到文字，我们的所有的UI没有遵循基础的UIUX的架构在实施，请统一全系统的UIUX架构和标准，避免这个事情再次发生'**——Claude 定位到根因：`tailwind.config.ts` 里 `foreground` 从来不是独立顶层色键，`bg-foreground`/`text-background`/`border-foreground` 这类写法不生成任何 CSS，全仓 270 处、60 个文件命中，其中约 43 处是真实可见的失效（chip/进度条填充/选中态描边不可见）。Claude 已将这 43 处**作为紧急缺陷修复**直接改用已存在的 `inverse`/`inverse-foreground` token（不引入新设计，只是把坏掉的写法换成本来就该用的、已经签核过的 token），并新增 lint 规则 U12 + 存量豁免登记表挡住新增、追踪剩余 227 处待迁移——这部分不需要本 delta 签核（是缺陷修复，不是新设计）。本 delta 待签核的是**后续的系统性方案**：F20（门控收紧节奏）、F21（tpl-designer 主攻）、F22（canvas 跟进）、以及 227 处 `text-foreground` 类存量的分批迁移安排。"
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# 共享原语补齐 + token 失效清理 —— 设计签核（草案，待人类确认）

## 已经做的紧急缺陷修复（不需要本 delta 签核，先行执行，供人类知悉）

`bg-foreground`/`text-background`/`border-foreground` 是**从未生效过的写法**（`foreground`
不是 tailwind.config.ts 里的独立顶层色键）——这不是设计选择，是 bug。已直接改用已有的
`inverse`/`inverse-foreground` token 修复，覆盖 9 个文件、约 43 处真实不可见的元素
（模板标签 chip、admin 用量进度条填充、canvas 编辑器选中态、survey 状态筛选胶囊等）：

- `apps/web/components/canvas/template-tag-input.tsx`（用户报告的直接触发点）
- `apps/web/components/canvas/{template-display-panel,template-editor-panel,template-editor}.tsx`
- `apps/web/components/admin/{limit-policy-tab,limit-rules-live,usage-monitor-tab}.tsx`
- `apps/web/components/asset-governance/ag-screens.tsx`
- `apps/web/components/survey/survey-list.tsx`

新增 `apps/web/scripts/lint-design.sh` **U12 规则**（同 F03 U10 的存量豁免登记表模式）：
裸 `-foreground` 一律拦截，已知未迁移的 227 处（多数是 `text-foreground` 用作正文颜色——
因父级恰好本来就是深色文字而"暂时没坏"，但同样是失效写法，随时可能在新的容器背景下
重演同一个 bug）登记进 `scripts/foreground-legacy-allowlist.txt`，新增用法立即拦截，
不再允许这个错误继续扩散。

## 待人类确认：系统性方案（本 delta 要签的部分）

沿用 F19 的方向（不换主色相、不改交互，只是让全站真正走同一套已签核的 token/组件），
拆成：

- **F20**：把上面已经建好的 U12 门控从"存量豁免"状态推进——按模块批次把
  `foreground-legacy-allowlist.txt` 里的 227 处逐步迁移并从豁免表移除，每清完一批
  该模块的豁免行清零即为验收标准。
- **F21（tpl-designer 主攻）**：审计确认的重灾区——20 个 `*-panel-editor.tsx` 手写裸
  `<input>`/`<textarea>`/checkbox，全部换成 `ui/input`、`ui/textarea`、`ui/checkbox`；
  完成度指示从裸文本比例换成 `ui/progress`。行为不变，只换控件实现。
- **F22（canvas 跟进）**：`template-admin.tsx`/`template-editor-panel.tsx` 等同类替换，
  文件更大、业务逻辑耦合更深，独立 issue/PR。

**明确排除 chat 模块**：审计发现 chat 组件里也有同类问题（`copilotkit-v2-panel.tsx`
目前有其他会话在改，本 delta 不碰），但当前处于人类此前明确裁决的"先做主题/token
级打磨，chat 具体交互先不动"期，待该裁决解除后再补一个 chat 专属 delta。

## ① UI / ② 用例 / ③ API 契约

同已签核的 `interaction-primitives`/`visual-identity-refresh` 两份 delta 的既定结论：
不新增视觉概念（沿用已签核组件外观）、不改用例（读写逻辑/校验规则/保存时机不变，
完成度可视化是同一信息的展示增强）、无 API 契约变化（纯前端组件替换）。

## 待人类确认的问题

1. 是否同意 F20→F21→F22 的拆分与顺序（tpl-designer 主攻优先于 canvas，chat 本轮排除）？
2. 已经先行执行的 43 处紧急缺陷修复 + U12 门控，是否需要单独审阅，还是随下一次
   `harness verify`/PR 走正常复核即可？

回复确认（或指出要调整的地方）后，把上方 frontmatter 的 `status` 改成 `confirmed`、
补 `confirmed_by`/`confirmed_at`/`confirmed_via`，随即拆 issue 开工 F20/F21/F22。
