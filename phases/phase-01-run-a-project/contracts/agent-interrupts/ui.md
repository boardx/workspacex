# 契约束 `agent-interrupts` — ① UI 界面落点（签核面第 ① 件）

> **自检：本文件引用 25 张截图，`ui-preview/agent-interrupts/` 目录下实际 25 张。N == M == 25。**（2026-08-26 ui-prototyper 交付）

# ✅ 三屏已产出：第 ① 件**材料齐备**，`status` 仍待人类 Approve

三张卡（confirm_intent / fill_params / choose_option）已由 `ui-prototyper` 用 `apps/web`
真实组件 + mock 数据产出，截图落在 `ui-preview/agent-interrupts/`（见下方对照表）。
每屏覆盖七种必现状态（default / loading / empty / invalid / dep-failed / denied / success）
+ 屏专属变体，共 25 张。`lint-ui-material.mjs` 对本束「目录 0 张 png」的判定④随之回绿。

⚠ **材料齐备 ≠ 签核通过**：`design-signoff.md` 的 `status` / `confirmed_*` / `confirmed_via`
在人类 Approve 之前继续留空（ADR-023 决策五的信任边界）。**agent 不改 status。**

- 组件：`apps/web/components/agent-interrupts/{confirm-intent,fill-params,choose-option}-card.tsx`
- mock：`apps/web/lib/mock/agent-interrupts.ts`（形状对齐 `domain.md` 值对象）
- 预览路由：`apps/web/app/preview/agent-interrupts/page.tsx`
- 截图脚本：`apps/web/scripts/shot-agent-interrupts.mjs`
- 逐屏设计决定 + 待人类拍板项：`ui-preview/agent-interrupts/README.md`

---

## 三屏 × 截图对照（共 25 张）

### 屏一：目标复述卡（`confirm_intent`）— UC-1

- 位置：`chat` 束宿主的对话流内，作为一条特殊消息卡片（与既有 `call_skill` 审批卡同一插槽，
  `agent-runtime` X-9 已确认）。
- 内容：一句「理解」文本 + ≥2 条假设列表（只读态，I-2）。
- 两个动作：「继续」（→ UC-1 approve 分支）、「改假设」（进入行内可编辑态，每条假设变可编辑
  文本框 + 增删按钮，提交 → UC-1 edit 分支）。
- 未确认前：卡片下方渲染一条「后续步骤未开始」的门控说明条（I-1 的可视化）。
- `data-testid` 前缀：`agent-interrupt-confirm-intent-{card|assumption-{n}|continue|edit-toggle|edit-submit|gated-notice}`。

