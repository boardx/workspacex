# 契约束 `agent-interrupts` — ① UI 界面落点（签核面第 ① 件）

> ⚠ **本轮无截图，本束尚未进入 UI 先行阶段。** 下面每一屏都以文字描述登记为
> 「⚠ 未产出」的材料缺口（不写 `.png` 路径，`lint-ui-material.mjs` 会把 `.png`
> 路径当死链判 0——这是本文件唯一被机械门控检查的地方）。
> `ui-material-map.json` **本轮不新增本束的映射行**——加了空目录会被
> `lint-ui-material.mjs` 判「未产出」而非「未声明」，两者对人类阅读体验相同，
> 但在映射表里提前占位会让人误以为已经规划好截图目录结构；等 ui-prototyper 真正
> 进场时再加那一行，逻辑更干净。

## 交给谁画——本轮判断：不吃，移交 `ui-prototyper`

理由：

1. **三张卡的交互细节依赖签核结果**——尤其 UC-3 的 `choose_option` 决策路径
   （`edit` 而非 `respond`）会影响「选中即 resume」在前端具体调用哪个 hook 方法、
   要不要一个「都不要」的按钮；这些在人类签第 ② 件用例之前画出来的截图，
   一旦裁决变化就要重画，浪费一轮。
2. `ui-prototyper` 需要 `apps/web` 真实组件 + mock（ADR-003），我这轮没有起浏览器
   工具链、也没有权限触碰 `apps/web`（任务硬边界）。
3. **与 `plan-control` 先例一致**：那束也是先出契约骨架 + 文字设计说明，
   人类裁完四个问题后才叫 `ui-prototyper` 补八屏（`plan-control/design-signoff.md`
   〇·三节）。

⇒ **本包签核时，① UI 一节只能审「设计说明对不对」，不能审「截图对不对」**——
这与 `plan-control` 当初「零截图不许签」的先例**同一形状**：**若人类沿用同一标准，
本包同样应该先补齐截图再签**，我在这里如实标出、不代人类降低标准。
需要哪一轮补图，等下面的三屏设计说明确认后再排。

---

## 三屏设计说明（供 ui-prototyper 后续对照，非签核材料本身）

### 屏一：目标复述卡（`confirm_intent`）

- 位置：`chat` 束宿主的对话流内，作为一条特殊消息卡片（与既有 `call_skill` 审批卡
  同一插槽——「批准卡本体…宿主归 chat 束」的既有关系在 `agent-runtime`
  `design-signoff.md` X-9 已确认）。
- 内容：一句「理解」文本 + ≥2 条假设列表（只读态）。
- 两个动作：「继续」（→ UC-1 approve 分支）、「改假设」（进入行内可编辑态，
  每条假设变成可编辑文本框 + 增删按钮，提交 → UC-1 edit 分支）。
- 未确认前：卡片下方**不渲染**任何后续工具调用卡（对应不变量 I-1 的可视化）。
- 建议 `data-testid` 前缀：`agent-interrupt-confirm-intent-{card|assumption-{n}|continue|edit-toggle|edit-submit}`。

### 屏二：参数补全表单（`fill_params`）

- 每个字段一行：字段名（`label`）+ 输入控件（按值类型渲染）+ 若 `aiGuess !== null`，
  在控件旁加一个高亮徽标（视觉与 chat 束 `MessageBadge` 同一套 token，不新起一套
  颜色语言）+ 悬浮/点开显示 `rationale` 原文。
- `required && aiGuess === null` 的字段：无高亮，边框走「必填未填」的既有校验态。
- 提交按钮文案随是否有改动切换：全部未改 → 「接受」（approve）；有改动 →
  「应用」（edit）。
- 底部提示行：`appliedTo === "ledger-only"` 时显示「本步骤执行中，改动将在完成后生效」
  （与 `plan-control` 束 I-11 的用户提示文案同构，UC-2 已注明这条故意同构）。
- 建议 `data-testid` 前缀：`agent-interrupt-fill-params-{card|field-{name}|ai-badge-{name}|submit}`。

### 屏三：多方案对比（`choose_option`）

- 2–3 张等宽卡片，横向排列（移动端可能纵向堆叠，`ui-prototyper` 按既有响应式规则处理，
  非本束新增规则）。
- 每张卡固定三行对照：见效 / 投入 / 预计收益（顺序固定，`domain.md` 值对象
  `OptionCard` 字段序即展示序）。
- 选中态：点击整张卡即选中并立即 resume（不设二次确认——原始描述「选中即 resume」）。
- 是否画「都不要」的逃生口按钮：`usecases.md` UC-3 已声明契约层允许 `reject`，
  **是否渲染由签核时人类决定**，此处登记为待人类确认项（见下方 checklist）。
- 建议 `data-testid` 前缀：`agent-interrupt-choose-option-{card|option-{optionId}|decline}`。

---

## 材料缺口登记（供 `lint-ui-material.mjs` 与人类核对）

⚠ 未产出：agent-interrupt-confirm-intent 卡片（只读态 + 编辑假设态）
⚠ 未产出：agent-interrupt-fill-params 表单（含 AI 猜测高亮态 + 必填未填校验态）
⚠ 未产出：agent-interrupt-choose-option 对比卡（2 张态 + 3 张态 + 选中过渡态）

本文件顶部自检：**本文件引用 0 张，目录实存 0 张**（无截图目录，`lint-ui-material.mjs`
对本束的处置见下方「与门控的关系」）。

## 与门控的关系

`contract-design.md` 明写：`has_ui: true` 的阶段没有「零契约束＝静默放行」的逃生口，
但**这是关于「有没有 `contracts/` 目录」，不是「目录里有没有截图」**。本束已经有
`contracts/agent-interrupts/`，`lint-ui-material.mjs` 对**零截图**的束会判「未产出」
而非「未声明」——这条红是**预期的、如实的红**，不是本包的缺陷，签核前需要
`ui-prototyper` 补齐这一节才能让该门控回绿（与 `plan-control` 建束之初同一先例）。

## 签核前请重点确认

- [ ] **三屏设计说明是否符合原始需求**（复述卡的「继续/改假设」二态、参数表单的
      高亮+依据、对比卡的固定三项对照）——这是本轮唯一能审的东西。
- [ ] **choose_option 是否需要「都不要」的逃生口按钮**——契约层已留了 `reject`，
      UI 画不画是产品判断，请拍。
- [ ] **是否接受「先签设计说明、后补截图」这个顺序**，还是要求与 `plan-control`
      同标准「零截图不许签」（若选后者，需要先派 `ui-prototyper`，本包这轮先只作为
      设计说明稿提交，`design-signoff.md` 的 `status` 继续留空直到截图到位）。
