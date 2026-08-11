---
status: pending
bundle: token-quota-and-usage
base_bundle: org-admin
scope: token-metering-plus-member-token-quota-plus-usage-monitor-plus-limit-policy
covers: [F159, F160, F161, F162]
confirmed_by: ""
confirmed_at: ""
---

# design delta 签核 · token 计量 / 成员配额 / 用量监控 / 限额策略

⚠ `status` 只能由**人类**改。agent 不许动这一行（ADR-023）。

规范唯一来源：本目录下的 [`contract.md`](./contract.md)。
验收口径：[`verification.md`](./verification.md)。

## 这份 delta 为什么存在

已签核的 `org-admin` 束（2026-07-30，`covers: [F03…F16]`）第 ① 件覆盖了
`/admin/members` 这块屏的**界面**（`ui.md` 第 7 行，锚 `admin-member-quota-<id>` 等
都已建成并有 48 张截图），但第 ③ 件 **API 契约里没有任何 token 额度 / 用量 / 限额策略的
操作**——界面签过了，喂它的后端从来没被评审过。这正是 ADR-023 立 delta 这条路的情形。

## 签核前请重点确认（逐条在 `contract.md` §4 展开）

- [ ] **未设置组织额度 ＝ 不限额**（§1.2）。这是对 `seat_quota` 默认 0 那次事故的反向取舍，
      但它意味着「没配置就无限用」。你要的是这个，还是「先分配才能用」？
- [ ] **失败的模型调用也记一行计量**（§1.1），且**上游在错误体里报了 usage 就如实记**、
      没报才是 0（coord-main 2026-08-12 裁决②的修正）。代价：不再有「失败必为 0」的
      数据库 CHECK。
- [x] ~~只记 `tokens_total`，不拆 in/out~~ —— **实测推翻**：OpenAI 兼容 `usage` 本来就带
      `prompt_tokens`/`completion_tokens`，我们的解析类型漏了。已落两列（可空，
      NULL = 上游没报），`GAP-TOKEN-IO-SPLIT` 撤销。此条无需人类再裁。
- [ ] **四组端点一律仅组织 admin**（§2）；普通成员自查用量不在本 delta 内。
- [ ] **三个新错误码**不与 F11 的 `QUOTA_EXHAUSTED` 合并（§2 末）。

## 与既有束的关系

- 不修改 `contracts/org-admin/` 下任何已签文件。
- 借用 phase-03 F14 的「取最先触发」语义，**不领 F14 整条**
  （coord-main 2026-08-12 裁决第 1 条）。
- F163（管理员边界区接线）**不需要签**：零新增契约，接的是 F06 已 passing 的既有端点。
