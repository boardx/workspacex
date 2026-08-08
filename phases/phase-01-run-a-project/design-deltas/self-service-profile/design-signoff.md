---
status: confirmed
confirmed_by: "usamshen"
confirmed_at: "2026-08-08T11:02:47Z"
bundle: self-service-profile
scope: profile-self-edit-plus-own-activity-read
---

# 用户个人资料自助服务 —— 设计签核（#638）

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `identity` / `auth` 束。
本文件的每一次 status 变更都归人类所有——**agent 不得改 status**（ADR-023）。

规范来源：[contract.md](./contract.md)。

## ① UI

见 [contract.md §5](./contract.md#5-前端边界)。

## ② 用例

见 [contract.md §2-3](./contract.md#2-用例)。

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

签之前请先在 [contract.md §4](./contract.md#4-需要你先拍板的三件) 里对三个裁决点给出选择——
那三条不是"批准/不批准"能回答的，签了 status 但没答那三条，实现方仍然卡在原地。

---

## Addendum A 独立签核（2026-08-08，见 [contract.md Addendum A](./contract.md#addendum-a2026-08-08迭代-1独立-uiux-复核后追加需要单独签核)）

这一小节的签核**独立于上面的主 status**（主 status 已经是 `confirmed`，代表三条裁决点；
Addendum A 是之后追加的、扩展一个已签核契约操作的字段，需要单独一次签）。

```yaml
addendum_a_status: proposed
addendum_a_confirmed_by: ""
addendum_a_confirmed_at: ""
```

怎么签：把 `addendum_a_status` 改成 `confirmed`，补上 `addendum_a_confirmed_by`/`addendum_a_confirmed_at`。
