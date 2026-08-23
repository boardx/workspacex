---
bundle: review-governance
phase: "12"
covers: [F13, F14, F15, F16]
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
confirmed_by:
confirmed_at:
---

# 契约束 `review-governance` 设计签核

> ## 🔴 本束现在不可签核。请不要把 `status` 改成 `confirmed`。
>
> **① 🔴 UI 材料未产出。人类 2026-08-23 已就 `accessibility-guardrails` 束的 A/B/C
> 选定方案 A，本束沿用同一裁决**（不重复裁决）：F14/F15 的评审对象是 chat/profile/
> org-admin 既有页面，先拍「界面落点参考态」截图（当前默认状态，非评审结果本身——
> 正式评审的截图是 F14/F15 落地时的评审产出，不是本次签核材料）。
>
> **② ✅ usecases.md / domain.md / coverage.md 已备齐**，含一处需要注意：UC-3
> 的 `DATA_GAP_FOUND` 分支——评审中如果发现某维度对应的产品数据不存在，参照
> #831/#728 先例可以移除该维度重算，**但这需要人类确认，不是评审 agent 能自行拍板的**，
> 已在 domain.md I-4 里写明。
>
> **③ N/A — 本束无对外 API 契约面。** `.harness/state/uiux-review-log.jsonl` 是内部
> 治理数据，不经 `packages/contracts/` 暴露。

## 人类签核时请重点确认
- **① UI**：ui-prototyper 产出「界面落点参考态」截图后，核对是不是 F14/F15 要评审的
  正确页面（不是核对分数——分数是 F14/F15 落地时的评审产出）。
- **② 用例**：UC-4 `UNCLOSED_GAP` 分支——如果 F16 终验发现某个维度确实无法在本阶段
  闭合（比如受限于产品功能缺口），是否接受阶段「不满 10 分但如实交付」作为合法结束态？
  本文档默认接受（对应 AGENTS.md「没有证据 = 没有完成」的反面：也不该为了凑分造证据），
  需要你确认这个默认。
- **支撑材料**：`domain.md` I-4 的门槛值——chat ≥9、profile/org ≥9 是沿用 phase-01
  既有 rubric 已裁决的门槛，本束不重新裁决，只是复用；如果你认为 phase-12 应该用
  不同门槛，请现在提出。