| 截图 | 状态 |
|---|---|
| `ui-preview/agent-interrupts/uc-1-confirm-intent-default.png` | 默认（只读，继续/改假设） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-loading.png` | 加载 |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-empty.png` | 空（无 pending 中断） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-invalid.png` | 校验失败（假设空、< 2 条） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-dep-failed.png` | 依赖失败（AUDIT_SINK_UNAVAILABLE） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-denied.png` | 无权限（NO_WRITE_ROLE） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-success.png` | 成功（已确认继续） |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-edit.png` | 变体：改假设编辑态 |
| `ui-preview/agent-interrupts/uc-1-confirm-intent-observer.png` | 变体：观察者视角 → denied |

### 屏二：参数补全表单（`fill_params`）— UC-2

- 每个字段一行：字段名（`label`）+ 输入控件（按值类型渲染：text / select / boolean）+
  若 `aiGuess !== null`，字段单独高亮（中性强调，见 README 设计决定 #1）+「AI 建议」徽标
  + `rationale` 依据文案（I-3：有猜测必有依据）。
- `required && aiGuess === null` 的字段（抄送对象）：无高亮，走「必填未填」既有校验态。
- 提交按钮文案随是否有改动切换：全部未改 →「接受」(approve)；有改动 →「应用」(edit)。
- 改动后出现 `appliedTo` 二选一（full-rerun / ledger-only）；选 ledger-only 时显示提示行
  「本步骤执行中，改动将在完成后生效」（与 `plan-control` I-11 同构，UC-2 已注明）。
- `data-testid` 前缀：`agent-interrupt-fill-params-{card|field-{name}|input-{name}|ai-badge-{name}|rationale-{name}|applied-{full-rerun|ledger-only}|ledger-hint|submit}`。

| 截图 | 状态 |
|---|---|
| `ui-preview/agent-interrupts/uc-2-fill-params-default.png` | 默认（AI 高亮 4 字段 + 必填未填字段） |
| `ui-preview/agent-interrupts/uc-2-fill-params-loading.png` | 加载 |
| `ui-preview/agent-interrupts/uc-2-fill-params-empty.png` | 空 |
| `ui-preview/agent-interrupts/uc-2-fill-params-invalid.png` | 校验失败（抄送对象必填未填） |
| `ui-preview/agent-interrupts/uc-2-fill-params-dep-failed.png` | 依赖失败 |
| `ui-preview/agent-interrupts/uc-2-fill-params-denied.png` | 无权限 |
| `ui-preview/agent-interrupts/uc-2-fill-params-success.png` | 成功（appliedTo 文案） |

### 屏三：多方案对比（`choose_option`）— UC-3

- 2–3 张等宽卡片，横向排列（I-5：options ∈ [2,3]）。
- 每张卡固定三行对照：见效 / 投入 / 预计收益（顺序固定 = `domain.md` 值对象 `OptionCard` 字段序）。
- 选中态：点击整张卡即选中（黑描边 + 勾标）并立即 resume（不设二次确认，「选中即 resume」）；
  resume 载荷用 `optionId` 回指（I-6）。
- 「都不要」逃生口（reject）：契约层已允许（`allowedDecisions=["edit","reject"]`），**默认渲染出来**
  供人类核对形态，渲染与否最终由签核裁定（README 设计决定 #3）。
- `data-testid` 前缀：`agent-interrupt-choose-option-{card|option-{optionId}|selected-mark-{optionId}|decline}`。

| 截图 | 状态 |
|---|---|
| `ui-preview/agent-interrupts/uc-3-choose-option-default.png` | 默认（3 张） |
| `ui-preview/agent-interrupts/uc-3-choose-option-loading.png` | 加载 |
| `ui-preview/agent-interrupts/uc-3-choose-option-empty.png` | 空 |
| `ui-preview/agent-interrupts/uc-3-choose-option-invalid.png` | 校验失败（STALE_INTERRUPT / SELECTED_OPTION_NOT_FOUND） |
| `ui-preview/agent-interrupts/uc-3-choose-option-dep-failed.png` | 依赖失败 |
| `ui-preview/agent-interrupts/uc-3-choose-option-denied.png` | 无权限 |
| `ui-preview/agent-interrupts/uc-3-choose-option-success.png` | 成功（已选定继续） |
| `ui-preview/agent-interrupts/uc-3-choose-option-two.png` | 变体：2 张态（I-5 下限） |
| `ui-preview/agent-interrupts/uc-3-choose-option-selected.png` | 变体：选中过渡态 |

---

## 与既有设计语言一致

- 三卡都是**对话流内的一条特殊消息卡**（宿主归 `chat` 束，本束不新建路由）。
- 视觉/骨架与既有 `SendEmailApprovalDialog`（HITL 审批卡）同源：shadcn Card + 头像 + 标题 + 说明。
- AI 以「线程里的同事」在场（中性机器人头像 + 摘要标题），对应「AI 四种在场方式」。
- 黑白灰为主，唯一彩色是 `--danger`（「都不要」、校验失败）。**⚠ 一处与本文件早稿字面不符**：
  AI 猜测高亮改走中性强调而非 `ai-tint` 靛紫——见 `ui-preview/agent-interrupts/README.md`
  设计决定 #1，这是签核第 ① 件时**最需要人类拍板**的一处。

## 签核前请重点确认（详见 README「建议重点核对的 3 处」）

- [ ] **AI 猜测高亮的配色决定**：去色（现状）还是保留靛紫「AI 在场色」——唯一与早稿不一致处。
- [ ] **choose_option「都不要」逃生口留/去**——契约允许 reject，UI 画不画请拍。
- [ ] **fill_params `appliedTo` 二选一控件的措辞**——「立即重跑受影响步骤」须让用户明白这其实是
      full-rerun（domain 缺口 AI-1 的降级），不是「精确子集重跑」。
