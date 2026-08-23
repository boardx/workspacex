# 取消注册邀请码，降低注册门槛（自助建组织）—— contract delta

Status: proposed; human signoff required.（ADR-023——本 delta 修改一个已签核的束
[`auth`](../contracts/auth/design-signoff.md)，动工前必须先签这份 delta。）

本文件是本 delta 的**唯一规范来源**。两条方向性决策出自**人类 2026-08-24 会话内
拍板**（coord-main 转达）：

1. **注册后的组织归属**：自助建新组织（同 `redeemInviteAndCreateOrg` 的建组织语义，
   只是去掉 `code` 必填）。
2. **防滥用手段**：邮箱验证——未验证不能登录。

基线：`origin/main`。

## 现状（已核实，非推测）

- `redeemInviteAndCreateOrg`（`POST /auth/register`，`packages/contracts/src/auth.ts:347`）
  是唯一的注册入口，`in.code`（14 位邀请码）**非 optional**——zod 在缺字段时直接判
  invalid，这一点被 `apps/api/tests/auth/register-http-contract.test.ts` 与
  `apps/api/tests/auth/bootstrap-first-user-usecase.test.ts` 显式反证钉住
  （"不带 code 不能注册"）。
- **邮箱验证机制已经存在、且已经接在这条注册路径上**——不是要新建的能力：
  `register-with-invite.ts` 注册成功后即把用户置于「待验证」态（`out.verificationDelivery:
  "queued"`），`pending-verification-cookie.ts` 设置未验证态 cookie，
  `EmailVerificationController`（`/auth/email-verifications/confirm`、
  `.../resend`）+ `cloudflare-email-transport.ts`（真实发信，Cloudflare Email Service）
  +  `mail-outbox-worker.ts`（真实投递）构成完整闭环。**登录闸门本身在哪一层拦截
  未验证用户是本 delta 唯一需要确认的实现细节**（见下方「待人类确认点」）。
- `bootstrapFirstUser`（`POST /auth/bootstrap`）是**永久一次性**的冷启动种子账号入口
  （`credentials` 表全空时才可用，消费后经 `auth_bootstrap_state` 单例表永久关闭），
  与本 delta 语义不同，不受影响、不复用。

## 契约形状（auth 束追加，一个新操作）

⚠ **不修改 `redeemInviteAndCreateOrg` 本身**——它的 `in.code` 必填是被两处测试显式
钉住的不变量，直接改形状等于让已签核契约的"字面即真相"失效。新增一个语义更准确的
操作名，旧操作保留（是否退场见下方待确认点②）。

```ts
// packages/contracts/src/auth.ts —— auth 束追加
registerNewAccount: {
  method: "POST",
  path: "/auth/register-open",   // 与 /auth/register 分开，不共用路径分支判断 code 有无
  in: z.object({
    email: z.string().email(),
    password: PasswordPolicy,
    displayName: z.string().min(1),
    orgName: z.string().min(1),
  }).strict(),
  out: z.object({
    userId: z.string(),
    orgId: z.string(),
    verificationDelivery: z.literal("queued"),
  }).strict(),
  err: ["EMAIL_TAKEN"] as const,   // 没有 INVITE_CODE_INVALID —— 没有码可判
},
```

## 已裁两点（人类拍板，逐条照录）

1. **组织归属**【已裁】：`registerNewAccount` 直接建一个新组织，调用者即该组织的
   owner——与 `redeemInviteAndCreateOrg` 建组织那一段完全同构（复用
   `register-with-invite.ts` 里"建组织 + 建 owner membership + 建 credential"那个
   事务，只是不再校验/消费邀请码那一步）。
2. **防滥用**【已裁】：复用既有邮箱验证闭环，未验证用户不能登录——即
   `registerNewAccount` 的行为与 `redeemInviteAndCreateOrg` 在"验证前不能登录"这一点
   上完全一致，只是不再要求邀请码。

## 待人类确认点（本 delta 唯一悬而未决的部分）

⚠ **①登录闸门的位置**：需要先核实"未验证不能登录"今天具体是在哪一层实现的
（`SessionTokenPrincipalResolver`？登录 use case 里的显式检查？还是只是前端不显示
主界面、后端其实放行了？）——如果这道闸门目前只对"通过邀请注册"的用户生效、没有
覆盖到新路径要走的同一段登录代码，需要补一条反证测试钉住"未验证 + 新注册路径 → 
登录仍被拒"，不能假设"抄了同一个 use case 就自动成立"。

⚠ **②`redeemInviteAndCreateOrg`（旧邀请码注册）去留**：人类原话"取消注册邀请机制"
可能指（a）新增开放路径、旧邀请码路径保留给特定场景（如内部员工/合作伙伴邀请）继续
用；也可能指（b）彻底移除邀请码注册，`/register` 页面只保留开放注册一种入口。技术上
两者都不难，但影响两处已钉住的安全反证测试（`register-http-contract.test.ts` 第
138-282 行、`bootstrap-first-user-usecase.test.ts` 第 33 行）——若选 (b)，这两处测试
里"code 缺失应该被拒"的断言需要被**有意识地删除/改写**为"新操作没有 code 字段"，
而不是放任它们变红。本 delta 草案默认按 (a) 起草（新增不改旧），因为 (a) 是纯加法、
不触碰已签核不变量，风险更低；若人类拍板要 (b)，请在签核时逐字改这条。

⚠ **③滥用防线的边界**：人类已明确排除邮箱域名限制/频率限流/人机验证作为**本轮**
交付范围（只要邮箱验证一项）。如果上线后出现真实滥用（批量注册占用组织名额等），
按 AGENTS.md「实测优先」原则回来加，不在本 delta 预先设计。

## 影响面（现状盘点，供①③做技术判断参照）

- `apps/web` 的注册页面/`/register`（若存在，需人类实测确认当前 UI 现状——本 delta
  未附截图，UI 签核仍需按 ADR-023 走 ui-prototyper 补材料）。
- `apps/api/src/application/auth/register-with-invite.ts`：新操作复用其"建组织+
  建owner+建credential+入队验证邮件"这套编排，只是跳过邀请码校验/消费两步。
- `apps/api/src/infrastructure/auth/pg-registration-repository.ts`：`REDEEM_SQL`
  消费邀请码的那条 UPDATE 语句不再是新路径的必经步骤；新路径直接建组织（同
  `bootstrap-first-user` 的建组织语句形状，但不受"仅首个用户"限制）。
