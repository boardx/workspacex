---
status: proposed
bundle: shared-invite-links
scope: org-shared-invite-links-multi-use
ruling: "人类 2026-08-13 会话内逐条拍板三点（形态 / 默认值 / admin 级双人复核前移）"
---

# 组织共享邀请链接 —— 设计签核

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `org-admin` / `auth` /
`identity` 束及 `invite-link-and-reads` delta 的其余部分。本文件的每一次 status 变更
都归人类所有——**agent 不得改 status**（ADR-023）。实现已按人类三条拍板开工，
**合并前需人类把 status 改 confirmed**。

规范来源：[contract.md](./contract.md)。

## ① UI

- `/org-admin` 邀请标签页新增「共享邀请链接」区块：建链表单（角色 / 有效期三档默认
  7 天 / 人数上限可选默认无上限）+ 链接列表（五态徽标 pending-review / active /
  expired / revoked / exhausted、已用人数、作废按钮带二次确认、待复核行的批准/拒绝，
  发起人视角无自批按钮改等待说明——照 #953 delta ② 先例）。
- 建链/批准成功后的一次性链接展示块（复用 #953 的四态纪律：展示 / 已复制 /
  复制失败降级 / 关闭消失；切标签页存活）。
- 激活页 `/auth/activate` 扩展 link 模式（`?lt=`）：自填邮箱+姓名+密码；
  失效统一文案（防枚举）、配额满指向配额、已有账号指向登录。

## ② 用例

见 [contract.md](./contract.md)「已裁三点」与「与 O-28⑥ 的关系」——多次使用语义、
配额硬闸、admin 级链接复核前移到建链环节（pending-review 态令牌不存在）。

## ③ API 契约

五个新操作 + 两个新枚举，零新错误码，见 [contract.md](./contract.md) 的 ts 块；
表结构（token 只存 hash）见「数据面」一节。

---

## 怎么签

把上面的 `status: proposed` 改成 `status: confirmed`，并补上：

```yaml
status: confirmed
confirmed_by: "<你的名字>"
confirmed_at: "<ISO8601 时间戳>"
```

三点方向已由你本人拍板，这份签核确认的是**契约形状与两处实现裁定**：
① token hash 化 + 明文只出现一次的纪律；② contract.md「待人类确认点」——
共享链接建号的 `email_verified_at` 置为激活时刻（否则登录死路）。
若否定其中任何一项，请在本文件里写明否定哪一项。
