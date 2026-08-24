---
status: confirmed
bundle: open-self-serve-registration
scope: auth-registration-no-invite-code
ruling: "人类 2026-08-24 两轮会话内拍板五点：①注册后组织归属=自助建新组织；
  ②防滥用手段=邮箱验证；③登录闸门覆盖范围=实现时先核实现状，补一条反证，
  不假设复用同一 use case 自动成立；④redeemInviteAndCreateOrg 去留=彻底移除，
  只留开放注册；⑤本轮防滥用边界=不做频率限流/人机验证，只邮箱验证。
  技术细节、需要一并改写的既有测试清单见 contract.md。"
confirmed_by: usam.shen@gmail.com
confirmed_at: "2026-08-24"
confirmed_via: "AskUserQuestion 结构化问答，两轮：第一轮①注册后组织归属→"自助建新组织"、
  ②防滥用手段→"邮箱验证（发验证信，未验证不能登录）"；第二轮①登录闸门覆盖范围→
  "实现时先核实，补一条反证（推荐）"、②旧邀请码路径去留→"彻底移除，只留开放注册"、
  ③防滥用边界→"不需要，只邮箱验证（已确认，推荐）"。"
---

# 取消注册邀请码，降低注册门槛 —— 设计签核

这是一份**新的 delta 包**，修改已签核的 `auth` 束——具体是**移除**
`redeemInviteAndCreateOrg` 这一个操作、**新增** `registerNewAccount`；`auth` 束
其余部分（`bootstrapFirstUser`、`joinOrgWithInvite`、组织内部各类成员邀请/共享
邀请链接机制）不受影响、不重新签核。本文件的每一次 status 变更都归人类所有——
**agent 不得改 status**（ADR-023）；本次 `status: confirmed` 依据上方 frontmatter
记录的人类 2026-08-24 会话内逐条拍板（`ruling`/`confirmed_via` 逐字转写，未替人类
归纳或编造）。

规范来源：[contract.md](./contract.md)。

## ① UI

待定——开工时需要 `ui-prototyper` 先补材料：`/register`（或当前注册入口，需实测
核实真实路径与现状）去掉邀请码输入框，改为邮箱+密码+姓名+组织名四项直接提交；
提交后跳转到「请查收验证邮件」等待页（若该等待态 UI 尚不存在，需一并补，参照登录页
对"未验证"状态的既有处理方式，若存在的话）。**UI 材料本身仍需在实现 PR 里补齐**，
这份签核批准的是方向与契约形状，不是替代 UI 截图证据。

## ② 用例

见 [contract.md](./contract.md)「三点已裁」——登录闸门覆盖范围（实现时先核实，补
反证）、旧邀请码路径去留（彻底移除）、防滥用边界（本轮只邮箱验证）均已裁定。

## ③ API 契约

新增 `registerNewAccount`（`POST /auth/register-open`）；移除 `redeemInviteAndCreateOrg`
及其错误码 `INVITE_CODE_INVALID`（若仓库其他地方仍引用需一并核实清理）。见
[contract.md](./contract.md) 的完整形状与需要一并改写的既有测试清单。

---

**签核记录**：人类已在 2026-08-24 的两轮 `AskUserQuestion` 交互中逐条拍板五点决策
（见上方 frontmatter）。本 PR 是这次签核的可追溯记录——人类在此 PR 上 review/merge
即完成签核动作；merge 后方可依 contract.md 开工实现。
