---
status: pending
bundle: open-self-serve-registration
scope: auth-registration-no-invite-code
ruling: "人类 2026-08-24 会话内拍板两点（组织归属=自助建新组织；防滥用=邮箱验证），
  技术细节草案见 contract.md，三处「待人类确认点」仍待裁。"
confirmed_by: null
confirmed_at: null
---

# 取消注册邀请码，降低注册门槛 —— 设计签核

这是一份**新的 delta 包**。它不修改、也不重新确认已签核的 `auth` 束其余部分
（`redeemInviteAndCreateOrg` / `bootstrapFirstUser` / 组织内部各类邀请机制均不变）。
本文件的每一次 status 变更都归人类所有——**agent 不得改 status**（ADR-023）。

规范来源：[contract.md](./contract.md)。**在 status 变成 confirmed 之前，不得开工
实现**（这份草案本身就是待签核材料，不是已批准的实现指引）。

## ① UI

待定——需要 `ui-prototyper` 先补材料：`/register`（或当前注册入口，需实测核实真实
路径与现状）去掉邀请码输入框，改为邮箱+密码+姓名+组织名四项直接提交；提交后跳转到
「请查收验证邮件」等待页（若该等待态 UI 尚不存在，需一并补，参照登录页对"未验证"
状态的既有处理方式，若存在的话）。

## ② 用例

见 [contract.md](./contract.md)「已裁两点」与「待人类确认点」——组织归属、防滥用手段
已裁；登录闸门覆盖范围、旧邀请码路径去留、滥用防线边界三点待裁。

## ③ API 契约

一个新操作 `registerNewAccount`（`POST /auth/register-open`），零新增错误码之外的
概念（复用 `EMAIL_TAKEN`），不修改 `redeemInviteAndCreateOrg` 的既有形状。见
[contract.md](./contract.md) 的 ts 块。

---

**人类签核时请逐条确认 contract.md「待人类确认点」①②③，并在此处补一行签核记录后
把上方 frontmatter 的 `status` 改为 `confirmed`。**
