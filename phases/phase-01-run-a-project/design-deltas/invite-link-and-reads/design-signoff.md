---
status: proposed
confirmed_by: null
confirmed_at: null
bundle: invite-link-and-reads
scope: invite-activation-link-delivery-plus-three-read-paths
ruling: "coord-main 2026-08-11（人类离线期间全权授权裁定）"
---

# 邀请链接送达 + 三条读路径收口 —— 设计签核（#638 / #639）

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `org-admin` / `identity` /
`auth` 束的其余部分。本文件的每一次 status 变更都归人类所有——**agent 不得改 status**
（ADR-023）。实现已按 coord-main 裁决开工，**合并前需人类把 status 改 confirmed**。

规范来源：[contract.md](./contract.md)。

## ① UI

- 邀请/重发成功后的一次性激活链接块（四态：展示 / 已复制 / 复制失败降级 / 关闭消失），
  见 contract.md ①；截图见 PR。
- 发起人视角的「等待另一位管理员复核」说明（替代死按钮），见 contract.md ②。
- 新增激活落地页 `/auth/activate`（两分支、防枚举统一失效文案）。

## ② 用例

见 [contract.md](./contract.md) ①—④ 各节：每一项都写明了问题（断头路/死按钮/垃圾
邮箱落库/非 admin 读不到头像）、裁决内容与安全口径的改写理由。

## ③ API 契约

四处形状变更（两处 `out` 加字段、一处 `in` 收紧、一处实体加字段），逐条见
[contract.md](./contract.md) 的 ts 块。无新路由、无新错误码。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳，如 2026-08-11T22:00:00+08:00>"
```

方向已由 coord-main 按全权授权裁定，这份签核确认的是**契约形状与安全口径的改写**
（尤其 contract.md ① 「一次性回传 ≠ 任何管理员随时可读」那段论证）。若你否定其中
任何一项，请在本文件里写明否定哪一项——四项彼此独立，可拆签。
