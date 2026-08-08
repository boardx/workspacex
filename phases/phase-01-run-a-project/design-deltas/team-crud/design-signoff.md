---
status: proposed
bundle: team-crud
scope: team-create-rename-delete
---

# 团队 CRUD —— 设计签核（#639）

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `org-admin` 束。
本文件的每一次 status 变更都归人类所有——**agent 不得改 status**（ADR-023）。

规范来源：[contract.md](./contract.md)。

## ① UI

见 [contract.md §5](./contract.md#5-前端边界)。

## ② 用例

见 [contract.md §2](./contract.md#2-用例)。

## ③ API 契约

见 [contract.md §1](./contract.md#1-契约操作)。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳，如 2026-08-06T14:30:00+08:00>"
```

签之前请先在 [contract.md §4](./contract.md#4-需要你先拍板的三件) 里对三个裁决点给出选择。
