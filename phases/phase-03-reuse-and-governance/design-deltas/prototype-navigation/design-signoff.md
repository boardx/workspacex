---
status: pending           # pending | confirmed —— ⚠ 只能由人类改，agent 不许动
bundle: prototype-navigation
base_bundle: design-prototype   # 挂靠束：原型画布（已签，2026-09-06）
scope: clickable-prototype-model-authored-links-preview-mode-board-connectors
covers: []
confirmed_by: null
confirmed_at: null
confirmed_via: null
---

# design delta 签核 · 可点击原型——页与页之间的跳转关系（迭代 11）

⚠ `status`、`confirmed_by`、`confirmed_at` 只能由人类修改；agent 不代签（ADR-023 / AGENTS.md
「设计签核（三件、一处签）」）。

规范唯一来源：[`contract.md`](./contract.md)。验收口径：[`verification.md`](./verification.md)。
GitHub：issue #2917（评估与拆解）。

## 这份 delta 为什么存在

人类 2026-09-07 问「生成的原型，可以生成可点击、连贯的吗？」——答案是**现在不能**：迭代 1–10
产出的是静态组件树，点节点是「选中去改」不是跳转。人类随即拍板「跳转关系由模型自动连」，
并要求「重新定义下一个迭代，需要我签署的给我文件」。这份就是。

**这次与迭代 3–10 不同，是先签后做**：改的是 API 契约（`PrototypeScreen` 变形、`PrototypePatchOp`
多一种 op），按 `contract-design.md` 的 covers 追加三条件（UI 已签 / 契约已签 / 零新增设计面）
一条都不满足，所以走 design-delta，不追加进 `design-prototype` 束的 `covers:`。

## ① UI

见 [contract.md](./contract.md) §4，截图见挂靠束的 [`ui.md`](../../contracts/design-prototype/ui.md)
末尾「迭代 11」三张（`detail-prototype-preview-dark` / `-links-dark` / `-inspector-link-dark`）——
按 ADR-003「UI 先行」，用 `apps/web` 真组件 + 夹具做出来拍的，**后端一行没动**。

重点确认：
- 「编辑 / 预览」放在视图切换（画板 / 单页）旁边，是不是你要的位置；
- 预览模式下**没有** link 的节点点了没反应——要不要给一个"这里没连线"的轻提示；
- 画板连线从源节点右缘到目标页左缘，多条同目标的线末端合并——够不够看清流程。

## ② 用例

见 [verification.md](./verification.md) V26–V35，重点看**失败模式**是否穷举：

- 目标页不存在 / 自跳 / `from` 不在本页 / `item` 越界 / 重复 —— 各自只丢那一条（V26）；
- 模型整页写回时 id 是它自己给的，被重分配了那条 link 就丢（V26/V27）；
- 预览模式下点没 link 的节点：既不跳也不选中（V29）；
- 恢复旧版本时 `links` 一起回来（V28）。

## ③ API 契约

见 [contract.md](./contract.md) §1–§3，对应 `packages/contracts/src/design-prototype.ts`：

1. `PrototypeLink { from, item?, to }`；`PrototypeScreen.links?: PrototypeLink[]`（≤ 30）。
2. `PrototypePatchOp` 新增 `{ op: "setLinks", screen, links }`——人改与模型改同一个 op。
3. `validateLinks` 纯函数一处声明，整页与 patch 两条路都过它；处置是**逐条丢**，不是整页拒。
4. **没有新路由**：整页仍走 `appendProjectChat`，人改仍走 `patchPrototype`。
5. 存储按 §5 的选择：A（建议）两张表各加 `screens jsonb` 单列 + 数据迁移；B 加 `frame_links` 列。

## 请人类拍板的三处取舍（`contract.md` §7）

| # | 取舍 | 建议 | 备选 |
|---|---|---|---|
| ① | 悬空跳转怎么处置 | **A** 只丢那一条、页面保留 | B 沿用 I-10 整个 `prototype` 拒 |
| ② | 存储形状 | **A** 收敛成单列 `screens jsonb`（+40% 工作量，换掉一整类按位置对应的脆弱性） | B 加第四列 `frame_links` |
| ③ | 预览模式下能否点选编辑 | **A** 不能，预览就是预览 | B 能，按住 Alt 选中 |

签核时若与建议不同，把选择写在下面这行，agent 按它实现：

> 人类选择：① ＿ ② ＿ ③ ＿

## 顺带追认（`contract.md` §8）

#2900 把 I-8 / I-19 从「只写 `frames` ⇒ 清空 `prototype`」改成「等长保留，不等长才清」，
是修用户实测的数据丢失，实现先行。`domain.md` I-8/I-19 与 `coverage.md` V12 已随本 PR 改文。
签核本 delta 即一并追认这处修改。

## 与既有已签内容的关系

- 挂靠束 `design-prototype` 的 21 个原语、`PROTOTYPE_FIELDS`、patch 四种 op、版本历史语义**一个不改**；
  本 delta 只加 `links` 与 `setLinks`。
- 不新增路由、不新增错误码；`PROTOTYPE_PATCH_REJECTED` 的 `patchReason` 闭集**不扩**——
  `setLinks` 的不合法条目按 §2 逐条丢，不是拒。
